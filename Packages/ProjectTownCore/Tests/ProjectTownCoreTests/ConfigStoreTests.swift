import Foundation
import XCTest
@testable import ProjectTownCore

final class ConfigStoreTests: XCTestCase {
    private func makeStore(clockMs: Int64 = 1_792_924_800_000) throws -> (store: ConfigStore, url: URL, dir: URL) {
        let dir = try makeTempDirectory().appendingPathComponent("ProjectTown", isDirectory: true)
        let url = dir.appendingPathComponent("config.json")
        return (ConfigStore(fileURL: url, clock: FakeClock(clockMs)), url, dir)
    }

    private func jsonObject(at url: URL) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testDefaultsMatchSpec() {
        let c = AppConfig()
        XCTAssertEqual(c.version, 1)
        XCTAssertEqual(c.projects, [])
        XCTAssertEqual(c.fps, 60)
        XCTAssertTrue(c.hudVisible)
        XCTAssertTrue(c.hideSessionNames)
        XCTAssertEqual(c.theme, .pastoral)
        XCTAssertTrue(c.depthOfField)
        XCTAssertEqual(c.depthOfFieldStrength, 1)
        XCTAssertTrue(c.wallpaperSnapshot)
        XCTAssertEqual(c.finishedWindowMinutes, 30)
        XCTAssertEqual(c.sleepThresholdMinutes, 120)
        XCTAssertEqual(c.dayNight, DayNightConfig(mode: .realtime, sunrise: "06:00", sunset: "18:00", cyclePeriodMinutes: 60, dayRatio: 0.5))
        XCTAssertEqual(c.camera.mode, .fixed)
        XCTAssertEqual(c.camera.intervalMinutes, 10)
        XCTAssertEqual(c.camera.continuousPeriodMinutes, 60)
        XCTAssertEqual(c.camera.base, CameraBase(azimuthDeg: 45, pitchDeg: 40, zoom: 1, target: [0, 0]))
        XCTAssertNil(c.displayUUID)
    }

    func testMissingFileWritesDefaults() throws {
        let (store, url, _) = try makeStore()
        guard case let .createdDefault(config) = store.load() else { return XCTFail("expected createdDefault") }
        XCTAssertEqual(config, AppConfig())
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        let json = try jsonObject(at: url)
        XCTAssertEqual(json["version"] as? Int, 1)
        XCTAssertTrue(json["displayUUID"] is NSNull)  // key present as null
        // Second load reads it back.
        guard case let .loaded(again) = store.load() else { return XCTFail("expected loaded") }
        XCTAssertEqual(again, config)
    }

    func testDefaultFileJSONShape() throws {
        let (store, url, _) = try makeStore()
        _ = store.load()
        let json = try jsonObject(at: url)
        XCTAssertEqual(Set(json.keys), [
            "version", "projects", "fps", "hudVisible", "hideSessionNames", "theme", "depthOfField",
            "depthOfFieldStrength", "wallpaperSnapshot", "finishedWindowMinutes", "sleepThresholdMinutes", "dayNight",
            "camera", "displayUUID",
        ])
        XCTAssertEqual(json["theme"] as? String, "pastoral")
        XCTAssertEqual(json["depthOfFieldStrength"] as? Double, 1)
        XCTAssertEqual(json["wallpaperSnapshot"] as? Bool, true)
        let dayNight = try XCTUnwrap(json["dayNight"] as? [String: Any])
        XCTAssertEqual(Set(dayNight.keys), ["mode", "sunrise", "sunset", "cyclePeriodMinutes", "dayRatio"])
        XCTAssertEqual(dayNight["mode"] as? String, "realtime")
        let camera = try XCTUnwrap(json["camera"] as? [String: Any])
        XCTAssertEqual(Set(camera.keys), ["mode", "intervalMinutes", "continuousPeriodMinutes", "base"])
        let base = try XCTUnwrap(camera["base"] as? [String: Any])
        XCTAssertEqual(base["target"] as? [Double], [0, 0])
        // Pretty printed.
        XCTAssertTrue(try String(contentsOf: url, encoding: .utf8).contains("\n  \"camera\""))
    }

    func testRoundTrip() throws {
        let (store, url, _) = try makeStore()
        let config = AppConfig(
            projects: [
                ProjectConfig(path: "/a/foo", name: "Foo", color: "#112233", buildingStyle: "cafe"),
                ProjectConfig(path: "/a/bar baz", name: "Bar", color: "#445566", buildingStyle: "auto"),
            ],
            fps: 120, hudVisible: false, hideSessionNames: false, theme: .urban, depthOfField: false,
            depthOfFieldStrength: 1.65, wallpaperSnapshot: false, finishedWindowMinutes: 15, sleepThresholdMinutes: 60,
            dayNight: DayNightConfig(mode: .cycle, sunrise: "05:30", sunset: "19:45", cyclePeriodMinutes: 90, dayRatio: 0.7),
            camera: CameraConfig(mode: .continuous, intervalMinutes: 5, continuousPeriodMinutes: 30,
                                 base: CameraBase(azimuthDeg: 135, pitchDeg: 55, zoom: 1.5, target: [2, -3])),
            displayUUID: "ABCD-1234"
        )
        try store.save(config)
        guard case let .loaded(loaded) = store.load() else { return XCTFail("expected loaded") }
        XCTAssertEqual(loaded, config)
        XCTAssertFalse(try String(contentsOf: url, encoding: .utf8).contains("\\/"))  // slashes not escaped
    }

