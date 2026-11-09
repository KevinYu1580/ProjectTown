import Foundation

/// The system's own wallpaper store, `~/Library/Application Support/com.apple.wallpaper/Store/Index.plist`.
///
/// Undocumented, so every read checks the shape and gives up (nil) on anything unexpected. It is used for what
/// `NSWorkspace` cannot do: set the town snapshot on every Space of a display at once (a Space that was never visited
/// would otherwise flash its own wallpaper), and put back dynamic and aerial wallpapers, which `NSWorkspace` only
/// reports as `DefaultDesktop.heic`. WallpaperAgent reads the file only when it starts, so a change needs a restart.
///
/// Layout: `Displays/<display>` holds a display's default, `Spaces/<space>/Displays/<display>` each Space's choice on
/// a display and `Spaces/<space>/Default` the Space's own default, which macOS keeps in step with what the Space shows
/// (the first desktop's Space is `""`). The wallpaper itself is `Desktop/Content`, whose first choice is either an image
/// (`Configuration` is a binary plist with `url.relative`) or something else, such as `com.apple.wallpaper.choice.aerials`.
/// Setting a wallpaper through `NSWorkspace` changes the display default and the current Space's default and display
/// entry. Entries of Spaces that no longer exist stay in the store.
public enum WallpaperStoreIndex {
    public typealias Index = [String: Any]

    /// One wallpaper choice in the store.
    public struct Entry: Hashable, Sendable {
        /// nil for a display's default.
        public let space: String?
        /// nil for a Space's default.
        public let display: String?

        public init(space: String?, display: String?) {
            self.space = space
            self.display = display
        }

        /// Stable key for saving the entry's original.
        public var id: String {
            switch (space, display) {
            case let (space?, display?): "space/\(space)/\(display)"
            case let (space?, nil): "space/\(space)/default"
            case let (nil, display?): "display/\(display)"
            case (nil, nil): "none"
            }
        }
    }

