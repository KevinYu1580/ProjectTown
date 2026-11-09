import Foundation

/// Bookkeeping for `wallpaperSnapshot`: which system wallpapers are our snapshots, and what each Space showed before.
///
/// `NSWorkspace.setDesktopImageURL` only changes the current Space, and there is no public API to list Spaces. So the
/// snapshot files carry a slot in their name (`town-<slot>-<serial>.jpg`): a Space whose wallpaper is not ours gets a
/// new slot that remembers that wallpaper, and a Space that already shows one of our files keeps its slot. Any Space
/// still showing one of our files can then be put back by its slot. Pure value type; the app does the file and
/// AppKit work.
public struct WallpaperSnapshotLedger: Codable, Sendable, Equatable {
    /// A wallpaper as the system reported it, with the options needed to set it back the same way.
    public struct Original: Codable, Sendable, Equatable {
        public var url: URL
        /// `NSImageScaling` raw value.
        public var imageScaling: Int?
        public var allowClipping: Bool?

        public init(url: URL, imageScaling: Int? = nil, allowClipping: Bool? = nil) {
            self.url = url
            self.imageScaling = imageScaling
            self.allowClipping = allowClipping
        }
    }

    /// Slot → the wallpaper that Space had before our first snapshot.
    public private(set) var originals: [Int: Original]
    /// `WallpaperStoreIndex.Entry.id` → that entry's content before the town covered it (binary plist). Unlike
    /// `originals`, this also keeps dynamic and aerial wallpapers.
    public private(set) var storeOriginals: [String: Data]

    public init(originals: [Int: Original] = [:], storeOriginals: [String: Data] = [:]) {
        self.originals = originals
        self.storeOriginals = storeOriginals
    }

    private enum CodingKeys: String, CodingKey { case originals, storeOriginals }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        originals = try c.decode([Int: Original].self, forKey: .originals)
        storeOriginals = try c.decodeIfPresent([String: Data].self, forKey: .storeOriginals) ?? [:]
    }

    public var isEmpty: Bool { originals.isEmpty && storeOriginals.isEmpty }

    /// Remembers what the store entries showed before they were covered; replaces older originals of the same entry.
    public mutating func rememberStoreOriginals(_ newOriginals: [String: Data]) {
        storeOriginals.merge(newOriginals) { _, new in new }
    }

    public static func fileName(slot: Int, serial: Int64) -> String {
        "town-\(slot)-\(serial).jpg"
    }

    /// Slot and serial of a snapshot file name; nil for any other name.
    public static func parse(fileName: String) -> (slot: Int, serial: Int64)? {
        guard fileName.hasPrefix("town-"), fileName.hasSuffix(".jpg") else { return nil }
        let parts = fileName.dropFirst("town-".count).dropLast(".jpg".count).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              let slot = Int(parts[0]), let serial = Int64(parts[1]) else { return nil }
        return (slot, serial)
    }

    /// Whether `url` is a file in `directory`, such as a snapshot or the cover file.
    public static func isOurs(_ url: URL, in directory: URL) -> Bool {
        url.isFileURL && url.deletingLastPathComponent().resolvingSymlinksInPath().path == directory.resolvingSymlinksInPath().path
    }

    /// The slot of `url` when it is one of our snapshot files in `directory` (the file need not exist any more).
    public static func slot(of url: URL, in directory: URL) -> Int? {
        guard isOurs(url, in: directory) else { return nil }
        return parse(fileName: url.lastPathComponent)?.slot
    }

    /// Whether a wallpaper the system reports can be set back from its URL. Dynamic and aerial wallpapers all report
    /// `DefaultDesktop.heic`, and setting that file would replace them with the plain default picture.
    public static func canRestore(_ url: URL) -> Bool {
        url.standardizedFileURL.path != "/System/Library/CoreServices/DefaultDesktop.heic"
    }

    /// The slot for the next snapshot of the Space currently showing `current`. A wallpaper that is not ours gets a new
    /// slot and is remembered as that slot's original; `isNew` tells the caller to save the ledger before setting it.
    public mutating func slot(replacing current: Original, in directory: URL) -> (slot: Int, isNew: Bool) {
        if let slot = Self.slot(of: current.url, in: directory) { return (slot, false) }
        let slot = (originals.keys.max() ?? 0) + 1
        originals[slot] = current
        return (slot, true)
    }

    /// What to put back when a Space shows `url`: its slot's original if `url` is ours, nil otherwise. A slot taken
    /// over from the cover file has no original of its own (the store keeps it), so it gives nil too.
    public func original(toRestore url: URL, in directory: URL) -> Original? {
        Self.slot(of: url, in: directory).flatMap { originals[$0] }.flatMap { Self.isOurs($0.url, in: directory) ? nil : $0 }
    }

    /// How long a slot keeps its snapshots after the newest one: a Space or display not seen for that long (or gone)
    /// loses its files. Its original stays in the ledger, so it can still be put back.
    public static let unusedSlotLifetime: TimeInterval = 7 * 24 * 60 * 60

    /// Snapshot files to delete from `fileNames`: all but the `keep` newest of each slot, and every file of a slot whose
    /// newest snapshot is older than `unusedSlotLifetime` at `now`. Other names are never listed.
    public static func obsoleteFiles(_ fileNames: [String], keep: Int = 2, now: Date) -> [String] {
        let snapshots = fileNames.compactMap { name in parse(fileName: name).map { (name, $0.slot, $0.serial) } }
        let cutoff = Int64((now.timeIntervalSince1970 - unusedSlotLifetime) * 1000)  // serials are milliseconds
        return Dictionary(grouping: snapshots, by: \.1).values.flatMap { files in
            let newestFirst = files.sorted { $0.2 > $1.2 }
            return newestFirst.dropFirst(newestFirst[0].2 < cutoff ? 0 : keep).map(\.0)
        }
    }

    /// The saved ledger; empty when the file is missing or unreadable.
    public static func load(from fileURL: URL) -> WallpaperSnapshotLedger {
        guard let data = try? Data(contentsOf: fileURL) else { return WallpaperSnapshotLedger() }
        return (try? JSONDecoder().decode(WallpaperSnapshotLedger.self, from: data)) ?? WallpaperSnapshotLedger()
    }

    public func save(to fileURL: URL) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(self).write(to: fileURL, options: .atomic)
    }
}