    func testSaveCreatesMissingDirectoryAndReplacesFile() throws {
        let (store, url, dir) = try makeStore()
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.path))
        try store.save(AppConfig(fps: 30))
        try store.save(AppConfig(fps: 15))
        XCTAssertEqual(try jsonObject(at: url)["fps"] as? Int, 15)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: dir.path), ["config.json"])  // no temp leftovers
    }

    func testMissingKeysDecodeToDefaults() throws {
        let (store, url, dir) = try makeStore()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(#"{ "fps": 30, "projects": [ { "path": "/a/foo" } ], "dayNight": { "mode": "cycle" }, "camera": { "base": { "zoom": 2 } } }"#.utf8)
            .write(to: url)
        guard case let .loaded(c) = store.load() else { return XCTFail("expected loaded") }
        XCTAssertEqual(c.fps, 30)
        XCTAssertEqual(c.version, 1)
        XCTAssertTrue(c.hideSessionNames)
        XCTAssertEqual(c.theme, .pastoral)
        XCTAssertEqual(c.depthOfFieldStrength, 1)
        XCTAssertTrue(c.wallpaperSnapshot)
        XCTAssertEqual(c.finishedWindowMinutes, 30)
        XCTAssertEqual(c.sleepThresholdMinutes, 120)
        XCTAssertEqual(c.projects, [ProjectConfig(path: "/a/foo", name: "foo", color: "#5B8DEF", buildingStyle: "auto")])
        XCTAssertEqual(c.dayNight, DayNightConfig(mode: .cycle))
        XCTAssertEqual(c.camera.mode, .fixed)
        XCTAssertEqual(c.camera.base, CameraBase(azimuthDeg: 45, pitchDeg: 40, zoom: 2, target: [0, 0]))
        XCTAssertNil(c.displayUUID)
    }

    func testEmptyObjectIsAllDefaults() throws {
        let (store, url, dir) = try makeStore()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: url)
        guard case let .loaded(c) = store.load() else { return XCTFail("expected loaded") }
        XCTAssertEqual(c, AppConfig())
    }

    func testNewKeysDecode() throws {
        let data = Data(#"{ "theme": "urban", "depthOfFieldStrength": 0.25, "wallpaperSnapshot": false }"#.utf8)
        let c = try JSONDecoder().decode(AppConfig.self, from: data)
        XCTAssertEqual(c.theme, .urban)
        XCTAssertEqual(c.depthOfFieldStrength, 0.25)
        XCTAssertFalse(c.wallpaperSnapshot)
    }

    func testUnknownThemeCountsAsBroken() throws {
        let (store, url, dir) = try makeStore()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(#"{ "theme": "desert" }"#.utf8).write(to: url)
        guard case .recoveredFromBroken = store.load() else { return XCTFail("expected recoveredFromBroken") }
    }

    func testMalformedTargetFallsBackToOrigin() throws {
        let data = Data(#"{ "camera": { "base": { "target": [1, 2, 3] } } }"#.utf8)
        XCTAssertEqual(try JSONDecoder().decode(AppConfig.self, from: data).camera.base.target, [0, 0])
    }

    func testBrokenFileIsBackedUpAndDefaultsWritten() throws {
        let (store, url, dir) = try makeStore(clockMs: 1_792_924_800_000)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let broken = "{ this is not json"
        try Data(broken.utf8).write(to: url)

        guard case let .recoveredFromBroken(config, backup) = store.load() else { return XCTFail("expected recoveredFromBroken") }
        XCTAssertEqual(config, AppConfig())
        XCTAssertEqual(try String(contentsOf: backup, encoding: .utf8), broken)  // content preserved
        XCTAssertEqual(backup.deletingLastPathComponent().standardizedFileURL, dir.standardizedFileURL)

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date(timeIntervalSince1970: 1_792_924_800))
        XCTAssertEqual(backup.lastPathComponent, "config.json.broken-\(stamp)")

        guard case let .loaded(fresh) = store.load() else { return XCTFail("defaults should now be on disk") }
        XCTAssertEqual(fresh, AppConfig())
    }

    func testWrongTypeCountsAsBroken() throws {
        let (store, url, dir) = try makeStore()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data(#"{ "fps": "sixty" }"#.utf8).write(to: url)
        guard case .recoveredFromBroken = store.load() else { return XCTFail("expected recoveredFromBroken") }
    }

    func testSecondBrokenFileInSameSecondKeepsBothBackups() throws {
        let (store, url, dir) = try makeStore()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try Data("first".utf8).write(to: url)
        guard case let .recoveredFromBroken(_, first) = store.load() else { return XCTFail() }
        try Data("second".utf8).write(to: url)
        guard case let .recoveredFromBroken(_, second) = store.load() else { return XCTFail() }
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(try String(contentsOf: first, encoding: .utf8), "first")
        XCTAssertEqual(try String(contentsOf: second, encoding: .utf8), "second")
    }

    func testDefaultURLIsInApplicationSupport() {
        XCTAssertTrue(ConfigStore.defaultURL.path.hasSuffix("/Application Support/ProjectTown/config.json"))
    }
}
