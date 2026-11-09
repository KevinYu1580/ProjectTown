import AppKit

/// The Spaces of each display, read live from SkyLight's private `SLSCopyManagedDisplaySpaces` (the call tools like
/// yabai use; the `com.apple.spaces` preferences are written only now and then). Nil when the call is missing, so
/// callers fall back to what NSWorkspace offers.
enum Spaces {
    struct Display: Equatable {
        /// The Space on screen; `""` is the first desktop's.
        var current: String?
        /// Whether `current` is a desktop rather than a full-screen app's Space.
        var currentIsDesktop: Bool
        /// The display's desktops (not full-screen apps), the ones that show a wallpaper.
        var desktops: Set<String>
    }

    private typealias MainConnection = @convention(c) () -> Int32
    private typealias CopyManagedDisplaySpaces = @convention(c) (Int32) -> Unmanaged<CFArray>?

    private static let calls: (MainConnection, CopyManagedDisplaySpaces)? = {
        guard let skyLight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY),
              let connection = dlsym(skyLight, "SLSMainConnectionID"),
              let copy = dlsym(skyLight, "SLSCopyManagedDisplaySpaces") else { return nil }
        return (unsafeBitCast(connection, to: MainConnection.self), unsafeBitCast(copy, to: CopyManagedDisplaySpaces.self))
    }()

    /// Display UUID → its Spaces.
    static func byDisplay() -> [String: Display]? {
        guard let (connection, copy) = calls,
              let displays = copy(connection())?.takeRetainedValue() as? [[String: Any]] else { return nil }
        var result: [String: Display] = [:]
        for display in displays {
            guard var id = display["Display Identifier"] as? String else { continue }
            // With a single display, or displays mirrored, the main one may be called "Main".
            if id == "Main", let main = CGDisplayCreateUUIDFromDisplayID(CGMainDisplayID())?.takeRetainedValue() {
                id = CFUUIDCreateString(nil, main) as String
            }
            let spaces = display["Spaces"] as? [[String: Any]] ?? []
            let current = display["Current Space"] as? [String: Any]
            result[id] = Display(
                current: current?["uuid"] as? String,
                currentIsDesktop: current.map(isDesktop) ?? false,
                desktops: Set(spaces.filter(isDesktop).compactMap { $0["uuid"] as? String })
            )
        }
        return result
    }

    /// Type 0 is a user's desktop; 4 is a full-screen app.
    private static func isDesktop(_ space: [String: Any]) -> Bool {
        (space["type"] as? Int) == 0
    }
}
