import Foundation

/// The system's own wallpaper store, `~/Library/Application Support/com.apple.wallpaper/Store/Index.plist`.
///
/// Undocumented, so every read checks the shape and gives up (nil) on anything unexpected. It is used for what
/// `NSWorkspace` cannot do: set the town snapshot on every Space of a display at once (a Space that was never visited
/// would otherwise flash its own wallpaper), and put back dynamic and aerial wallpapers, which `NSWorkspace` only
/// reports as `DefaultDesktop.heic`. WallpaperAgent reads the file only when it starts, so a change needs a restart.
///
/// Layout: `Displays/<display>` holds a display's default and `Spaces/<space>/Displays/<display>` each Space's
/// choice; the wallpaper itself is `Desktop/Content`, whose first choice is either an image (`Configuration` is a
/// binary plist with `url.relative`) or something else, such as `com.apple.wallpaper.choice.aerials`.
public enum WallpaperStoreIndex {
    public typealias Index = [String: Any]

    /// One wallpaper choice in the store: a display's default (`space == nil`) or one Space's on that display.
    public struct Entry: Hashable, Sendable {
        public let space: String?
        public let display: String

        /// Stable key for saving the entry's original.
        public var id: String { space.map { "space/\($0)/\(display)" } ?? "display/\(display)" }
    }

    public static func load(from url: URL) -> Index? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? Index
    }

    public static func save(_ index: Index, to url: URL) throws {
        let data = try PropertyListSerialization.data(fromPropertyList: index, format: .binary, options: 0)
        try data.write(to: url, options: .atomic)
    }

    /// Every entry of `display`, the display default first.
    public static func entries(of display: String, in index: Index) -> [Entry] {
        var result: [Entry] = []
        if let displays = index["Displays"] as? [String: Any], displays[display] != nil {
            result.append(Entry(space: nil, display: display))
        }
        let spaces = index["Spaces"] as? [String: Any] ?? [:]
        for space in spaces.keys.sorted() {
            if let displays = (spaces[space] as? [String: Any])?["Displays"] as? [String: Any], displays[display] != nil {
                result.append(Entry(space: space, display: display))
            }
        }
        return result
    }

    /// Every display that has an entry.
    public static func displays(in index: Index) -> Set<String> {
        var result = Set((index["Displays"] as? [String: Any] ?? [:]).keys)
        for case let space as [String: Any] in (index["Spaces"] as? [String: Any] ?? [:]).values {
            result.formUnion((space["Displays"] as? [String: Any] ?? [:]).keys)
        }
        return result
    }

    /// `Desktop/Content` of `entry`.
    public static func content(of entry: Entry, in index: Index) -> [String: Any]? {
        (choice(of: entry, in: index)?["Desktop"] as? [String: Any])?["Content"] as? [String: Any]
    }

    /// The image file a content shows; nil for anything that is not an image (aerial, dynamic, colour).
    public static func imageURL(of content: [String: Any]) -> URL? {
        guard let choice = (content["Choices"] as? [Any])?.first as? [String: Any],
              choice["Provider"] as? String == imageProvider,
              let data = choice["Configuration"] as? Data,
              let configuration = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any],
              let relative = (configuration["url"] as? [String: Any])?["relative"] as? String
        else { return nil }
        return URL(string: relative)
    }

    /// `template` showing the image at `url` instead, with the template's other settings (placement, colour) kept.
    public static func imageContent(_ url: URL, like template: [String: Any]) -> [String: Any]? {
        let configuration: [String: Any] = ["type": "imageFile", "url": ["relative": url.absoluteString]]
        guard let data = try? PropertyListSerialization.data(fromPropertyList: configuration, format: .binary, options: 0)
        else { return nil }
        var content = template
        content["Choices"] = [["Provider": imageProvider, "Files": [Any](), "Configuration": data] as [String: Any]]
        return content
    }

    /// Points every entry of `display` at `file`. Returns the changed index and, for each entry that did not show one
    /// of our files already, its original content as a binary plist. Nil when the display has no entry or one has an
    /// unexpected shape; nothing is changed then.
    public static func cover(_ index: Index, display: String, with file: URL,
                             isOurs: (URL) -> Bool) -> (index: Index, originals: [String: Data])? {
        let entries = entries(of: display, in: index)
        guard !entries.isEmpty else { return nil }
        var index = index
        var originals: [String: Data] = [:]
        for entry in entries {
            guard let content = content(of: entry, in: index), let covered = imageContent(file, like: content)
            else { return nil }
            if !(imageURL(of: content).map(isOurs) ?? false) {
                guard let data = try? PropertyListSerialization.data(fromPropertyList: content, format: .binary, options: 0)
                else { return nil }
                originals[entry.id] = data
            }
            guard set(covered, for: entry, in: &index) else { return nil }
        }
        return (index, originals)
    }

    /// Whether every entry of `display` already shows one of our files.
    public static func isCovered(_ index: Index, display: String, isOurs: (URL) -> Bool) -> Bool {
        let entries = entries(of: display, in: index)
        return !entries.isEmpty && entries.allSatisfy { content(of: $0, in: index).flatMap(imageURL(of:)).map(isOurs) ?? false }
    }

    /// Puts back every entry of `displays` that shows one of our files: its saved original, or else the plain image
    /// `fallback` gives for our file. Entries the user changed meanwhile are left alone. Nil when nothing changed.
    public static func restore(_ index: Index, displays: Set<String>, originals: [String: Data],
                               isOurs: (URL) -> Bool, fallback: (URL) -> URL?) -> Index? {
        var index = index
        var changed = false
        for display in displays.sorted() {
            for entry in entries(of: display, in: index) {
                guard let content = content(of: entry, in: index), let shown = imageURL(of: content), isOurs(shown)
                else { continue }
                var restored: [String: Any]?
                if let data = originals[entry.id] {
                    restored = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any]
                }
                if restored == nil, let url = fallback(shown) { restored = imageContent(url, like: content) }
                guard let restored, set(restored, for: entry, in: &index) else { continue }
                changed = true
            }
        }
        return changed ? index : nil
    }

    // MARK: Private

    private static let imageProvider = "com.apple.wallpaper.choice.image"

    private static func choice(of entry: Entry, in index: Index) -> [String: Any]? {
        if let space = entry.space {
            let displays = ((index["Spaces"] as? [String: Any])?[space] as? [String: Any])?["Displays"] as? [String: Any]
            return displays?[entry.display] as? [String: Any]
        }
        return (index["Displays"] as? [String: Any])?[entry.display] as? [String: Any]
    }

    private static func set(_ content: [String: Any], for entry: Entry, in index: inout Index) -> Bool {
        guard var choice = choice(of: entry, in: index), var desktop = choice["Desktop"] as? [String: Any] else { return false }
        desktop["Content"] = content
        choice["Desktop"] = desktop
        if let space = entry.space {
            guard var spaces = index["Spaces"] as? [String: Any], var spaceEntry = spaces[space] as? [String: Any],
                  var displays = spaceEntry["Displays"] as? [String: Any] else { return false }
            displays[entry.display] = choice
            spaceEntry["Displays"] = displays
            spaces[space] = spaceEntry
            index["Spaces"] = spaces
        } else {
            guard var displays = index["Displays"] as? [String: Any] else { return false }
            displays[entry.display] = choice
            index["Displays"] = displays
        }
        return true
    }
}
