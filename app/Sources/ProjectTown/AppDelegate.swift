import AppKit
import ProjectTownCore
import os

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "AppDelegate")

    private var wallpaper: WallpaperWindowController?
    private var menuBar: MenuBarController?
    private var poller: Poller?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let cycleEpochMs = SystemClock().nowMs()
        let store = ConfigStore()
        let config: AppConfig
        switch store.load() {
        case .loaded(let loaded), .createdDefault(let loaded):
            config = loaded
        case .recoveredFromBroken(let defaults, let backup):
            Self.log.error("config.json was unreadable, moved to \(backup.lastPathComponent, privacy: .public)")
            config = defaults
        }

        let wallpaper = WallpaperWindowController(config: config, cycleEpochMs: cycleEpochMs)
        let menuBar = MenuBarController(wallpaper: wallpaper, configURL: ConfigStore.defaultURL)
        let poller = Poller(
            initialConfig: config,
            onConfig: { [weak wallpaper] in wallpaper?.apply(config: $0) },
            onState: { [weak wallpaper] in wallpaper?.push(state: $0) }
        )
        self.wallpaper = wallpaper
        self.menuBar = menuBar
        self.poller = poller
        wallpaper.show()
        poller.start()
    }
}
