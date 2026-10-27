import Foundation
import XCTest
@testable import ProjectTownCore

final class SceneSettingsTests: XCTestCase {
    private func json(_ settings: SceneSettings) throws -> [String: Any] {
        let data = try JSONEncoder().encode(settings)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testRealtimeShape() throws {
        let config = AppConfig(fps: 30, hudVisible: false, hideSessionNames: false, theme: .urban, depthOfField: false,
                               depthOfFieldStrength: 1.35, wallpaperSnapshot: true, dayNight: DayNightConfig(mode: .realtime, sunrise: "05:45", sunset: "19:10"))
        let settings = SceneSettings.make(config: config, locale: .zhHant, cycleEpochMs: 111)
        let j = try json(settings)
        XCTAssertEqual(Set(j.keys), ["locale", "fps", "hudVisible", "hideSessionNames", "theme", "depthOfField",
                                     "depthOfFieldStrength", "dayNight", "camera"])  // wallpaperSnapshot is Swift only
        XCTAssertEqual(j["locale"] as? String, "zh-Hant")
        XCTAssertEqual(j["fps"] as? Int, 30)
        XCTAssertEqual(j["hudVisible"] as? Bool, false)
        XCTAssertEqual(j["hideSessionNames"] as? Bool, false)
        XCTAssertEqual(j["theme"] as? String, "urban")
        XCTAssertEqual(j["depthOfField"] as? Bool, false)
        XCTAssertEqual(j["depthOfFieldStrength"] as? Double, 1.35)

        let dayNight = try XCTUnwrap(j["dayNight"] as? [String: Any])
        XCTAssertEqual(Set(dayNight.keys), ["mode", "sunrise", "sunset"])  // no cycle fields in realtime mode
        XCTAssertEqual(dayNight["mode"] as? String, "realtime")
        XCTAssertEqual(dayNight["sunrise"] as? String, "05:45")
        XCTAssertEqual(dayNight["sunset"] as? String, "19:10")
    }

    func testCycleShapeUsesInjectedEpoch() throws {
        let config = AppConfig(dayNight: DayNightConfig(mode: .cycle, sunrise: "05:45", sunset: "19:10",
                                                       cyclePeriodMinutes: 90, dayRatio: 0.7))
        let settings = SceneSettings.make(config: config, locale: .en, cycleEpochMs: 1_792_924_800_123)
        let dayNight = try XCTUnwrap(try json(settings)["dayNight"] as? [String: Any])
        XCTAssertEqual(Set(dayNight.keys), ["mode", "periodMinutes", "dayRatio", "cycleEpoch"])  // no sunrise/sunset
        XCTAssertEqual(dayNight["mode"] as? String, "cycle")
        XCTAssertEqual(dayNight["periodMinutes"] as? Int, 90)
        XCTAssertEqual(dayNight["dayRatio"] as? Double, 0.7)
        XCTAssertEqual(dayNight["cycleEpoch"] as? Int64, 1_792_924_800_123)
    }

    func testCameraShape() throws {
        let config = AppConfig(camera: CameraConfig(mode: .interval, intervalMinutes: 7, continuousPeriodMinutes: 45,
                                                    base: CameraBase(azimuthDeg: 225, pitchDeg: 35, zoom: 0.8, target: [1.5, -2])))
        let camera = try XCTUnwrap(try json(.make(config: config, locale: .en, cycleEpochMs: 0))["camera"] as? [String: Any])
        XCTAssertEqual(Set(camera.keys), ["mode", "intervalMinutes", "continuousPeriodMinutes", "base"])
        XCTAssertEqual(camera["mode"] as? String, "interval")
        XCTAssertEqual(camera["intervalMinutes"] as? Int, 7)
        XCTAssertEqual(camera["continuousPeriodMinutes"] as? Int, 45)
        let base = try XCTUnwrap(camera["base"] as? [String: Any])
        XCTAssertEqual(Set(base.keys), ["azimuthDeg", "pitchDeg", "zoom", "target"])
        XCTAssertEqual(base["azimuthDeg"] as? Double, 225)
        XCTAssertEqual(base["pitchDeg"] as? Double, 35)
        XCTAssertEqual(base["zoom"] as? Double, 0.8)
        XCTAssertEqual(base["target"] as? [Double], [1.5, -2])  // an array, not an object
    }

    func testCameraModeRawValues() throws {
        for (mode, raw) in [(CameraMode.fixed, "fixed"), (.interval, "interval"), (.continuous, "continuous")] {
            let camera = try XCTUnwrap(try json(.make(config: AppConfig(camera: CameraConfig(mode: mode)), locale: .en, cycleEpochMs: 0))["camera"] as? [String: Any])
            XCTAssertEqual(camera["mode"] as? String, raw)
        }
    }

    func testThemeRawValues() throws {
        for (theme, raw) in [(SceneTheme.pastoral, "pastoral"), (.urban, "urban")] {
            XCTAssertEqual(try json(.make(config: AppConfig(theme: theme), locale: .en, cycleEpochMs: 0))["theme"] as? String, raw)
        }
    }

    func testJSONRoundTripForBothModes() throws {
        for mode in [DayNightMode.realtime, .cycle] {
            let settings = SceneSettings.make(config: AppConfig(dayNight: DayNightConfig(mode: mode)), locale: .zhHant, cycleEpochMs: 42)
            let decoded = try JSONDecoder().decode(SceneSettings.self, from: JSONEncoder().encode(settings))
            XCTAssertEqual(decoded, settings)
        }
    }

    func testLocaleResolve() {
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-Hant-TW"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-Hant"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-Hant-HK", "en-US"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-TW"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-HK"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-MO"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-tw"]), .zhHant)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-Hans-CN"]), .en)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh-Hans"]), .en)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["zh"]), .en)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["en-US"]), .en)
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: ["ja-JP", "zh-Hant-TW"]), .en)  // first language decides
        XCTAssertEqual(SceneLocale.resolve(preferredLanguages: []), .en)
    }

    func testLocaleRawValues() {
        XCTAssertEqual(SceneLocale.zhHant.rawValue, "zh-Hant")
        XCTAssertEqual(SceneLocale.en.rawValue, "en")
    }
}
