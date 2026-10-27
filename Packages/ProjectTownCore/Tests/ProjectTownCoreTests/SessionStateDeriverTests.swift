import Foundation
import XCTest
@testable import ProjectTownCore

final class SessionStateDeriverTests: XCTestCase {
    private let minute: Int64 = 60_000
    private let settings = DerivationSettings(finishedWindowMinutes: 30, sleepThresholdMinutes: 120)
    private let now: Int64 = 1_800_000_000_000

    /// An idle session whose last status change was `idleFor` ms ago, started `workedFor` ms before that.
    private func idle(_ id: String = "s1", idleFor: Int64, workedFor: Int64) -> SessionFile {
        let updated = now - idleFor
        return makeSession(id: id, status: .idle, startedAt: updated - workedFor, statusUpdatedAt: updated)
    }

    private func state(_ file: SessionFile, deriver: SessionStateDeriver = SessionStateDeriver(), at nowMs: Int64? = nil) -> SessionState {
        deriver.derive([file], nowMs: nowMs ?? now, settings: settings)[0].state
    }

    func testSettingsMinutesToMilliseconds() {
        XCTAssertEqual(settings.finishedWindowMs, 1_800_000)
        XCTAssertEqual(settings.sleepThresholdMs, 7_200_000)
    }

    func testWaitingAndRunningFromStatus() {
        XCTAssertEqual(state(makeSession(status: .waiting, statusUpdatedAt: now)), .waiting)
        XCTAssertEqual(state(makeSession(status: .busy, statusUpdatedAt: now)), .running)
        // Staleness does not matter for waiting/busy.
        XCTAssertEqual(state(makeSession(status: .busy, statusUpdatedAt: now - 5 * 120 * minute)), .running)
    }

    func testFreshEmptySessionIsIdleNotFinished() {
        // statusUpdatedAt - startedAt is tiny: never worked.
        XCTAssertEqual(state(idle(idleFor: 5 * minute, workedFor: 500)), .idle)
    }

    func testAppStartFinishedViaRuleC() {
        XCTAssertEqual(state(idle(idleFor: 5 * minute, workedFor: 60_000)), .finished)
    }

    func testRuleCThresholdIsStrictlyMoreThanTenSeconds() {
        XCTAssertEqual(state(idle(idleFor: minute, workedFor: 10_000)), .idle)
        XCTAssertEqual(state(idle(idleFor: minute, workedFor: 10_001)), .finished)
    }

    func testRuleCNeedsStartedAt() {
        let file = makeSession(status: .idle, statusUpdatedAt: now - minute)
        XCTAssertEqual(state(file), .idle)
    }

    func testFinishedWindowBoundary() {
        XCTAssertEqual(state(idle(idleFor: 30 * minute - 1, workedFor: 60_000)), .finished)
        XCTAssertEqual(state(idle(idleFor: 30 * minute, workedFor: 60_000)), .idle)
        XCTAssertEqual(state(idle(idleFor: 30 * minute + 1, workedFor: 60_000)), .idle)
    }

    func testSleepThresholdBoundary() {
        XCTAssertEqual(state(idle(idleFor: 120 * minute - 1, workedFor: 60_000)), .idle)
        XCTAssertEqual(state(idle(idleFor: 120 * minute, workedFor: 60_000)), .sleeping)
        XCTAssertEqual(state(idle(idleFor: 120 * minute + 1, workedFor: 60_000)), .sleeping)
    }

    func testObservedBusyToIdleIsFinishedEvenForShortTask() {
        let deriver = SessionStateDeriver()
        let busy = makeSession(status: .busy, startedAt: now - 20_000, statusUpdatedAt: now - 1000)
        XCTAssertEqual(state(busy, deriver: deriver), .running)

        // Went idle after a 5 s task: rule (c) alone would say idle, rule (a) says finished.
        let idleAfter = makeSession(status: .idle, startedAt: now - 20_000, statusUpdatedAt: now + 4000)
        XCTAssertEqual(state(idleAfter, deriver: deriver, at: now + 5000), .finished)
        // Stays finished on later ticks while inside the window...
        XCTAssertEqual(state(idleAfter, deriver: deriver, at: now + 6000), .finished)
        XCTAssertEqual(state(idleAfter, deriver: deriver, at: now + 20 * minute), .finished)
        // ...and expires at the window boundary.
        XCTAssertEqual(state(idleAfter, deriver: deriver, at: now + 4000 + 30 * minute), .idle)
    }

