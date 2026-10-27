import Foundation
import XCTest
@testable import ProjectTownCore

final class FakeClock: Clock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: Int64
    init(_ value: Int64) { self.value = value }

    var now: Int64 {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }

    func nowMs() -> Int64 { now }
}

/// Fake process table: pid -> start time in epoch seconds. EPERM pids count as existing but unreadable.
final class FakeInspector: ProcessInspecting, @unchecked Sendable {
    private let lock = NSLock()
    private var alive: [Int32: Int64?] = [:]
    private var denied: Set<Int32> = []

    func setAlive(_ pid: Int32, start: Int64?) { lock.withLock { alive[pid] = .some(start) } }
    func setDenied(_ pid: Int32, start: Int64? = nil) {
        lock.withLock { denied.insert(pid); alive[pid] = .some(start) }
    }
    func kill(_ pid: Int32) { lock.withLock { alive[pid] = nil; denied.remove(pid) } }

    func signalZero(pid: Int32) -> SignalResult {
        lock.withLock {
            if denied.contains(pid) { return .permissionDenied }
            return alive[pid] != nil ? .alive : .noSuchProcess
        }
    }

    func startTimeSeconds(pid: Int32) -> Int64? { lock.withLock { alive[pid] ?? nil } }
}

extension XCTestCase {
    /// A fresh temp directory removed after the test.
    func makeTempDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ProjectTownCoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func fixtureURL(_ name: String) throws -> URL {
        let url = try XCTUnwrap(Bundle.module.resourceURL).appendingPathComponent("Fixtures/\(name)", isDirectory: true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path), "missing fixture \(name)")
        return url
    }
}

func makeSession(
    pid: Int32 = 1, id: String = "s1", cwd: String = "/p", status: SessionStatus = .idle, name: String? = nil,
    startedAt: Int64? = nil, statusUpdatedAt: Int64? = nil, updatedAt: Int64? = nil
) -> SessionFile {
    SessionFile(
        pid: pid, sessionId: id, cwd: cwd, status: status, startedAt: startedAt, name: name,
        updatedAt: updatedAt, statusUpdatedAt: statusUpdatedAt
    )
}

/// Writes a minimal session file `<pid>.json` into `directory`.
func writeSessionJSON(
    to directory: URL, pid: Int32, sessionId: String, cwd: String, status: String,
    startedAt: Int64? = nil, statusUpdatedAt: Int64? = nil, name: String? = nil, procStart: String? = nil
) throws {
    var object: [String: Any] = ["pid": pid, "sessionId": sessionId, "cwd": cwd, "status": status]
    if let startedAt { object["startedAt"] = startedAt }
    if let statusUpdatedAt { object["statusUpdatedAt"] = statusUpdatedAt }
    if let name { object["name"] = name }
    if let procStart { object["procStart"] = procStart }
    let data = try JSONSerialization.data(withJSONObject: object)
    try data.write(to: directory.appendingPathComponent("\(pid).json"))
}
