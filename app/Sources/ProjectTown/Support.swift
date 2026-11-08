import AppKit

/// Donations: ProjectTown is free and open source, and asks for support in a few places but never on the wallpaper.
@MainActor
final class Support: NSObject {
    static let url = URL(string: "https://ko-fi.com/kevinyu1580")!
    private static let lastLaunchedVersionKey = "lastLaunchedVersion"

    private var alert: NSAlert?

    static func open() {
        NSWorkspace.shared.open(url)
    }

    /// Once per installed version: a welcome on the first launch, a short note after an update. Both ask for support.
    /// The alert is not modal: `runModal()` would hold up the main actor, and with it the update check and the town.
    func greetIfNeeded() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let defaults = UserDefaults.standard
        let last = defaults.string(forKey: Self.lastLaunchedVersionKey)
        guard last != version else { return }
        defaults.set(version, forKey: Self.lastLaunchedVersionKey)

        let alert = NSAlert()
        alert.messageText = last == nil
            ? String(localized: "Welcome to ProjectTown")
            : String(localized: "ProjectTown was updated to \(version)")
        alert.informativeText = String(localized: "ProjectTown is free and open source. If you enjoy your little town, you can buy me a coffee on Ko-fi to keep it growing. The link is always in the menu bar menu.")
        let donateButton = alert.addButton(withTitle: String(localized: "Support on Ko-fi"))
        let later = alert.addButton(withTitle: String(localized: "Not Now"))
        donateButton.target = self
        donateButton.action = #selector(donate)
        later.target = self
        later.action = #selector(close)
        alert.layout()
        alert.window.center()
        self.alert = alert
        NSApp.activate(ignoringOtherApps: true)
        alert.window.makeKeyAndOrderFront(nil)
    }

    @objc private func donate() {
        Self.open()
        close()
    }

    @objc private func close() {
        alert?.window.orderOut(nil)
        alert = nil
    }
}
