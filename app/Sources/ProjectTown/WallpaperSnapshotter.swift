import AppKit
import ImageIO
import ProjectTownCore
import UniformTypeIdentifiers
import WebKit
import os

/// `wallpaperSnapshot`: keeps the system wallpaper of the town's display set to a recent snapshot of the town.
///
/// macOS sometimes skips drawing the desktop-level window while swiping between Spaces or entering and leaving Mission
/// Control, and shows the system wallpaper for up to a second; only the system wallpaper is drawn every time.
/// `setDesktopImageURL` changes just the current Space of a screen, so each Space's own wallpaper is remembered by slot
/// (`WallpaperSnapshotLedger`) and put back when the option is off, on quit, and when the town moves to another display.
/// Does nothing while the town is not visible (occluded, full-screen Space, paused, camera edit): `active` is false.
/// The lock screen shows each display's wallpaper, so it shows the town too: nothing changes on locking or unlocking,
/// which would otherwise switch wallpapers on screen twice.
/// Never puts a wallpaper back on a full-screen Space, and waits while displays come and go: macOS moves Spaces between
/// displays then, and a Space reporting one of our files is not necessarily the one we set it on.
///
/// `NSWorkspace` reaches only the current Space, so a Space not visited since its wallpaper changed would still flash
/// it, and it cannot put back dynamic or aerial wallpapers. Where the system's wallpaper store can be read
/// (`WallpaperStoreIndex`), every Space of the town's display is covered at once and each one's choice is kept there,
/// aerial wallpapers included; putting back goes through the store too. Both restart WallpaperAgent, which redraws every
/// display, so they are kept for real changes: the first snapshot, a wallpaper picked for every Space, the town moving,
/// quitting. The Space on screen is handled through NSWorkspace, which fades without a restart, wherever it can be.
@MainActor
final class WallpaperSnapshotter {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "WallpaperSnapshotter")
    private static let directory = ConfigStore.defaultURL.deletingLastPathComponent()
        .appendingPathComponent("Wallpaper", isDirectory: true)
    private static let ledgerURL = directory.appendingPathComponent("slots.json")
    private static let storeURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/com.apple.wallpaper/Store/Index.plist")
    /// Lets the scene draw after it became visible or changed look, and lets a Space switch settle.
    private static let settleDelay: Duration = .seconds(1.5)
    private static let refreshInterval: Duration = .seconds(300)
    /// How long macOS gets to move Spaces between displays after one is connected, removed or rearranged.
    private static let screensSettleDelay: Duration = .seconds(2)

    private let window: NSWindow
    private let webView: WKWebView
    private var ledger: WallpaperSnapshotLedger
    private var enabled: Bool
    private var active = false
    private var locked = false
    /// The next capture: soon after a change, otherwise the periodic refresh. Only exists while `live`.
    private var pending: Task<Void, Never>?
    /// Waits out a display change, then puts wallpapers back and captures again. Nothing is set meanwhile.
    private var screensSettling: Task<Void, Never>?
    /// Bumped when the Space, screen or activity changes, so a capture in flight is never set on the wrong Space.
    private var generation = 0
    /// Whether the cover file was redrawn since launch; one written by an older version may still show the signs.
    private var coverRedrawn = false

    private var live: Bool { enabled && active && !locked && screensSettling == nil }

    init(window: NSWindow, webView: WKWebView, enabled: Bool) {
        self.window = window
        self.webView = webView
        self.enabled = enabled
        ledger = WallpaperSnapshotLedger.load(from: Self.ledgerURL)
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.activeSpaceDidChange() }
        }
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        }
        for (name, value) in [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)] {
            DistributedNotificationCenter.default().addObserver(
                forName: Notification.Name(name), object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.setLocked(value) }
            }
        }
        removeObsoleteFiles()  // also while the option stays off, when nothing new is set
        if !enabled { restoreAll() }  // turned off while the app was not running
        // Quitting put every wallpaper back. Once the window is on screen, desktops out of sight get the town again.
        Task { [weak self] in
            try? await Task.sleep(for: Self.screensSettleDelay)
            self?.coverDesktopsWithLastSnapshot()
        }
    }

    func setEnabled(_ value: Bool) {
        guard value != enabled else { return }
        enabled = value
        if enabled {
            if live { schedule(after: Self.settleDelay) }
        } else {
            cancel()
            restoreAll()
        }
    }

    /// True while the town is visible on the active Space and rendering (not paused, not in camera edit).
    func setActive(_ value: Bool) {
        guard value != active else { return }
        active = value
        if active {
            if live { schedule(after: Self.settleDelay) }
        } else {
            cancel()
        }
    }

    /// A setting that changes what the scene draws.
    func sceneLookChanged() {
        if live { schedule(after: Self.settleDelay) }
    }

    /// The window moved to another display: the previous one gets its wallpaper back once the displays settle.
    func townMoved() {
        screensChanged()
    }

    /// On quit: every screen whose current Space shows one of our snapshots gets its own wallpaper back.
    func restoreAll() {
        guard !ledger.isEmpty else { return }
        if let index = WallpaperStoreIndex.load(from: Self.storeURL),
           restoreStore(displays: WallpaperStoreIndex.displays(in: index), includeSpaceDefaults: true) { return }
        for screen in NSScreen.screens { restore(screen) }
    }

    // MARK: Private

    private func setLocked(_ value: Bool) {
        guard value != locked else { return }
        locked = value
        if locked {
            cancel()
        } else if live {
            schedule(after: Self.settleDelay)
        }
    }

    private func activeSpaceDidChange() {
        generation += 1
        guard screensSettling == nil else { return }  // Spaces still moving; `screensChanged` catches up
        putBackOthers()
    }

    private func screensChanged() {
        cancel()
        screensSettling?.cancel()
        screensSettling = Task { [weak self] in
            try? await Task.sleep(for: Self.screensSettleDelay)
            guard !Task.isCancelled, let self else { return }
            self.screensSettling = nil
            self.putBackOthers()
        }
    }

    /// A Space left showing our snapshot (option off, or the town is on another display now) gets its wallpaper back.
    private func putBackOthers() {
        guard enabled || !ledger.isEmpty else { return }
        let town = enabled ? window.screen : nil
        let townDisplay = town.flatMap(Displays.uuid(of:))
        if let index = WallpaperStoreIndex.load(from: Self.storeURL),
           restoreStore(displays: WallpaperStoreIndex.displays(in: index).filter { $0 != townDisplay },
                        includeSpaceDefaults: false) {
            // The store had our files on other displays and has them back; NSWorkspace would only see a stale state.
        } else {
            for screen in NSScreen.screens where screen != town { restore(screen) }
        }
        if live { schedule(after: Self.settleDelay) } else { coverDesktopsWithLastSnapshot() }
    }

    private func cancel() {
        pending?.cancel()
        pending = nil
        generation += 1
    }

    private func schedule(after delay: Duration) {
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            await self.capture()
            guard !Task.isCancelled, self.live else { return }
            self.schedule(after: Self.refreshInterval)
        }
    }

    private func restore(_ screen: NSScreen) {
        let workspace = NSWorkspace.shared
        guard let current = workspace.desktopImageURL(for: screen),
              let original = ledger.original(toRestore: current, in: Self.directory) else { return }
        // A full-screen Space without a wallpaper of its own reports the desktop's, so it may well show "our" file;
        // setting the original there would hand it some other Space's wallpaper, which then travels with the app.
        guard !Self.fullScreenSpaceShown(on: screen) else {
            Self.log.debug("Skipped a restore: a full-screen Space is current")
            return
        }
        var options: [NSWorkspace.DesktopImageOptionKey: Any] = [:]
        if let scaling = original.imageScaling { options[.imageScaling] = scaling }
        if let clipping = original.allowClipping { options[.allowClipping] = clipping }
        do {
            try workspace.setDesktopImageURL(original.url, for: screen, options: options)
        } catch {
            Self.log.error("Cannot restore the wallpaper: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func capture() async {
        let workspace = NSWorkspace.shared
        guard live, let screen = window.screen, let current = workspace.desktopImageURL(for: screen) else { return }
        let screenDisplay = Displays.uuid(of: screen)
        let store = WallpaperStoreIndex.load(from: Self.storeURL)
        let spaces = screenDisplay.flatMap { Spaces.byDisplay()?[$0] }
        // The entries behind the Space on screen, which NSWorkspace sets below.
        var onScreen: [WallpaperStoreIndex.Entry] = []
        if let store, let screenDisplay, let spaces, spaces.currentIsDesktop, let space = spaces.current {
            onScreen = WallpaperStoreIndex.entries(ofSpace: space, display: screenDisplay, in: store)
        }
        // NSWorkspace cannot put a dynamic or aerial wallpaper back; only the store can.
        let restorable = WallpaperSnapshotLedger.canRestore(current)
        guard restorable || (store != nil && screenDisplay != nil) else {
            Self.log.debug("Skipped a snapshot: the wallpaper cannot be put back")
            return
        }
        let generation = self.generation
        let space = spaceAround()
        guard !space.fullScreen else {
            Self.log.debug("Skipped a snapshot: a full-screen Space is current")
            return
        }

        guard let cgImage = await townWithoutText(), generation == self.generation else { return }
        // Keep what the Space on screen shows before the snapshot replaces it, aerial wallpapers included.
        var keptOriginals = false
        if let store, !onScreen.isEmpty {
            let kept = WallpaperStoreIndex.originals(of: onScreen, in: store, isOurs: Self.isOurs)
            ledger.rememberStoreOriginals(kept)
            keptOriginals = !kept.isEmpty
        }
        // Nothing could be kept for this Space (its Spaces are unknown): the store covers every Space and keeps them all.
        if !restorable && onScreen.isEmpty {
            await coverAllSpaces(of: screen, with: cgImage, spaces: spaces?.desktops)
            return
        }
        let display = screenDisplay ?? ""  // empty only when the store is not used

        let options = workspace.desktopImageOptions(for: screen) ?? [:]
        // A wallpaper NSWorkspace cannot set back stands in as our cover file, which restores nothing: the store does.
        let original = restorable
            ? WallpaperSnapshotLedger.Original(url: current, imageScaling: (options[.imageScaling] as? NSNumber)?.intValue,
                                              allowClipping: (options[.allowClipping] as? NSNumber)?.boolValue)
            : WallpaperSnapshotLedger.Original(url: Self.coverFile(for: display))
        let (slot, isNew) = ledger.slot(replacing: original, in: Self.directory)
        let serial = Int64(Date().timeIntervalSince1970 * 1000)  // a new URL every time: macOS caches by URL
        let file = Self.directory.appendingPathComponent(WallpaperSnapshotLedger.fileName(slot: slot, serial: serial))
        do {
            // The original must be on disk before our file replaces it.
            if isNew || keptOriginals { try ledger.save(to: Self.ledgerURL) }
            try FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        } catch {
            Self.log.error("Cannot save the wallpaper slots: \(error.localizedDescription, privacy: .public)")
            return
        }

        let width = Int((screen.frame.width * screen.backingScaleFactor).rounded())
        let height = Int((screen.frame.height * screen.backingScaleFactor).rounded())
        let written = await Task.detached(priority: .utility) {
            Self.writeJPEG(cgImage, width: width, height: height, to: file)
        }.value
        guard written else {
            Self.log.error("Cannot write the snapshot \(file.lastPathComponent, privacy: .public)")
            return
        }
        // Still the same Space, still visible, and the user did not pick a new wallpaper meanwhile.
        guard generation == self.generation, live, workspace.desktopImageURL(for: screen) == current else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        // `setDesktopImageURL` changes whatever Space is current at this moment, and the notifications behind
        // `generation` and `active` can arrive after a switch: ask the window server.
        guard spaceAround() == space else {
            Self.log.debug("Skipped a snapshot: the Space changed while it was taken")
            try? FileManager.default.removeItem(at: file)
            return
        }
        do {
            try workspace.setDesktopImageURL(file, for: screen, options: [
                .imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue,
                .allowClipping: true,
            ])
        } catch {
            Self.log.error("Cannot set the wallpaper: \(error.localizedDescription, privacy: .public)")
            try? FileManager.default.removeItem(at: file)
            return
        }
        removeObsoleteFiles()
        if !coverRedrawn, !display.isEmpty, FileManager.default.fileExists(atPath: Self.coverFile(for: display).path) {
            coverRedrawn = true
            let cover = Self.coverFile(for: display)
            _ = await Task.detached(priority: .utility) { Self.writeJPEG(cgImage, width: width, height: height, to: cover) }.value
        }
        // The other Spaces of this display that do not show the town yet: never covered, a wallpaper picked for every
        // Space, the town moved here. The Space on screen was just set, whatever the store says about it so far.
        if let store, !display.isEmpty,
           !WallpaperStoreIndex.isCovered(store, display: display, spaces: spaces?.desktops,
                                          ignoring: Set(onScreen.map(\.id)), isOurs: Self.isOurs) {
            await coverAllSpaces(of: screen, with: cgImage, spaces: spaces?.desktops)
        }
    }

    /// The town as the scene draws it for the wallpaper: the 3D model without signs and name labels, which the lock
    /// screen would otherwise show to anyone. Nil before the scene's first frame or when it cannot draw.
    private func townWithoutText() async -> CGImage? {
        let url: String? = await withCheckedContinuation { continuation in
            webView.callAsyncJavaScript("return window.projectTown?.snapshot() ?? null", arguments: [:], in: nil,
                                        in: .page) { result in
                switch result {
                case .success(let value): continuation.resume(returning: value as? String)
                case .failure(let error):
                    Self.log.error("Snapshot failed: \(error.localizedDescription, privacy: .public)")
                    continuation.resume(returning: nil)
                }
            }
        }
        guard let url, let comma = url.firstIndex(of: ","),
              let data = Data(base64Encoded: String(url[url.index(after: comma)...])),
              let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }

    /// Puts the snapshot on the desktops of `screen` (all its Spaces in the store when `spaces` is unknown) through the
    /// wallpaper store, keeping what each showed, and restarts WallpaperAgent to read it.
    private func coverAllSpaces(of screen: NSScreen, with image: CGImage, spaces: Set<String>?) async {
        guard enabled, !locked, let display = Displays.uuid(of: screen) else { return }
        let file = Self.coverFile(for: display)
        let width = Int((screen.frame.width * screen.backingScaleFactor).rounded())
        let height = Int((screen.frame.height * screen.backingScaleFactor).rounded())
        let written = await Task.detached(priority: .utility) {
            Self.writeJPEG(image, width: width, height: height, to: file)
        }.value
        guard written, live else { return }
        cover(display, spaces: spaces, with: file)
    }

    /// While the town is out of sight (a full-screen app in front, or just launched), the desktops of its display that
    /// do not show the town yet get the last snapshot, so the first swipe to one does not flash. With the town in
    /// sight, a fresh snapshot does this instead.
    private func coverDesktopsWithLastSnapshot() {
        guard enabled, !locked, !active, screensSettling == nil, let screen = window.screen,
              let display = Displays.uuid(of: screen), let spaces = Spaces.byDisplay()?[display], !spaces.desktops.isEmpty,
              let index = WallpaperStoreIndex.load(from: Self.storeURL),
              !WallpaperStoreIndex.isCovered(index, display: display, spaces: spaces.desktops, isOurs: Self.isOurs)
        else { return }
        let file = Self.coverFile(for: display)
        guard FileManager.default.fileExists(atPath: file.path) else { return }
        cover(display, spaces: spaces.desktops, with: file)
    }

    /// Points the store entries of `display` (only those of `spaces` when known) at `file`, keeps their originals and
    /// restarts WallpaperAgent to read the change.
    private func cover(_ display: String, spaces: Set<String>?, with file: URL) {
        // Read the store only now: WallpaperAgent may have written it meanwhile.
        guard let latest = WallpaperStoreIndex.load(from: Self.storeURL),
              let result = WallpaperStoreIndex.cover(latest, display: display, spaces: spaces, with: file, isOurs: Self.isOurs)
        else {
            Self.log.error("Cannot cover the Spaces of \(display, privacy: .public)")
            return
        }
        ledger.rememberStoreOriginals(result.originals)
        do {
            // The originals must be on disk before the store loses them.
            try ledger.save(to: Self.ledgerURL)
            try WallpaperStoreIndex.save(result.index, to: Self.storeURL)
        } catch {
            Self.log.error("Cannot cover the Spaces: \(error.localizedDescription, privacy: .public)")
            return
        }
        Self.restartWallpaperAgent()
        Self.log.info("Covered the Spaces of \(display, privacy: .public), \(result.originals.count) new originals")
    }

    /// Puts back what each Space of `displays` showed before, where it still shows one of our files. True when the
    /// store changed.
    @discardableResult
    private func restoreStore(displays: Set<String>, only: Set<String>? = nil, includeSpaceDefaults: Bool) -> Bool {
        guard !displays.isEmpty, let index = WallpaperStoreIndex.load(from: Self.storeURL),
              let restored = WallpaperStoreIndex.restore(
                  index, displays: displays, only: only, includeSpaceDefaults: includeSpaceDefaults,
                  originals: ledger.storeOriginals, isOurs: Self.isOurs,
                  fallback: { ledger.original(toRestore: $0, in: Self.directory)?.url }
              ) else { return false }
        do {
            try WallpaperStoreIndex.save(restored, to: Self.storeURL)
        } catch {
            Self.log.error("Cannot restore the wallpaper store: \(error.localizedDescription, privacy: .public)")
            return false
        }
        Self.restartWallpaperAgent()
        return true
    }

    private static func isOurs(_ url: URL) -> Bool {
        WallpaperSnapshotLedger.isOurs(url, in: directory)
    }

    /// One file per display, apart from the slot files so cleanup never removes it; the covered Spaces all point here.
    private static func coverFile(for display: String) -> URL {
        directory.appendingPathComponent("cover-\(display).jpg")
    }

    /// WallpaperAgent reads its store only when it starts; launchd starts it again right away.
    private static func restartWallpaperAgent() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
        process.arguments = ["WallpaperAgent"]
        do { try process.run() } catch {
            log.error("Cannot restart WallpaperAgent: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Keeps the current and the previous snapshot of each slot, and none of a slot without a snapshot for a week.
    private func removeObsoleteFiles() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.directory.path)) ?? []
        for name in WallpaperSnapshotLedger.obsoleteFiles(names, now: Date()) {
            try? FileManager.default.removeItem(at: Self.directory.appendingPathComponent(name))
        }
    }

    /// What the window server shows around the town right now.
    private struct SpaceAround: Equatable {
        /// On-screen windows below the town: the current Space's own wallpaper window and the display backstop. The set
        /// changes with the Space, and holds two wallpapers while a switch is under way.
        var below: Set<Int>
        /// A full-screen app's Space, whose backdrop covers the town. Its wallpaper is never seen, and a snapshot set
        /// there would stay on a Space the ledger does not know.
        var fullScreen: Bool
    }

    private func spaceAround() -> SpaceAround {
        let id = CGWindowID(window.windowNumber)
        func windows(_ option: CGWindowListOption) -> [[String: Any]] {
            CGWindowListCopyWindowInfo(option, id) as? [[String: Any]] ?? []
        }
        let below = Set(windows(.optionOnScreenBelowWindow).compactMap { $0[kCGWindowNumber as String] as? Int })
        let fullScreen = windows(.optionIncludingWindow).first.flatMap(Self.bounds).map { town in
            Self.backdropCovers(town, among: windows(.optionOnScreenAboveWindow))
        } ?? false
        return SpaceAround(below: below, fullScreen: fullScreen)
    }

    /// Whether `screen`'s current Space is a full-screen app's.
    private static func fullScreenSpaceShown(on screen: NSScreen) -> Bool {
        guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else {
            return false
        }
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
        return backdropCovers(CGDisplayBounds(id), among: windows)
    }

    /// Between the desktop and its icons, only a full-screen Space's backdrop covers a whole screen.
    private static func backdropCovers(_ rect: CGRect, among windows: [[String: Any]]) -> Bool {
        let band = Int(CGWindowLevelForKey(.desktopWindow)) + 1..<Int(CGWindowLevelForKey(.desktopIconWindow))
        return windows.contains { info in
            guard let layer = info[kCGWindowLayer as String] as? Int, band.contains(layer), let bounds = bounds(info)
            else { return false }
            return bounds.contains(rect)
        }
    }

    private static func bounds(_ info: [String: Any]) -> CGRect? {
        (info[kCGWindowBounds as String] as? NSDictionary).flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) }
    }

    /// JPEG (quality 0.85) at the screen's pixel size, off the main thread.
    nonisolated private static func writeJPEG(_ image: CGImage, width: Int, height: Int, to url: URL) -> Bool {
        let space = image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil } ?? CGColorSpace(name: CGColorSpace.sRGB)!
        guard width > 0, height > 0,
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage(),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
        else { return false }
        CGImageDestinationAddImage(destination, scaled, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        return CGImageDestinationFinalize(destination)
    }
}
