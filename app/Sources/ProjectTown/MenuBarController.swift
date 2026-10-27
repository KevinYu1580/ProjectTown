import AppKit

/// Status item with a single template icon and no badge (HANDOFF §7.4).
@MainActor
final class MenuBarController: NSObject, NSMenuDelegate {
    private static let repositoryURL = URL(string: "https://github.com/KevinYu1580/ProjectTown")!

    private let wallpaper: WallpaperWindowController
    private let configURL: URL
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let pauseItem = NSMenuItem()

    init(wallpaper: WallpaperWindowController, configURL: URL) {
        self.wallpaper = wallpaper
        self.configURL = configURL
        super.init()

        if let button = statusItem.button {
            let image = NSImage(systemSymbolName: "house.fill", accessibilityDescription: "ProjectTown")
            image?.isTemplate = true
            button.image = image
        }

        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        // M3 replaces this with the settings window; for now it opens config.json in the default editor.
        menu.addItem(item(String(localized: "Open Settings…"), #selector(openSettings), key: ","))
        let adjust = item(String(localized: "Adjust View"), nil)
        adjust.isEnabled = false
        menu.addItem(adjust)
        pauseItem.target = self
        pauseItem.action = #selector(togglePause)
        menu.addItem(pauseItem)
        menu.addItem(item(String(localized: "Reload Scene"), #selector(reloadScene)))
        menu.addItem(.separator())
        menu.addItem(item(String(localized: "About ProjectTown"), #selector(showAbout)))
        menu.addItem(.separator())
        menu.addItem(item(String(localized: "Quit ProjectTown"), #selector(NSApplication.terminate(_:)), key: "q", target: NSApp))
        statusItem.menu = menu
        refreshPauseTitle()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        refreshPauseTitle()
    }

    private func item(_ title: String, _ action: Selector?, key: String = "", target: AnyObject? = nil) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: key)
        menuItem.target = target ?? self
        menuItem.isEnabled = action != nil
        return menuItem
    }

    private func refreshPauseTitle() {
        pauseItem.title = wallpaper.userPaused
            ? String(localized: "Resume Rendering")
            : String(localized: "Pause Rendering")
    }

    @objc private func openSettings() {
        NSWorkspace.shared.open(configURL)
    }

    @objc private func togglePause() {
        wallpaper.setUserPaused(!wallpaper.userPaused)
        refreshPauseTitle()
    }

    @objc private func reloadScene() {
        wallpaper.reloadScene()
    }

    @objc private func showAbout() {
        let link = Self.repositoryURL
        let credits = NSMutableAttributedString(string: link.absoluteString)
        credits.addAttribute(.link, value: link, range: NSRange(location: 0, length: credits.length))
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }
}
