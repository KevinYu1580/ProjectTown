import AppKit

// Top-level entry point (not @main) so M4 can check for the `hook` argument before starting AppKit.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
