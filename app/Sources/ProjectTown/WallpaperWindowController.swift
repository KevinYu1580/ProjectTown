import AppKit
import ProjectTownCore
import WebKit
import os

/// Borderless so it has no chrome; `canBecomeKey` is overridden for M3's camera edit mode (HANDOFF §7.3).
final class WallpaperWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

/// Forwards script messages without letting WKUserContentController retain the controller.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// Owns the desktop-level window and its WKWebView, the Swift side of the bridge (HANDOFF §6) and the pause logic (§7.2).
@MainActor
final class WallpaperWindowController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "WallpaperWindowController")

    private let window: WallpaperWindow
    private let webView: WKWebView
    private var displayUUID: String?
    private let cycleEpochMs: Int64
    private let locale = SceneLocale.resolve(preferredLanguages: Locale.preferredLanguages)

    // Latest values kept until the scene reports `ready`; only the newest of each is ever sent.
    private var ready = false
    private var settings: SceneSettings
    private var sentSettings: SceneSettings?
    private var latestStateJSON: String?

    // Read live: a window that starts out covered never gets an occlusion-change notification.
    private var occluded: Bool { !window.occlusionState.contains(.visible) }
    private var screensAsleep = false
    private var sessionResigned = false
    private(set) var userPaused = false
    private var sentPaused = false

    init(config: AppConfig, cycleEpochMs: Int64) {
        self.cycleEpochMs = cycleEpochMs
        self.displayUUID = config.displayUUID
        self.settings = SceneSettings.make(config: config, locale: locale, cycleEpochMs: cycleEpochMs)

        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        #if DEBUG
        webView.isInspectable = true
        #endif

        window = WallpaperWindow(
            contentRect: Self.targetScreen(displayUUID: config.displayUUID)?.frame ?? .zero,
            styleMask: .borderless, backing: .buffered, defer: false
        )
        super.init()

        configuration.userContentController.add(WeakScriptHandler(self), name: "projectTown")
        webView.navigationDelegate = self

        window.isReleasedWhenClosed = false
        // §7.1 acceptance (desktop icons stay above the town and clickable) needs a real-desktop check.
        window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        window.ignoresMouseEvents = true
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        window.isOpaque = true
        // The web view is transparent (drawsBackground=false); keep the scene-less moment black, not system gray.
        window.backgroundColor = .black
        window.hasShadow = false
        window.contentView = webView

        observePauseSignals()
        observeScreenChanges()
    }

    func show() {
        window.orderFrontRegardless()
        loadScene()
    }

    // MARK: Data from the poller

    func apply(config: AppConfig) {
        if config.displayUUID != displayUUID {
            displayUUID = config.displayUUID
            reframe()
        }
        settings = SceneSettings.make(config: config, locale: locale, cycleEpochMs: cycleEpochMs)
        flushSettings()
    }

    func push(state: TownState) {
        guard let json = Self.encode(state) else { return }
        latestStateJSON = json
        guard ready else { return }
        run("window.projectTown.update(\(json))")
    }

    // MARK: Menu actions

    func setUserPaused(_ paused: Bool) {
        userPaused = paused
        updatePause()
    }

    /// Reloads the page itself, so a wedged scene recovers; `ready` re-sends settings, state and pause.
    func reloadScene() {
        ready = false
        loadScene()
    }

    // MARK: Loading and bridge

    private func loadScene() {
        if let raw = ProcessInfo.processInfo.environment["PROJECTTOWN_WEB_URL"], let url = URL(string: raw) {
            Self.log.notice("Loading dev URL \(raw, privacy: .public)")
            webView.load(URLRequest(url: url))
            return
        }
        guard let directory = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) else {
            Self.log.error("Bundle has no resources directory")
            return
        }
        webView.loadFileURL(directory.appendingPathComponent("index.html"), allowingReadAccessTo: directory)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
            Self.log.error("Malformed message from scene")
            return
        }
        switch type {
        case "ready":
            ready = true
            sentSettings = nil
            sentPaused = false
            flushSettings()
            if let json = latestStateJSON { run("window.projectTown.update(\(json))") }
            updatePause()
            measureFrameRateIfRequested()
        case "error":
            Self.log.error("Scene error: \(body["message"] as? String ?? "?", privacy: .public)")
        case "cameraSaved", "cameraEditClosed":
            Self.log.info("Ignoring \(type, privacy: .public) until M3")
        default:
            Self.log.error("Unknown message type \(type, privacy: .public)")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Self.log.error("Navigation failed: \(error.localizedDescription, privacy: .public)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Self.log.error("Navigation failed: \(error.localizedDescription, privacy: .public)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Self.log.error("Web content process terminated, reloading the scene")
        reloadScene()
    }

    private func flushSettings() {
        guard ready, settings != sentSettings, let json = Self.encode(settings) else { return }
        sentSettings = settings
        run("window.projectTown.applySettings(\(json))")
    }

    private func run(_ script: String) {
        webView.evaluateJavaScript(script) { _, error in
            if let error {
                Self.log.error("JS call failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private static func encode<T: Encodable>(_ value: T) -> String? {
        do {
            return String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        } catch {
            log.error("Cannot encode \(String(describing: T.self), privacy: .public): \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    // MARK: Pause (§7.2)

    private enum PauseSignal: Sendable {
        case screensAsleep(Bool), sessionResigned(Bool)
    }

    private func observePauseSignals() {
        let workspace = NSWorkspace.shared.notificationCenter
        let signals: [(Notification.Name, PauseSignal)] = [
            (NSWorkspace.screensDidSleepNotification, .screensAsleep(true)),
            (NSWorkspace.screensDidWakeNotification, .screensAsleep(false)),
            (NSWorkspace.sessionDidResignActiveNotification, .sessionResigned(true)),
            (NSWorkspace.sessionDidBecomeActiveNotification, .sessionResigned(false)),
        ]
        for (name, signal) in signals {
            workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    switch signal {
                    case .screensAsleep(let value): self.screensAsleep = value
                    case .sessionResigned(let value): self.sessionResigned = value
                    }
                    self.updatePause()
                }
            }
        }
        NotificationCenter.default.addObserver(
            forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.updatePause() }
        }
    }

    /// Calls `setPaused` only when the combined value differs from what the scene last heard.
    private func updatePause() {
        guard ready else { return }
        let paused = occluded || screensAsleep || sessionResigned || userPaused
        guard paused != sentPaused else { return }
        sentPaused = paused
        run("window.projectTown.setPaused(\(paused))")
    }

    // MARK: Screen (§7.1)

    private func observeScreenChanges() {
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.reframe() }
        }
    }

    private func reframe() {
        guard let screen = Self.targetScreen(displayUUID: displayUUID) else { return }
        window.setFrame(screen.frame, display: true)
    }

    private static func targetScreen(displayUUID: String?) -> NSScreen? {
        if let displayUUID,
           let match = NSScreen.screens.first(where: { uuid(of: $0) == displayUUID }) {
            return match
        }
        return NSScreen.main ?? NSScreen.screens.first
    }

    private static func uuid(of screen: NSScreen) -> String? {
        guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID,
              let cfUUID = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return nil }
        return CFUUIDCreateString(nil, cfUUID) as String
    }

    // MARK: Dev measurement (HANDOFF §8.9)

    private func measureFrameRateIfRequested() {
        guard ProcessInfo.processInfo.environment["PROJECTTOWN_MEASURE_RAF"] == "1" else { return }
        let script = """
        return await new Promise(resolve => {
          let frames = 0, start = null;
          const step = t => {
            if (start === null) start = t;
            frames += 1;
            if (t - start >= 3000) resolve(frames * 1000 / (t - start));
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        """
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                let rate = (value as? Double) ?? -1
                Self.log.notice("rAF rate over 3 s: \(rate, format: .fixed(precision: 1)) Hz")
                print(String(format: "rAF rate over 3 s: %.1f Hz", rate))
                fflush(stdout)
            case .failure(let error):
                Self.log.error("rAF measurement failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }
}
