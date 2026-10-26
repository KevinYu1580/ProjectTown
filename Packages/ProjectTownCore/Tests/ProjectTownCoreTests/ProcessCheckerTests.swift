import Foundation
import XCTest
@testable import ProjectTownCore

final class ProcessCheckerTests: XCTestCase {
    private let taipei = TimeZone(identifier: "Asia/Taipei")!
    // "Sun Oct 25 10:28:45 2026" in Asia/Taipei (UTC+8) == 2026-10-25T02:28:45Z
    private let procStart = "Sun Oct 25 10:28:45 2026"
    private let procStartEpoch: Int64 = 1_792_895_325

    private func checker(_ inspector: FakeInspector) -> ProcessChecker {
        ProcessChecker(inspector: inspector, timeZone: taipei)
    }

    func testProcStartEpochConstantIsRight() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = taipei
        let date = calendar.date(from: DateComponents(year: 2026, month: 10, day: 25, hour: 10, minute: 28, second: 45))!
        XCTAssertEqual(Int64(date.timeIntervalSince1970), procStartEpoch)
    }

    func testAliveWithMatchingStart() {
        let inspector = FakeInspector()
        inspector.setAlive(10, start: procStartEpoch)
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: procStart))
    }

    // Real data (Claude Code 2.1.308): procStart is startedAt rendered in UTC, so the same string read as UTC
    // is 8 hours after the Asia/Taipei reading.
    func testProcStartWrittenInUTCMatches() {
        let utcEpoch = procStartEpoch + 8 * 3600
        let inspector = FakeInspector()
        inspector.setAlive(10, start: utcEpoch)
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: procStart))
        inspector.setAlive(10, start: utcEpoch + 3)
        XCTAssertFalse(checker(inspector).isAlive(pid: 10, procStart: procStart))
    }

    func testPermissionDeniedCountsAsAlive() {
        let inspector = FakeInspector()
        inspector.setDenied(10, start: procStartEpoch)
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: procStart))
        // And with no start time readable, only the signal counts.
        inspector.setDenied(11, start: nil)
        XCTAssertTrue(checker(inspector).isAlive(pid: 11, procStart: procStart))
    }

    func testDeadProcess() {
        let inspector = FakeInspector()
        XCTAssertFalse(checker(inspector).isAlive(pid: 10, procStart: procStart))
        XCTAssertFalse(checker(inspector).isAlive(pid: 10, procStart: nil))
    }

    func testPidReuseWhenStartTimeDiffersByMoreThanTwoSeconds() {
        let inspector = FakeInspector()
        inspector.setAlive(10, start: procStartEpoch + 3)
        XCTAssertFalse(checker(inspector).isAlive(pid: 10, procStart: procStart))
        inspector.setAlive(10, start: procStartEpoch - 3)
        XCTAssertFalse(checker(inspector).isAlive(pid: 10, procStart: procStart))
        inspector.setAlive(10, start: procStartEpoch + 86_400)
        XCTAssertFalse(checker(inspector).isAlive(pid: 10, procStart: procStart))
    }

    func testStartTimeWithinTwoSecondsIsSameProcess() {
        let inspector = FakeInspector()
        for delta: Int64 in [-2, -1, 0, 1, 2] {
            inspector.setAlive(10, start: procStartEpoch + delta)
            XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: procStart), "delta \(delta)")
        }
    }

    func testMissingOrGarbageProcStartOnlyChecksSignal() {
        let inspector = FakeInspector()
        inspector.setAlive(10, start: 42)  // would never match any real procStart
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: nil))
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: "not a date"))
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: ""))
    }

    func testUnreadableStartTimeOnlyChecksSignal() {
        let inspector = FakeInspector()
        inspector.setAlive(10, start: nil)
        XCTAssertTrue(checker(inspector).isAlive(pid: 10, procStart: procStart))
    }

    func testProcStartParserBasic() throws {
        let date = try XCTUnwrap(ProcStartParser.parse(procStart, timeZone: taipei))
        XCTAssertEqual(Int64(date.timeIntervalSince1970), procStartEpoch)
    }

    func testProcStartParserDoubleSpaceDay() throws {
        // ctime pads single-digit days with a space. 2026-10-05 is a Monday.
        let padded = try XCTUnwrap(ProcStartParser.parse("Mon Oct  5 10:28:45 2026", timeZone: taipei))
        let single = try XCTUnwrap(ProcStartParser.parse("Mon Oct 5 10:28:45 2026", timeZone: taipei))
        XCTAssertEqual(padded, single)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = taipei
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: padded)
        XCTAssertEqual([parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second],
                       [2026, 10, 5, 10, 28, 45])
    }

    func testProcStartParserUsesGivenTimeZone() throws {
        let utc = try XCTUnwrap(ProcStartParser.parse(procStart, timeZone: TimeZone(identifier: "UTC")!))
        let taipeiDate = try XCTUnwrap(ProcStartParser.parse(procStart, timeZone: taipei))
        XCTAssertEqual(utc.timeIntervalSince(taipeiDate), 8 * 3600)
    }

    func testProcStartParserGarbage() {
        XCTAssertNil(ProcStartParser.parse("", timeZone: taipei))
        XCTAssertNil(ProcStartParser.parse("yesterday", timeZone: taipei))
        XCTAssertNil(ProcStartParser.parse("Sun Oct 25 2026", timeZone: taipei))
    }

    func testSystemInspectorSeesThisProcess() {
        let inspector = SystemProcessInspector()
        let pid = ProcessInfo.processInfo.processIdentifier
        XCTAssertEqual(inspector.signalZero(pid: pid), .alive)
        let start = inspector.startTimeSeconds(pid: pid)
        XCTAssertNotNil(start)
        XCTAssertLessThanOrEqual(start ?? .max, Int64(Date().timeIntervalSince1970))
        XCTAssertEqual(inspector.signalZero(pid: 0), .noSuchProcess)
        XCTAssertEqual(inspector.signalZero(pid: -1), .noSuchProcess)
    }
}
