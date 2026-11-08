import AppKit
import SwiftUI

/// The settings window: SwiftUI in a plain `NSWindow`, brought to the front because the app is `LSUIElement`.
@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
    private let window: NSWindow
    private let store: SettingsStore
    private let wallpaper: WallpaperWindowController

    init(store: SettingsStore, wallpaper: WallpaperWindowController, updater: Updater) {
        self.store = store
        self.wallpaper = wallpaper
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 480),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered, defer: false
        )
        super.init()
        window.title = String(localized: "ProjectTown Settings")
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: SettingsView(store: store, wallpaper: wallpaper, updater: updater))
        window.setContentSize(NSSize(width: 640, height: 480))
        window.center()
        window.delegate = self
    }

    func show() {
        // While adjusting the view the wallpaper is floating above this window; taking key here would strand Esc.
        guard !wallpaper.editingCamera else { return }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        window.makeFirstResponder(nil)  // commits a number still being typed (IntField applies on focus loss)
        store.dismissNotice()  // the notice is shown once
    }
}