    func testObservedWaitingToIdleIsFinished() {
        let deriver = SessionStateDeriver()
        let waiting = makeSession(status: .waiting, startedAt: now - 1000, statusUpdatedAt: now - 500)
        XCTAssertEqual(state(waiting, deriver: deriver), .waiting)
        let idleAfter = makeSession(status: .idle, startedAt: now - 1000, statusUpdatedAt: now)
        XCTAssertEqual(state(idleAfter, deriver: deriver), .finished)
    }

    func testObservedTransitionStillRespectsWindowAndSleep() {
        let deriver = SessionStateDeriver()
        _ = state(makeSession(status: .busy, startedAt: now - 50, statusUpdatedAt: now - 10), deriver: deriver)
        // The status file says it went idle long ago (e.g. clock jump): outside the window, so not finished.
        let stale = makeSession(status: .idle, startedAt: now - 50, statusUpdatedAt: now - 200 * minute)
        XCTAssertEqual(state(stale, deriver: deriver), .sleeping)
    }

    func testFreshIdleSessionStaysIdleAcrossTicks() {
        let deriver = SessionStateDeriver()
        let file = idle(idleFor: minute, workedFor: 300)
        XCTAssertEqual(state(file, deriver: deriver), .idle)
        XCTAssertEqual(state(file, deriver: deriver, at: now + 1000), .idle)
    }

    func testBusyAgainAfterFinishedThenIdleIsFinishedAgain() {
        let deriver = SessionStateDeriver()
        let first = makeSession(status: .idle, startedAt: now - 100, statusUpdatedAt: now - 50)
        XCTAssertEqual(state(first, deriver: deriver), .idle)
        let busy = makeSession(status: .busy, startedAt: now - 100, statusUpdatedAt: now)
        XCTAssertEqual(state(busy, deriver: deriver, at: now + 100), .running)
        let second = makeSession(status: .idle, startedAt: now - 100, statusUpdatedAt: now + 200)
        XCTAssertEqual(state(second, deriver: deriver, at: now + 300), .finished)
    }

    func testDisappearedSessionsAreForgotten() {
        let deriver = SessionStateDeriver()
        let busy = makeSession(status: .busy, startedAt: now - 50, statusUpdatedAt: now - 10)
        _ = deriver.derive([busy], nowMs: now, settings: settings)
        _ = deriver.derive([], nowMs: now + 1000, settings: settings)
        // Same session id comes back already idle: no memory of the earlier run.
        let back = makeSession(status: .idle, startedAt: now - 50, statusUpdatedAt: now + 500)
        XCTAssertEqual(deriver.derive([back], nowMs: now + 2000, settings: settings)[0].state, .idle)
    }

    func testSessionsAreTrackedIndependentlyAndOrderIsKept() {
        let deriver = SessionStateDeriver()
        let a = makeSession(id: "a", status: .busy, statusUpdatedAt: now)
        let b = makeSession(id: "b", status: .idle, startedAt: now - 5000, statusUpdatedAt: now - 4000)
        let result = deriver.derive([a, b], nowMs: now, settings: settings)
        XCTAssertEqual(result.map(\.file.sessionId), ["a", "b"])
        XCTAssertEqual(result.map(\.state), [.running, .idle])
        XCTAssertEqual(result.map(\.lastActivityAt), [now, now - 4000])
    }

    func testEveryStateIsReachable() {
        let deriver = SessionStateDeriver()
        let files = [
            makeSession(id: "w", status: .waiting, statusUpdatedAt: now),
            makeSession(id: "r", status: .busy, statusUpdatedAt: now),
            idle("f", idleFor: minute, workedFor: 60_000),
            idle("i", idleFor: minute, workedFor: 0),
            idle("z", idleFor: 3 * 60 * minute, workedFor: 60_000),
        ]
        let states = deriver.derive(files, nowMs: now, settings: settings).map(\.state)
        XCTAssertEqual(states, [.waiting, .running, .finished, .idle, .sleeping])
    }
}
