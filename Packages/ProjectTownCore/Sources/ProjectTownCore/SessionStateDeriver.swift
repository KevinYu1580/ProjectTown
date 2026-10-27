import Foundation

public struct DerivationSettings: Sendable, Equatable {
    public var finishedWindowMs: Int64
    public var sleepThresholdMs: Int64

    public init(finishedWindowMinutes: Int, sleepThresholdMinutes: Int) {
        finishedWindowMs = Int64(finishedWindowMinutes) * 60_000
        sleepThresholdMs = Int64(sleepThresholdMinutes) * 60_000
    }
}

public struct DerivedSession: Sendable, Equatable {
    public var file: SessionFile
    public var state: SessionState
    public var lastActivityAt: Int64
}

/// Derives the town state of each live session (HANDOFF §5.4). Remembers the previous round's
/// states, so it must be used from a single queue.
public final class SessionStateDeriver {
    /// A busy/idle gap longer than this means the session did work before this app started watching.
    private static let workedThresholdMs: Int64 = 10_000

    private var previous: [String: SessionState] = [:]

    public init() {}

    /// `alive` must already be filtered by process liveness. No hook state is needed: Claude Code writes
    /// `status: "waiting"` to the session file while it waits for the user, e.g. at a permission prompt.
    public func derive(_ alive: [SessionFile], nowMs: Int64, settings: DerivationSettings) -> [DerivedSession] {
        var next: [String: SessionState] = [:]
        let derived = alive.map { file -> DerivedSession in
            let state = state(of: file, nowMs: nowMs, settings: settings)
            next[file.sessionId] = state
            return DerivedSession(file: file, state: state, lastActivityAt: file.lastActivityAt)
        }
        previous = next  // sessions that disappeared are forgotten
        return derived
    }

    private func state(of file: SessionFile, nowMs: Int64, settings: DerivationSettings) -> SessionState {
        switch file.status {
        case .waiting: return .waiting
        case .busy: return .running
        case .idle: break
        }
        let idleFor = nowMs - file.lastActivityAt
        if idleFor < settings.finishedWindowMs, wasFinishedWork(file) { return .finished }
        if idleFor >= settings.sleepThresholdMs { return .sleeping }
        return .idle
    }

    private func wasFinishedWork(_ file: SessionFile) -> Bool {
        // (a) Observed running/waiting -> idle. `.finished` is included so a short task does not flicker
        // back to idle on the next tick once rule (c) no longer sees a long enough gap.
        if let last = previous[file.sessionId], last == .running || last == .waiting || last == .finished { return true }
        // (c) The session worked before this app started watching.
        let updated = file.statusUpdatedAt ?? file.lastActivityAt
        return updated - (file.startedAt ?? updated) > Self.workedThresholdMs
    }
}
