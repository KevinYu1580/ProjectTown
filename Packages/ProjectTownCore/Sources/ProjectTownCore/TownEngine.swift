import Foundation

/// The poll pipeline: read session files, drop dead processes, derive states, build the town state.
/// Stateful (deriver and differ), so call `tick` from one queue only.
public final class TownEngine {
    private let reader: SessionReader
    private let checker: ProcessChecking
    private let clock: Clock
    private let deriver = SessionStateDeriver()
    private var differ = TownStateDiffer()

    public init(reader: SessionReader, checker: ProcessChecking, clock: Clock) {
        self.reader = reader
        self.checker = checker
        self.clock = clock
    }

    /// Returns the new state, or nil when nothing changed since the last returned state.
    public func tick(config: AppConfig) -> TownState? {
        let nowMs = clock.nowMs()
        let read = reader.read()
        let alive = read.sessions.filter { checker.isAlive(pid: $0.pid, procStart: $0.procStart) }
        let settings = DerivationSettings(
            finishedWindowMinutes: config.finishedWindowMinutes,
            sleepThresholdMinutes: config.sleepThresholdMinutes
        )
        let derived = deriver.derive(alive, nowMs: nowMs, settings: settings)
        let state = TownStateBuilder.build(
            projects: config.projects, sessions: derived, dataSourceOk: read.directoryReadable, nowMs: nowMs
        )
        return differ.shouldPush(state) ? state : nil
    }
}
