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
@MainActor
final class WallpaperSnapshotter {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "WallpaperSnapshotter")
    private static let directory = ConfigStore.defaultURL.deletingLastPathComponent()
        .appendingPathComponent("Wallpaper", isDirectory: true)
    private static let ledgerURL = directory.appendingPathComponent("slots.json")
    /// Lets the scene draw after it became visible or changed look, and lets a Space switch settle.
    private static let settleDelay: Duration = .seconds(1.5)
    private static let refreshInterval: Duration = .seconds(300)

    private let window: NSWindow
    private let webView: WKWebView
    private var ledger: WallpaperSnapshotLedger
    private var enabled: Bool
    private var active = false
    /// The next capture: soon after a change, otherwise the periodic refresh. Only exists while enabled and active.
    private var pending: Task<Void, Never>?
    /// Bumped when the Space, screen or activity changes, so a capture in flight is never set on the wrong Space.
    private var generation = 0

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
        if !enabled { restoreAll() }  // turned off while the app was not running
    }

    func setEnabled(_ value: Bool) {
        guard value != enabled else { return }
        enabled = value
        if enabled {
            if active { schedule(after: Self.settleDelay) }
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
            if enabled { schedule(after: Self.settleDelay) }
        } else {
            cancel()
        }
    }

    /// A setting that changes what the scene draws.
    func sceneLookChanged() {
        if enabled && active { schedule(after: Self.settleDelay) }
    }

    /// The window moved from `previous` to another display: give `previous`'s current Space its wallpaper back.
    func townMoved(from previous: NSScreen) {
        generation += 1
        if NSScreen.screens.contains(previous) { restore(previous) }
        if enabled && active { schedule(after: Self.settleDelay) }
    }

    /// On quit: every screen whose current Space shows one of our snapshots gets its own wallpaper back.
    func restoreAll() {
        guard !ledger.isEmpty else { return }
        for screen in NSScreen.screens { restore(screen) }
    }

    // MARK: Private

    private func activeSpaceDidChange() {
        generation += 1
        guard enabled || !ledger.isEmpty else { return }
        // A Space left showing our snapshot (option off, or the town is on another display now) gets its wallpaper back.
        let town = enabled ? window.screen : nil
        for screen in NSScreen.screens where screen != town { restore(screen) }
        if enabled && active { schedule(after: Self.settleDelay) }
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
            guard !Task.isCancelled, self.enabled, self.active else { return }
            self.schedule(after: Self.refreshInterval)
        }
    }

    private func restore(_ screen: NSScreen) {
        let workspace = NSWorkspace.shared
        guard let current = workspace.desktopImageURL(for: screen),
              let original = ledger.original(toRestore: current, in: Self.directory) else { return }
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
        guard enabled, active, let screen = window.screen, let current = workspace.desktopImageURL(for: screen) else { return }
        let generation = self.generation
        let space = spaceAround()
        guard !space.fullScreen else {
            Self.log.debug("Skipped a snapshot: a full-screen Space is current")
            return
        }

        let image: NSImage
        do {
            image = try await webView.takeSnapshot(configuration: nil)
        } catch {
            Self.log.error("Snapshot failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard generation == self.generation, let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else { return }

        let options = workspace.desktopImageOptions(for: screen) ?? [:]
        let original = WallpaperSnapshotLedger.Original(
            url: current, imageScaling: (options[.imageScaling] as? NSNumber)?.intValue,
            allowClipping: (options[.allowClipping] as? NSNumber)?.boolValue
        )
        let (slot, isNew) = ledger.slot(replacing: original, in: Self.directory)
        let serial = Int64(Date().timeIntervalSince1970 * 1000)  // a new URL every time: macOS caches by URL
        let file = Self.directory.appendingPathComponent(WallpaperSnapshotLedger.fileName(slot: slot, serial: serial))
        do {
            // The original must be on disk before our file replaces it.
            if isNew { try ledger.save(to: Self.ledgerURL) }
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
        guard generation == self.generation, enabled, active, workspace.desktopImageURL(for: screen) == current else {
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
    }

    /// Keeps the current and the previous snapshot of each slot.
    private func removeObsoleteFiles() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.directory.path)) ?? []
        for name in WallpaperSnapshotLedger.obsoleteFiles(names) {
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
        func bounds(_ info: [String: Any]) -> CGRect? {
            (info[kCGWindowBounds as String] as? NSDictionary).flatMap { CGRect(dictionaryRepresentation: $0 as CFDictionary) }
        }
        let below = Set(windows(.optionOnScreenBelowWindow).compactMap { $0[kCGWindowNumber as String] as? Int })
        // Between the desktop and its icons, only a full-screen Space's backdrop covers the whole screen.
        let band = Int(CGWindowLevelForKey(.desktopWindow)) + 1..<Int(CGWindowLevelForKey(.desktopIconWindow))
        let fullScreen = windows(.optionIncludingWindow).first.flatMap(bounds).map { town in
            windows(.optionOnScreenAboveWindow).contains { info in
                guard let layer = info[kCGWindowLayer as String] as? Int, band.contains(layer), let rect = bounds(info)
                else { return false }
                return rect.contains(town)
            }
        } ?? false
        return SpaceAround(below: below, fullScreen: fullScreen)
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
