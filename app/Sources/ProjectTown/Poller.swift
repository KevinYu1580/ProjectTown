import Foundation
import ProjectTownCore

/// Ticks once per second on a private serial queue: reads the current config from the settings store, runs the Core
/// pipeline, and hands changed states to the main actor. All mutable state lives on `queue`.
final class Poller: @unchecked Sendable {
    private let queue = DispatchQueue(label: "io.github.kevinyu1580.ProjectTown.poller")
    private let engine = TownEngine(reader: SessionReader(), checker: ProcessChecker(), clock: SystemClock())
    private let config: @Sendable () -> AppConfig
    private let onState: @MainActor @Sendable (TownState) -> Void
    private var timer: DispatchSourceTimer?

    init(
        config: @escaping @Sendable () -> AppConfig,
        onState: @escaping @MainActor @Sendable (TownState) -> Void
    ) {
        self.config = config
        self.onState = onState
    }

    func start() {
        queue.async { [self] in
            guard timer == nil else { return }
            let source = DispatchSource.makeTimerSource(queue: queue)
            source.schedule(deadline: .now(), repeating: 1.0, leeway: .milliseconds(100))
            source.setEventHandler { [weak self] in self?.tick() }
            source.resume()
            timer = source
        }
    }

    /// Runs a tick now instead of waiting for the next one, so a settings change shows up at once.
    func tickNow() {
        queue.async { [self] in tick() }
    }

    private func tick() {
        if let state = engine.tick(config: config()) {
            let onState = onState
            DispatchQueue.main.async { MainActor.assumeIsolated { onState(state) } }
        }
    }
}