    public static func load(from url: URL) -> Index? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? Index
    }

    public static func save(_ index: Index, to url: URL) throws {
        let data = try PropertyListSerialization.data(fromPropertyList: index, format: .binary, options: 0)
        try data.write(to: url, options: .atomic)
    }

    /// Every entry of `display`: its default first, then each Space's choice on it.
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

    /// The entries behind what `space` shows on `display`: the display default, the Space's choice on it and the Space's
    /// own default, those that exist. The ones `NSWorkspace` changes for the current Space.
    public static func entries(ofSpace space: String, display: String, in index: Index) -> [Entry] {
        [Entry(space: nil, display: display), Entry(space: space, display: display), Entry(space: space, display: nil)]
            .filter { choice(of: $0, in: index) != nil }
    }

    /// Every Space's own default.
    public static func spaceDefaults(in index: Index) -> [Entry] {
        let spaces = index["Spaces"] as? [String: Any] ?? [:]
        return spaces.keys.sorted().filter { (spaces[$0] as? [String: Any])?["Default"] != nil }
            .map { Entry(space: $0, display: nil) }
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

    /// The image file a saved original shows; nil for an aerial or dynamic wallpaper.
    public static func imageURL(ofOriginal data: Data) -> URL? {
        decode(data).flatMap(imageURL(of:))
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

    /// The content of each of `entries` that does not show one of our files, as a binary plist.
    public static func originals(of entries: [Entry], in index: Index, isOurs: (URL) -> Bool) -> [String: Data] {
        var result: [String: Data] = [:]
        for entry in entries {
            guard let content = content(of: entry, in: index), !shows(content, isOurs),
                  let data = try? PropertyListSerialization.data(fromPropertyList: content, format: .binary, options: 0)
            else { continue }
            result[entry.id] = data
        }
        return result
    }

    /// Points the entries of `display` at `file`: its default and each Space's choice on it, or with `spaces` only
    /// those Spaces'. Returns the changed index and the original of each entry that did not show one of our files
    /// already, the Spaces' own defaults included (they are not changed, but macOS copies what a Space shows into
    /// them). Nil when the display has no entry or one has an unexpected shape; nothing is changed then.
    public static func cover(_ index: Index, display: String, spaces: Set<String>? = nil, with file: URL,
                             isOurs: (URL) -> Bool) -> (index: Index, originals: [String: Data])? {
        let entries = entries(of: display, in: index).filter { entry in entry.space.map { spaces?.contains($0) ?? true } ?? true }
        guard !entries.isEmpty else { return nil }
        let defaults = spaceDefaults(in: index).filter { entry in entry.space.map { spaces?.contains($0) ?? true } ?? false }
        let originals = originals(of: entries + defaults, in: index, isOurs: isOurs)
        var index = index
        for entry in entries {
            guard let content = content(of: entry, in: index), let covered = imageContent(file, like: content),
                  set(covered, for: entry, in: &index) else { return nil }
        }
        return (index, originals)
    }

    /// Whether every entry of `display` (with `spaces`, only those Spaces' and the display default), except those in
    /// `ignoring`, already shows one of our files.
    public static func isCovered(_ index: Index, display: String, spaces: Set<String>? = nil, ignoring: Set<String> = [],
                                 isOurs: (URL) -> Bool) -> Bool {
        let entries = entries(of: display, in: index).filter { entry in entry.space.map { spaces?.contains($0) ?? true } ?? true }
        return !entries.isEmpty && entries.allSatisfy { entry in
            ignoring.contains(entry.id) || content(of: entry, in: index).map { shows($0, isOurs) } ?? false
        }
    }

    /// Puts back every entry of `displays` that shows one of our files, and with `includeSpaceDefaults` every Space
    /// default too: its saved original, or else the plain image `fallback` gives for our file, or else what the entry
    /// came from (a Space created after the cover starts from the display default, a Space default from the Space's
    /// choice on a display or that display's default). Entries the user changed meanwhile are left alone, and with `only` so are entries whose id
    /// is not in it. Nil when nothing changed.
    public static func restore(_ index: Index, displays: Set<String>, only: Set<String>? = nil,
                               includeSpaceDefaults: Bool, originals: [String: Data],
                               isOurs: (URL) -> Bool, fallback: (URL) -> URL?) -> Index? {
        var index = index
        var changed = false
        let candidates = displays.sorted().flatMap { entries(of: $0, in: index) }
            + (includeSpaceDefaults ? spaceDefaults(in: index) : [])
        for entry in candidates where only?.contains(entry.id) ?? true {
            guard let content = content(of: entry, in: index), let shown = imageURL(of: content), isOurs(shown)
            else { continue }
            let inherited: Data? = switch (entry.space, entry.display) {
            case let (_?, display?): originals["display/\(display)"]
            case let (space?, nil):
                displays.sorted().lazy.compactMap { originals["space/\(space)/\($0)"] ?? originals["display/\($0)"] }.first
            default: nil
            }
            let restored = originals[entry.id].flatMap(decode)
                ?? fallback(shown).flatMap { imageContent($0, like: content) }
                ?? inherited.flatMap(decode)
            guard let restored, set(restored, for: entry, in: &index) else { continue }
            changed = true
        }
        return changed ? index : nil
    }

    // MARK: Private

    private static let imageProvider = "com.apple.wallpaper.choice.image"

    private static func shows(_ content: [String: Any], _ isOurs: (URL) -> Bool) -> Bool {
        imageURL(of: content).map(isOurs) ?? false
    }

    private static func decode(_ data: Data) -> [String: Any]? {
        (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any]
    }

    private static func choice(of entry: Entry, in index: Index) -> [String: Any]? {
        switch (entry.space, entry.display) {
        case let (space?, display):
            guard let spaceEntry = (index["Spaces"] as? [String: Any])?[space] as? [String: Any] else { return nil }
            guard let display else { return spaceEntry["Default"] as? [String: Any] }
            return (spaceEntry["Displays"] as? [String: Any])?[display] as? [String: Any]
        case let (nil, display?):
            return (index["Displays"] as? [String: Any])?[display] as? [String: Any]
        case (nil, nil):
            return nil
        }
    }

    private static func set(_ content: [String: Any], for entry: Entry, in index: inout Index) -> Bool {
        guard var choice = choice(of: entry, in: index), var desktop = choice["Desktop"] as? [String: Any] else { return false }
        desktop["Content"] = content
        choice["Desktop"] = desktop
        switch (entry.space, entry.display) {
        case let (space?, display):
            guard var spaces = index["Spaces"] as? [String: Any], var spaceEntry = spaces[space] as? [String: Any]
            else { return false }
            if let display {
                guard var displays = spaceEntry["Displays"] as? [String: Any] else { return false }
                displays[display] = choice
                spaceEntry["Displays"] = displays
            } else {
                spaceEntry["Default"] = choice
            }
            spaces[space] = spaceEntry
            index["Spaces"] = spaces
        case let (nil, display?):
            guard var displays = index["Displays"] as? [String: Any] else { return false }
            displays[display] = choice
            index["Displays"] = displays
        case (nil, nil):
            return false
        }
        return true
    }
}
