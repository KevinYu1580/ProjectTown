import Foundation
import XCTest
@testable import ProjectTownCore

final class SessionReaderTests: XCTestCase {
    private func readFixtures() throws -> SessionReadResult {
        SessionReader(directory: try fixtureURL("sessions")).read()
    }

    private func session(_ id: String, in result: SessionReadResult) -> SessionFile? {
        result.sessions.first { $0.sessionId == id }
    }

    func testReadsRealSample() throws {
        let result = try readFixtures()
        XCTAssertTrue(result.directoryReadable)
        let s = try XCTUnwrap(session("941a5c32-62ef-4cc4-ae6d-ee017a605e1f", in: result))
        XCTAssertEqual(s.pid, 10434)
        XCTAssertEqual(s.cwd, "/Users/me/projects/demo")
        XCTAssertEqual(s.status, .idle)
        XCTAssertEqual(s.startedAt, 1792924125747)
        XCTAssertEqual(s.procStart, "Sun Oct 25 10:28:45 2026")
        XCTAssertEqual(s.version, "2.1.308")
        XCTAssertEqual(s.kind, "interactive")
        XCTAssertEqual(s.entrypoint, "claude-desktop")
        XCTAssertEqual(s.name, "Demo session")
        XCTAssertEqual(s.nameSource, "user")
        XCTAssertEqual(s.nameSince, 1792924126412)
        XCTAssertEqual(s.updatedAt, 1792924794503)
        XCTAssertEqual(s.statusUpdatedAt, 1792924794503)
        XCTAssertNil(s.waitingFor)
        XCTAssertEqual(s.lastActivityAt, 1792924794503)
    }

    func testMissingNameIsNil() throws {
        let s = try XCTUnwrap(session("sess-noname", in: try readFixtures()))
        XCTAssertNil(s.name)
        XCTAssertEqual(s.status, .busy)
        XCTAssertEqual(s.lastActivityAt, 0)
    }

    func testUnknownStatusBecomesIdle() throws {
        let s = try XCTUnwrap(session("sess-unknown-status", in: try readFixtures()))
        XCTAssertEqual(s.status, .idle)
        XCTAssertEqual(s.name, "Odd status")
    }

    func testWaitingStatusAndWaitingFor() throws {
        let s = try XCTUnwrap(session("sess-waiting", in: try readFixtures()))
        XCTAssertEqual(s.status, .waiting)
        XCTAssertEqual(s.waitingFor, "input needed")
    }

    func testBrokenAndIncompleteFilesAreSkippedOthersStillRead() throws {
        let result = try readFixtures()
        XCTAssertNil(session("sess-broken", in: result))
        XCTAssertNil(session("sess-missing-cwd", in: result))
        XCTAssertNotNil(session("sess-noname", in: result))
        XCTAssertNotNil(session("sess-extra", in: result))
    }

    func testExtraFieldsAreIgnored() throws {
        let s = try XCTUnwrap(session("sess-extra", in: try readFixtures()))
        XCTAssertEqual(s.name, "Extra fields")
        XCTAssertEqual(s.status, .idle)
    }

    func testNonInteractiveKindIsDroppedAndNilKindKept() throws {
        let result = try readFixtures()
        XCTAssertNil(session("sess-daemon", in: result))
        XCTAssertNotNil(session("sess-interactive", in: result))  // kind == "interactive"
        XCTAssertNotNil(session("sess-noname", in: result))       // kind == nil
    }

    func testKeyAndOtherFilesAreIgnored() throws {
        let result = try readFixtures()
        XCTAssertNil(session("sess-from-key-file", in: result))
        // 10434 sample, noname, unknown-status, waiting, extra, interactive-kind
        XCTAssertEqual(result.sessions.count, 6)
    }

    func testMissingDirectoryIsNotReadable() throws {
        let missing = try makeTempDirectory().appendingPathComponent("does-not-exist")
        let result = SessionReader(directory: missing).read()
        XCTAssertFalse(result.directoryReadable)
        XCTAssertTrue(result.sessions.isEmpty)
    }

    // A session that ends between the directory listing and the read leaves a name with no file behind it.
    func testFileThatVanishedIsSkipped() throws {
        let dir = try makeTempDirectory()
        try writeSessionJSON(to: dir, pid: 1, sessionId: "alive", cwd: "/p", status: "idle")
        try FileManager.default.createSymbolicLink(
            at: dir.appendingPathComponent("2.json"), withDestinationURL: dir.appendingPathComponent("gone.json"))
        let result = SessionReader(directory: dir).read()
        XCTAssertTrue(result.directoryReadable)
        XCTAssertEqual(result.sessions.map(\.sessionId), ["alive"])
    }

    func testEmptyDirectoryIsReadable() throws {
        let result = SessionReader(directory: try makeTempDirectory()).read()
        XCTAssertTrue(result.directoryReadable)
        XCTAssertTrue(result.sessions.isEmpty)
    }

    func testLastActivityFallbackOrder() {
        XCTAssertEqual(makeSession(startedAt: 1, statusUpdatedAt: 3, updatedAt: 2).lastActivityAt, 3)
        XCTAssertEqual(makeSession(startedAt: 1, updatedAt: 2).lastActivityAt, 2)
        XCTAssertEqual(makeSession(startedAt: 1).lastActivityAt, 1)
        XCTAssertEqual(makeSession().lastActivityAt, 0)
    }

    func testDefaultDirectoryIsClaudeSessions() {
        XCTAssertTrue(SessionReader.defaultDirectory.path.hasSuffix("/.claude/sessions"))
    }
}
