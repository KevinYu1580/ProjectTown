import Foundation
import XCTest
@testable import ProjectTownCore

final class TownStateTests: XCTestCase {
    private let now: Int64 = 1_800_000_000_000

    private func derived(_ file: SessionFile, _ state: SessionState = .idle) -> DerivedSession {
        DerivedSession(file: file, state: state, lastActivityAt: file.lastActivityAt)
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    // MARK: JSON shape (must match web/src/types.ts)

    func testBuildingStyleRawValuesAndOrder() {
        XCTAssertEqual(
            BuildingStyle.allCases.map(\.rawValue),
            ["office", "factory", "cafe", "bookstore", "lab", "warehouse", "radioTower", "greenhouse", "clockTower", "ramenShop"]
        )
    }

    func testTownStateJSONShape() throws {
        let state = TownState(generatedAt: now, dataSourceOk: true, projects: [
            TownProject(id: "abc", name: "P", color: "#5B8DEF", buildingStyle: .radioTower, sessions: [
                TownSession(id: "s1", name: nil, state: .running, lastActivityAt: 5),
                TownSession(id: "s2", name: "Named", state: .sleeping, lastActivityAt: 6),
            ]),
        ])
        let json = try jsonObject(state)
        XCTAssertEqual(Set(json.keys), ["version", "generatedAt", "dataSourceOk", "projects"])
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertEqual(json["generatedAt"] as? Int64, now)
        XCTAssertEqual(json["dataSourceOk"] as? Bool, true)

        let project = try XCTUnwrap((json["projects"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(project.keys), ["id", "name", "color", "buildingStyle", "sessions"])
        XCTAssertEqual(project["buildingStyle"] as? String, "radioTower")

        let sessions = try XCTUnwrap(project["sessions"] as? [[String: Any]])
        // `name` must be present as JSON null, never omitted.
        XCTAssertEqual(Set(sessions[0].keys), ["id", "name", "state", "lastActivityAt"])
        XCTAssertTrue(sessions[0]["name"] is NSNull)
        XCTAssertEqual(sessions[0]["state"] as? String, "running")
        XCTAssertEqual(sessions[1]["name"] as? String, "Named")
        XCTAssertEqual(sessions[1]["state"] as? String, "sleeping")
        XCTAssertEqual(sessions[1]["lastActivityAt"] as? Int64, 6)
    }

    func testTownStateJSONRoundTrip() throws {
        let state = TownState(generatedAt: now, dataSourceOk: false, projects: [
            TownProject(id: "abc", name: "P", color: "#000000", buildingStyle: .cafe, sessions: [
                TownSession(id: "s1", name: nil, state: .waiting, lastActivityAt: 1),
            ]),
        ])
        let decoded = try JSONDecoder().decode(TownState.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(decoded, state)
        XCTAssertEqual(decoded.generatedAt, now)
        XCTAssertNil(decoded.projects[0].sessions[0].name)
    }

    // MARK: Builder

    func testFnv1aKnownVectors() {
        XCTAssertEqual(TownStateBuilder.fnv1a32(""), 0x811c_9dc5)
        XCTAssertEqual(TownStateBuilder.fnv1a32("a"), 0xe40c_292c)
        XCTAssertEqual(TownStateBuilder.fnv1a32("foobar"), 0xbf9c_f968)
        XCTAssertEqual(TownStateBuilder.fnv1a32("/a/foo"), 0x6477_8256)
        XCTAssertEqual(TownStateBuilder.fnv1a32("日本"), 0x9f26_ee51)  // hashed over UTF-8 bytes
    }

    func testProjectIdIsStableTwelveHexOfSHA256() {
        // printf '%s' '/a/foo' | shasum -a 256 | cut -c1-12
        XCTAssertEqual(TownStateBuilder.projectId(normalizedPath: "/a/foo"), "0d9e5d4d9171")
        XCTAssertEqual(TownStateBuilder.projectId(normalizedPath: "/Users/kevin/proj"), "841d93e42eaa")
        XCTAssertEqual(TownStateBuilder.projectId(normalizedPath: "/a/foo").count, 12)
    }

    func testAutoStyleIsStableAndMatchesFnvModTen() {
        XCTAssertEqual(TownStateBuilder.autoStyle(normalizedPath: "/a/foo"), .office)
        XCTAssertEqual(TownStateBuilder.autoStyle(normalizedPath: "/Users/kevin/proj"), .lab)
        XCTAssertEqual(TownStateBuilder.autoStyle(normalizedPath: "/a/foo"), TownStateBuilder.autoStyle(normalizedPath: "/a/foo"))
    }

    func testAutoStyleDistributionIsReasonable() {
        let styles = Set((0..<200).map { TownStateBuilder.autoStyle(normalizedPath: "/work/project-\($0)") })
        XCTAssertEqual(styles.count, BuildingStyle.allCases.count)
    }

    func testBuilderOrderMatchingAndStyles() throws {
        let projects = [
            ProjectConfig(path: "/a/foo", name: "Foo", color: "#111111", buildingStyle: "auto"),
            ProjectConfig(path: "/a/bar", name: "Bar", color: "#222222", buildingStyle: "greenhouse"),
            ProjectConfig(path: "/a/baz", name: "Baz", color: "#333333", buildingStyle: "not-a-style"),
        ]
        let sessions = [
            derived(makeSession(pid: 1, id: "late", cwd: "/a/bar/sub", startedAt: 300), .running),
            derived(makeSession(pid: 2, id: "unmatched", cwd: "/elsewhere", startedAt: 1)),
            derived(makeSession(pid: 3, id: "b", cwd: "/a/bar", startedAt: 100), .waiting),
            derived(makeSession(pid: 4, id: "a", cwd: "/a/bar", startedAt: 100), .idle),
            derived(makeSession(pid: 5, id: "nostart", cwd: "/a/bar")),
        ]
        let state = TownStateBuilder.build(projects: projects, sessions: sessions, dataSourceOk: true, nowMs: now)

        XCTAssertEqual(state.version, 1)
        XCTAssertEqual(state.generatedAt, now)
        XCTAssertTrue(state.dataSourceOk)
        XCTAssertEqual(state.projects.map(\.name), ["Foo", "Bar", "Baz"])  // config order
        XCTAssertEqual(state.projects.map(\.color), ["#111111", "#222222", "#333333"])
        XCTAssertEqual(state.projects[0].sessions, [])
        // sorted by startedAt (missing = 0) then id; the unmatched session is dropped
        XCTAssertEqual(state.projects[1].sessions.map(\.id), ["nostart", "a", "b", "late"])
        XCTAssertEqual(state.projects[1].sessions.map(\.state), [.idle, .idle, .waiting, .running])

        XCTAssertEqual(state.projects[0].id, TownStateBuilder.projectId(normalizedPath: "/a/foo"))
        XCTAssertEqual(state.projects[0].buildingStyle, .office)  // auto
        XCTAssertEqual(state.projects[1].buildingStyle, .greenhouse)  // explicit key
        XCTAssertEqual(state.projects[2].buildingStyle, TownStateBuilder.autoStyle(normalizedPath: "/a/baz"))  // unknown -> auto
    }

    func testBuilderCarriesNameAndLastActivity() {
        let file = makeSession(id: "s", cwd: "/a/foo/x", name: "Hello", startedAt: 1, statusUpdatedAt: 99)
        let state = TownStateBuilder.build(
            projects: [ProjectConfig(path: "/a/foo", name: "Foo")], sessions: [derived(file, .finished)],
            dataSourceOk: false, nowMs: now
        )
        XCTAssertFalse(state.dataSourceOk)
        XCTAssertEqual(state.projects[0].sessions, [TownSession(id: "s", name: "Hello", state: .finished, lastActivityAt: 99)])
    }

    // MARK: Equality / differ

    func testEqualityIgnoresGeneratedAt() {
        let a = TownState(generatedAt: 1, dataSourceOk: true, projects: [])
        let b = TownState(generatedAt: 2, dataSourceOk: true, projects: [])
        XCTAssertEqual(a, b)
        XCTAssertNotEqual(a, TownState(generatedAt: 1, dataSourceOk: false, projects: []))
    }

    func testDifferPushesFirstThenOnlyOnRealChange() {
        var differ = TownStateDiffer()
        var state = TownState(generatedAt: 1, dataSourceOk: true, projects: [
            TownProject(id: "p", name: "P", color: "#000000", buildingStyle: .lab, sessions: []),
        ])
        XCTAssertTrue(differ.shouldPush(state))          // first call
        XCTAssertFalse(differ.shouldPush(state))         // identical
        state.generatedAt = 2
        XCTAssertFalse(differ.shouldPush(state))         // generatedAt only
        state.projects[0].sessions.append(TownSession(id: "s", name: nil, state: .idle, lastActivityAt: 1))
        XCTAssertTrue(differ.shouldPush(state))          // new session
        XCTAssertFalse(differ.shouldPush(state))
        state.projects[0].sessions[0].state = .running
        XCTAssertTrue(differ.shouldPush(state))          // state change
        state.dataSourceOk = false
        XCTAssertTrue(differ.shouldPush(state))          // data source flag
    }

    // MARK: Engine (fixture directory + fake inspector + fake clock)

    private struct EngineRig {
        let dir: URL
        let inspector: FakeInspector
        let clock: FakeClock
        let engine: TownEngine
        let config: AppConfig
    }

    private func makeRig(projectPath: String = "/work/proj") throws -> EngineRig {
        let dir = try makeTempDirectory()
        let inspector = FakeInspector()
        let clock = FakeClock(now)
        let engine = TownEngine(reader: SessionReader(directory: dir), checker: ProcessChecker(inspector: inspector), clock: clock)
        let config = AppConfig(projects: [ProjectConfig(path: projectPath, name: "Proj")])
        return EngineRig(dir: dir, inspector: inspector, clock: clock, engine: engine, config: config)
    }

    func testEngineFirstTickAlwaysReturnsState() throws {
        let rig = try makeRig()
        let state = try XCTUnwrap(rig.engine.tick(config: rig.config))
        XCTAssertTrue(state.dataSourceOk)
        XCTAssertEqual(state.generatedAt, now)
        XCTAssertEqual(state.projects.count, 1)
        XCTAssertTrue(state.projects[0].sessions.isEmpty)
    }

    func testEngineUnchangedInputAndTimestampOnlyChangeDoNotPush() throws {
        let rig = try makeRig()
        try writeSessionJSON(to: rig.dir, pid: 11, sessionId: "s1", cwd: "/work/proj", status: "busy",
                             startedAt: now - 60_000, statusUpdatedAt: now - 1000, name: "Task")
        rig.inspector.setAlive(11, start: nil)

        let first = try XCTUnwrap(rig.engine.tick(config: rig.config))
        XCTAssertEqual(first.projects[0].sessions.map(\.state), [.running])
        XCTAssertEqual(first.projects[0].sessions.first?.name, "Task")

        XCTAssertNil(rig.engine.tick(config: rig.config))  // nothing changed
        rig.clock.now += 1000
        XCTAssertNil(rig.engine.tick(config: rig.config))  // only generatedAt moved
    }

    func testEngineFollowsStatusChangesAndProcessExit() throws {
        let rig = try makeRig()
        rig.inspector.setAlive(11, start: nil)
        try writeSessionJSON(to: rig.dir, pid: 11, sessionId: "s1", cwd: "/work/proj/sub", status: "busy",
                             startedAt: now - 60_000, statusUpdatedAt: now)
        XCTAssertEqual(rig.engine.tick(config: rig.config)?.projects[0].sessions.map(\.state), [.running])

        // busy -> idle: observed transition, so finished.
        rig.clock.now += 5000
        try writeSessionJSON(to: rig.dir, pid: 11, sessionId: "s1", cwd: "/work/proj/sub", status: "idle",
                             startedAt: now - 60_000, statusUpdatedAt: now + 4000)
        let finished = try XCTUnwrap(rig.engine.tick(config: rig.config))
        XCTAssertEqual(finished.projects[0].sessions.map(\.state), [.finished])
        XCTAssertEqual(finished.projects[0].sessions.first?.lastActivityAt, now + 4000)

        // Time passes beyond the 30 min window: finished -> idle is a real change.
        rig.clock.now = now + 4000 + 30 * 60_000
        XCTAssertEqual(rig.engine.tick(config: rig.config)?.projects[0].sessions.map(\.state), [.idle])

        // Process dies, the file lingers: the session disappears.
        rig.inspector.kill(11)
        XCTAssertEqual(rig.engine.tick(config: rig.config)?.projects[0].sessions.count, 0)
    }

    func testEngineDropsUnmatchedAndReusedPidSessions() throws {
        let rig = try makeRig()
        rig.inspector.setAlive(11, start: nil)
        rig.inspector.setAlive(12, start: 0)  // pid reused: far from the procStart below
        rig.inspector.setAlive(13, start: nil)
        try writeSessionJSON(to: rig.dir, pid: 11, sessionId: "mine", cwd: "/work/proj", status: "idle")
        try writeSessionJSON(to: rig.dir, pid: 12, sessionId: "reused", cwd: "/work/proj", status: "busy",
                             procStart: "Sun Oct 25 10:28:45 2026")
        try writeSessionJSON(to: rig.dir, pid: 13, sessionId: "other-project", cwd: "/elsewhere", status: "busy")
        let state = try XCTUnwrap(rig.engine.tick(config: rig.config))
        XCTAssertEqual(state.projects[0].sessions.map(\.id), ["mine"])
    }

    func testEngineReportsUnreadableDirectory() throws {
        let missing = try makeTempDirectory().appendingPathComponent("nope")
        let engine = TownEngine(reader: SessionReader(directory: missing), checker: ProcessChecker(inspector: FakeInspector()),
                                clock: FakeClock(now))
        let state = try XCTUnwrap(engine.tick(config: AppConfig(projects: [ProjectConfig(path: "/work/proj", name: "Proj")])))
        XCTAssertFalse(state.dataSourceOk)
        XCTAssertEqual(state.projects.count, 1)
    }

    func testEnginePushesWhenConfigChanges() throws {
        let rig = try makeRig()
        XCTAssertNotNil(rig.engine.tick(config: rig.config))
        XCTAssertNil(rig.engine.tick(config: rig.config))
        var renamed = rig.config
        renamed.projects[0].name = "Renamed"
        XCTAssertEqual(rig.engine.tick(config: renamed)?.projects[0].name, "Renamed")
    }

    func testEngineUsesSleepAndFinishedSettingsFromConfig() throws {
        let rig = try makeRig()
        rig.inspector.setAlive(11, start: nil)
        // Worked for a minute, then idle for 10 minutes.
        try writeSessionJSON(to: rig.dir, pid: 11, sessionId: "s1", cwd: "/work/proj", status: "idle",
                             startedAt: now - 11 * 60_000, statusUpdatedAt: now - 10 * 60_000)
        var config = rig.config
        XCTAssertEqual(rig.engine.tick(config: config)?.projects[0].sessions.map(\.state), [.finished])
        config.finishedWindowMinutes = 5
        XCTAssertEqual(rig.engine.tick(config: config)?.projects[0].sessions.map(\.state), [.idle])
        config.sleepThresholdMinutes = 10
        XCTAssertEqual(rig.engine.tick(config: config)?.projects[0].sessions.map(\.state), [.sleeping])
    }

    func testEngineReadsFixtureDirectoryEndToEnd() throws {
        let inspector = FakeInspector()
        for pid: Int32 in [10434, 20001, 20002, 20003, 20004, 20008] { inspector.setAlive(pid, start: nil) }
        let engine = TownEngine(
            reader: SessionReader(directory: try fixtureURL("sessions")),
            checker: ProcessChecker(inspector: inspector), clock: FakeClock(1_792_924_800_000)
        )
        let config = AppConfig(projects: [
            ProjectConfig(path: "/tmp/fixture/alpha", name: "Alpha"),
            ProjectConfig(path: "/tmp/fixture/beta", name: "Beta"),
        ])
        let state = try XCTUnwrap(engine.tick(config: config))
        XCTAssertEqual(state.projects[0].sessions.count, 3)  // noname, waiting, extra
        XCTAssertEqual(state.projects[1].sessions.count, 2)  // unknown-status, interactive-kind
        XCTAssertEqual(state.projects[0].sessions.first { $0.id == "sess-waiting" }?.state, .waiting)
        XCTAssertEqual(state.projects[0].sessions.first { $0.id == "sess-noname" }?.state, .running)
        XCTAssertNil(state.projects[0].sessions.first { $0.id == "sess-noname" }?.name)
    }
}
