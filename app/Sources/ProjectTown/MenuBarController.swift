import AppKit

/// Status item with a single template icon and no badge.
@MainActor
final class MenuBarController: NSObject, NSMenuDelegate {
    private static let repositoryURL = URL(string: "https://github.com/KevinYu1580/ProjectTown")!

    private let wallpaper: WallpaperWindowController
    private let openSettingsWindow: () -> Void
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let pauseItem = NSMenuItem()
    private let updater: Updater
    private let updateItem = NSMenuItem()

    init(wallpaper: WallpaperWindowController, updater: Updater, showSettings: @escaping () -> Void) {
        self.wallpaper = wallpaper
        self.updater = updater
        self.openSettingsWindow = showSettings
        super.init()

        statusItem.button?.image = Self.houseIcon()

        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        updateItem.target = self
        updateItem.action = #selector(installUpdate)
        updateItem.image = NSImage(systemSymbolName: "exclamationmark.circle", accessibilityDescription: nil)
        menu.addItem(updateItem)
        menu.addItem(item(String(localized: "Open Settings…"), #selector(openSettings), key: ","))
        menu.addItem(item(String(localized: "Adjust View"), #selector(adjustView)))
        pauseItem.target = self
        pauseItem.action = #selector(togglePause)
        menu.addItem(pauseItem)
        menu.addItem(item(String(localized: "Reload Scene"), #selector(reloadScene)))
        menu.addItem(.separator())
        menu.addItem(item(String(localized: "Support ProjectTown…"), #selector(openSupport)))
        menu.addItem(item(String(localized: "About ProjectTown"), #selector(showAbout)))
        menu.addItem(.separator())
        menu.addItem(item(String(localized: "Quit ProjectTown"), #selector(NSApplication.terminate(_:)), key: "q", target: NSApp))
        statusItem.menu = menu
        refreshPauseTitle()
        refreshUpdateItem()
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        refreshPauseTitle()
        refreshUpdateItem()
    }

    /// Shown at the top only while a newer release is waiting.
    private func refreshUpdateItem() {
        if case .available = updater.status {
            updateItem.title = String(localized: "New Version Available! Install and Restart")
            updateItem.isHidden = false
        } else {
            updateItem.isHidden = true
        }
    }

    @objc private func installUpdate() {
        guard case .available = updater.status else { return }
        Task { await updater.install() }
    }

    @objc private func openSupport() {
        Support.open()
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
        openSettingsWindow()
    }

    @objc private func adjustView() {
        wallpaper.enterCameraEdit()
    }

    @objc private func togglePause() {
        wallpaper.setUserPaused(!wallpaper.userPaused)
        refreshPauseTitle()
    }

    @objc private func reloadScene() {
        wallpaper.reloadScene()
    }

    /// The app icon's isometric house (AppIcon.icon/Assets/house.svg) as a template:
    /// solid roof and right wall, a lighter left wall, the door cut out.
    private static func houseIcon() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { _ in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            ctx.translateBy(x: 9, y: 9)
            ctx.scaleBy(x: 16 / 29, y: 16 / 29)
            ctx.translateBy(x: -46, y: -53.5)
            func fill(_ points: [(CGFloat, CGFloat)], alpha: CGFloat, blend: CGBlendMode = .normal) {
                ctx.setBlendMode(blend)
                ctx.setFillColor(NSColor.black.withAlphaComponent(alpha).cgColor)
                ctx.addLines(between: points.map { CGPoint(x: $0.0, y: $0.1) })
                ctx.fillPath()
            }
            fill([(46, 58), (58, 52), (58, 62), (46, 68)], alpha: 1)
            fill([(46, 58), (58, 52), (52, 45)], alpha: 1)
            fill([(34, 52), (46, 58), (52, 45), (40, 39)], alpha: 1)
            fill([(34, 52), (46, 58), (46, 68), (34, 62)], alpha: 0.75)
            let door: [(CGFloat, CGFloat)] = [(38, 59), (41, 60.5), (41, 65.5), (38, 64)]
            fill(door, alpha: 1, blend: .clear)
            fill(door, alpha: 0.2)
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "ProjectTown"
        return image
    }

    @objc private func showAbout() {
        let link = Self.repositoryURL
        let credits = NSMutableAttributedString(string: link.absoluteString)
        credits.addAttribute(.link, value: link, range: NSRange(location: 0, length: credits.length))
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }
}
