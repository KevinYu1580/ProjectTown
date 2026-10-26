import Foundation
import ProjectTownCore
import os

/// Ticks once per second on a private serial queue: hot-reloads `config.json` when its modification date changes,
/// runs the Core pipeline, and hands changed values to the main actor. All mutable state lives on `queue`.
final class Poller: @unchecked Sendable {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "Poller")

    private let queue = DispatchQueue(label: "io.github.kevinyu1580.ProjectTown.poller")
    private let engine = TownEngine(reader: SessionReader(), checker: ProcessChecker(), clock: SystemClock())
    private let configURL: URL
    private let onConfig: @MainActor @Sendable (AppConfig) -> Void
    private let onState: @MainActor @Sendable (TownState) -> Void
    private var config: AppConfig
    private var lastConfigStamp: Date?
    private var timer: DispatchSourceTimer?

    init(
        initialConfig: AppConfig,
        configURL: URL = ConfigStore.defaultURL,
        onConfig: @escaping @MainActor @Sendable (AppConfig) -> Void,
        onState: @escaping @MainActor @Sendable (TownState) -> Void
    ) {
        self.config = initialConfig
        self.configURL = configURL
        self.onConfig = onConfig
        self.onState = onState
        self.lastConfigStamp = Self.modificationDate(configURL)
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

    private func tick() {
        reloadConfigIfChanged()
        if let state = engine.tick(config: config) {
            let onState = onState
            DispatchQueue.main.async { MainActor.assumeIsolated { onState(state) } }
        }
    }

    /// A file that no longer decodes keeps the previous config. Unlike `ConfigStore.load()` this never moves the
    /// file aside, so a half-edited config.json is not swapped for defaults mid-edit.
    private func reloadConfigIfChanged() {
        let stamp = Self.modificationDate(configURL)
        guard stamp != lastConfigStamp else { return }
        lastConfigStamp = stamp
        do {
            let loaded = try JSONDecoder().decode(AppConfig.self, from: Data(contentsOf: configURL))
            guard loaded != config else { return }
            config = loaded
            let onConfig = onConfig
            DispatchQueue.main.async { MainActor.assumeIsolated { onConfig(loaded) } }
        } catch {
            Self.log.error("Cannot reload config.json, keeping the previous one: \(error.localizedDescription, privacy: .public)")
        }
    }

    private static func modificationDate(_ url: URL) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }
}
