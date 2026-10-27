import Foundation
import ProjectTownCore
import os

/// Features the running system cannot do. WKWebView's requestAnimationFrame measured about 58 Hz on a ProMotion
/// display (HANDOFF §8.9, M2), so 120 FPS is disabled in the UI. Remove the entry to enable it.
enum DisplaySupport {
    static let unsupportedFPS: Set<Int> = [120]
}

enum UpdateOutcome: Equatable {
    case applied
    case invalid([ConfigIssue])
    case saveFailed(String)

    /// Text for an inline hint next to the control that caused the change; nil when applied.
    var message: String? {
        switch self {
        case .applied: nil
        case .invalid(let issues): issues.first?.message
        case .saveFailed(let reason): String(localized: "Could not save settings: \(reason)")
        }
    }
}

/// Owns the live `AppConfig` (HANDOFF §9.1). Every change is validated first; only a valid config is written to
/// `config.json`, published, and pushed to the scene (`onChange`) and the poller (`currentConfig()`).
@MainActor
final class SettingsStore: ObservableObject {
    private static let log = Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: "SettingsStore")

    @Published private(set) var config: AppConfig
    /// One-time notice for the settings window, set when the stored config could not be used.
    @Published private(set) var notice: String?
    /// Called after a change was saved.
    var onChange: ((AppConfig) -> Void)?

    /// True while `notice` is a save failure, which clears itself on the next successful save.
    private var noticeIsSaveError = false
    private let store: ConfigStore
    private let snapshot: OSAllocatedUnfairLock<AppConfig>

    init(store: ConfigStore = ConfigStore()) {
        self.store = store
        var config: AppConfig
        var notice: String?
        switch store.load() {
        case .loaded(let loaded), .createdDefault(let loaded):
            config = loaded
        case .recoveredFromBroken(let defaults, let backup):
            Self.log.error("config.json was unreadable, moved to \(backup.lastPathComponent, privacy: .public)")
            config = defaults
            notice = String(localized: "The settings file could not be read. It was saved as \(backup.lastPathComponent) and defaults are in use.")
        }
        // A hand-edited file can decode yet hold out-of-range values. Reset only the offending settings in memory;
        // the file is only rewritten by the next change.
        let issues = config.validate()
        if !issues.isEmpty {
            Self.log.error("config.json holds invalid values, using defaults for them: \(String(describing: issues), privacy: .public)")
            config = config.repaired()
            notice = String(localized: "Some saved settings were out of range and were reset to defaults.")
        }
        self.config = config
        self.notice = notice
        self.snapshot = OSAllocatedUnfairLock(initialState: config)
    }

    /// Thread-safe copy of the current config for the poller's queue.
    nonisolated func currentConfig() -> AppConfig {
        snapshot.withLock { $0 }
    }

    /// Applies `change` to a copy of the config. Rejected (nothing stored, nothing pushed) when the result is
    /// invalid or cannot be written.
    @discardableResult
    func update(_ change: (inout AppConfig) -> Void) -> UpdateOutcome {
        var edited = config
        change(&edited)
        let candidate = edited
        guard candidate != config else { return .applied }
        let issues = candidate.validate()
        guard issues.isEmpty else {
            objectWillChange.send()  // lets controls bound to `config` snap back to the stored value
            return .invalid(issues)
        }
        do {
            try store.save(candidate)
        } catch {
            Self.log.error("Cannot write config.json: \(error.localizedDescription, privacy: .public)")
            objectWillChange.send()
            let outcome = UpdateOutcome.saveFailed(error.localizedDescription)
            notice = outcome.message  // most controls ignore the outcome, so the settings window shows it
            noticeIsSaveError = true
            return outcome
        }
        if noticeIsSaveError { dismissNotice() }
        config = candidate
        snapshot.withLock { $0 = candidate }
        onChange?(candidate)
        return .applied
    }

    func dismissNotice() {
        notice = nil
        noticeIsSaveError = false
    }
}

extension ConfigIssue {
    /// Inline message for the control that holds the offending value.
    var message: String {
        switch self {
        case .fps:
            String(localized: "FPS must be 15, 30, 60 or 120.")
        case .finishedWindowMinutes:
            String(localized: "Enter a whole number from \(ConfigLimits.finishedWindowMinutes.lowerBound) to \(ConfigLimits.finishedWindowMinutes.upperBound) minutes.")
        case .sleepThresholdMinutes:
            String(localized: "Enter a whole number from \(ConfigLimits.sleepThresholdMinutes.lowerBound) minutes to \(ConfigLimits.sleepThresholdMinutes.upperBound) minutes (24 hours).")
        case .sleepThresholdNotAfterFinishedWindow(_, let finished):
            String(localized: "The sleep threshold must be greater than the “Just finished” duration (\(finished) minutes).")
        case .sunrise, .sunset:
            String(localized: "Enter a valid time.")
        case .sunsetNotAfterSunrise:
            String(localized: "Sunset must be later than sunrise.")
        case .cyclePeriodMinutes:
            String(localized: "Enter a whole number from \(ConfigLimits.cyclePeriodMinutes.lowerBound) minutes to \(ConfigLimits.cyclePeriodMinutes.upperBound) minutes (24 hours).")
        case .dayRatio:
            String(localized: "The day share must be between 10% and 90%.")
        case .cameraIntervalMinutes:
            String(localized: "Enter a whole number from \(ConfigLimits.intervalMinutes.lowerBound) to \(ConfigLimits.intervalMinutes.upperBound) minutes.")
        case .cameraContinuousPeriodMinutes:
            String(localized: "Enter a whole number from \(ConfigLimits.continuousPeriodMinutes.lowerBound) to \(ConfigLimits.continuousPeriodMinutes.upperBound) minutes.")
        case .cameraPitchDeg, .cameraZoom:
            String(localized: "The camera angle or zoom is out of range.")
        case .depthOfFieldStrength:
            String(localized: "The blur strength must be between 25% and 200%.")
        case .depthOfFieldRange:
            String(localized: "The blur range must be between 0% and 45%.")
        }
    }
}
