import AppKit

/// Display lookup by UUID (`CGDisplayCreateUUIDFromDisplayID`), shared by the wallpaper window and the settings UI.
enum Displays {
    /// The default target: the display with the menu bar (`NSScreen.main` follows keyboard focus instead).
    static var primary: NSScreen? { NSScreen.screens.first }

    /// The screen with this UUID; the primary display when `displayUUID` is nil or no longer connected.
    static func screen(for displayUUID: String?) -> NSScreen? {
        if let displayUUID, let match = NSScreen.screens.first(where: { uuid(of: $0) == displayUUID }) {
            return match
        }
        return primary
    }

    static func uuid(of screen: NSScreen) -> String? {
        guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID,
              let cfUUID = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return nil }
        return CFUUIDCreateString(nil, cfUUID) as String
    }
}
