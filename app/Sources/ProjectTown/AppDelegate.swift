import AppKit
import ProjectTownCore
import os

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "AppDelegate")

    private var settings: SettingsStore?
    private var wallpaper: WallpaperWindowController?
    private var settingsWindow: SettingsWindowController?
    private var menuBar: MenuBarController?
    private var poller: Poller?
    private var updater: Updater?
    private let support = Support()

    /// An accessory app has no main menu, and AppKit routes Cmd+C/V/X/A/Z through the Edit menu's key equivalents,
    /// so without this the settings text fields ignore them. The menu bar stays hidden.
    private func installEditMenu() {
        let edit = NSMenu(title: "Edit")
        for (title, action, key, flags) in [
            ("Undo", Selector(("undo:")), "z", NSEvent.ModifierFlags.command),
            ("Redo", Selector(("redo:")), "z", [.command, .shift]),
            ("Cut", #selector(NSText.cut(_:)), "x", .command),
            ("Copy", #selector(NSText.copy(_:)), "c", .command),
            ("Paste", #selector(NSText.paste(_:)), "v", .command),
            ("Select All", #selector(NSText.selectAll(_:)), "a", .command),
        ] {
            let item = edit.addItem(withTitle: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = flags
        }
        let editItem = NSMenuItem()
        editItem.submenu = edit
        let mainMenu = NSMenu()
        mainMenu.addItem(editItem)
        NSApp.mainMenu = mainMenu
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installEditMenu()
        let cycleEpochMs = SystemClock().nowMs()
        let settings = SettingsStore()
        let wallpaper = WallpaperWindowController(config: settings.config, cycleEpochMs: cycleEpochMs)
        let updater = Updater()
        let settingsWindow = SettingsWindowController(store: settings, wallpaper: wallpaper, updater: updater)
        let menuBar = MenuBarController(wallpaper: wallpaper, updater: updater, showSettings: { [weak settingsWindow] in settingsWindow?.show() })
        let poller = Poller(
            config: { [settings] in settings.currentConfig() },
            onState: { [weak wallpaper] in wallpaper?.push(state: $0) }
        )
        settings.onChange = { [weak wallpaper, weak poller, weak updater] config in
            wallpaper?.apply(config: config)
            poller?.tickNow()
            updater?.setAutomaticChecks(config.checkForUpdates)
        }
        wallpaper.onCameraSaved = { [weak settings] camera in
            if let message = settings?.update({ $0.camera.base = camera }).message {
                Self.log.error("Rejected the saved camera: \(message, privacy: .public)")
            }
        }
        self.settings = settings
        self.wallpaper = wallpaper
        self.settingsWindow = settingsWindow
        self.menuBar = menuBar
        self.poller = poller
        self.updater = updater
        wallpaper.show()
        poller.start()
        updater.setAutomaticChecks(settings.config.checkForUpdates)
        support.greetIfNeeded()

        #if DEBUG
        if ProcessInfo.processInfo.environment["PROJECTTOWN_OPEN_SETTINGS"] == "1" { settingsWindow.show() }
        #endif
    }

    func applicationWillTerminate(_ notification: Notification) {
        wallpaper?.restoreSystemWallpaper()
    }
}
