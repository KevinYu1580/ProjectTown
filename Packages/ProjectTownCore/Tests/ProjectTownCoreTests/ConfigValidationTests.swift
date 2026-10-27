import Foundation
import XCTest
@testable import ProjectTownCore

final class ConfigValidationTests: XCTestCase {
    private func issues(_ edit: (inout AppConfig) -> Void) -> [ConfigIssue] {
        var config = AppConfig()
        edit(&config)
        return config.validate()
    }

    func testDefaultsAreValid() {
        XCTAssertEqual(AppConfig().validate(), [])
    }

    func testFps() {
        for fps in [15, 30, 60, 120] { XCTAssertEqual(issues { $0.fps = fps }, [], "fps \(fps)") }
        for fps in [0, 14, 16, 24, 59, 90, 121, -30] { XCTAssertEqual(issues { $0.fps = fps }, [.fps(fps)], "fps \(fps)") }
    }

    func testFinishedWindowBoundaries() {
        XCTAssertEqual(issues { $0.finishedWindowMinutes = 1 }, [])
        XCTAssertEqual(issues { $0.finishedWindowMinutes = 240; $0.sleepThresholdMinutes = 241 }, [])
        XCTAssertEqual(issues { $0.finishedWindowMinutes = 0 }, [.finishedWindowMinutes(0)])
        XCTAssertEqual(issues { $0.finishedWindowMinutes = 241; $0.sleepThresholdMinutes = 300 }, [.finishedWindowMinutes(241)])
    }

    func testSleepThresholdBoundaries() {
        XCTAssertEqual(issues { $0.sleepThresholdMinutes = 10; $0.finishedWindowMinutes = 9 }, [])
        XCTAssertEqual(issues { $0.sleepThresholdMinutes = 1440 }, [])
        XCTAssertEqual(issues { $0.sleepThresholdMinutes = 9; $0.finishedWindowMinutes = 5 }, [.sleepThresholdMinutes(9)])
        XCTAssertEqual(issues { $0.sleepThresholdMinutes = 1441 }, [.sleepThresholdMinutes(1441)])
    }

    func testSleepMustBeStrictlyGreaterThanFinishedWindow() {
        XCTAssertEqual(issues { $0.finishedWindowMinutes = 30; $0.sleepThresholdMinutes = 31 }, [])
        XCTAssertEqual(
            issues { $0.finishedWindowMinutes = 30; $0.sleepThresholdMinutes = 30 },
            [.sleepThresholdNotAfterFinishedWindow(sleep: 30, finished: 30)]
        )
        XCTAssertEqual(
            issues { $0.finishedWindowMinutes = 60; $0.sleepThresholdMinutes = 30 },
            [.sleepThresholdNotAfterFinishedWindow(sleep: 30, finished: 60)]
        )
        // Equal values at the lower bound of sleep are reported once per rule that fails.
        XCTAssertEqual(
            issues { $0.finishedWindowMinutes = 20; $0.sleepThresholdMinutes = 9 },
            [.sleepThresholdMinutes(9), .sleepThresholdNotAfterFinishedWindow(sleep: 9, finished: 20)]
        )
    }

    func testSunriseSunsetFormat() {
        for bad in ["", "6:00", "06:0", "0600", "06:00:00", "24:00", "12:60", "ab:cd", "-1:00", "06 :00", "０６:００", " 06:00"] {
            XCTAssertEqual(issues { $0.dayNight.sunrise = bad }, [.sunrise(bad)], "sunrise '\(bad)'")
            XCTAssertEqual(issues { $0.dayNight.sunset = bad }, [.sunset(bad)], "sunset '\(bad)'")
        }
        XCTAssertEqual(issues { $0.dayNight.sunrise = "00:00"; $0.dayNight.sunset = "23:59" }, [])
    }

    func testSunsetMustBeStrictlyAfterSunrise() {
        XCTAssertEqual(issues { $0.dayNight.sunrise = "06:00"; $0.dayNight.sunset = "06:01" }, [])
        XCTAssertEqual(
            issues { $0.dayNight.sunrise = "06:00"; $0.dayNight.sunset = "06:00" },
            [.sunsetNotAfterSunrise(sunrise: "06:00", sunset: "06:00")]
        )
        XCTAssertEqual(
            issues { $0.dayNight.sunrise = "18:00"; $0.dayNight.sunset = "06:00" },
            [.sunsetNotAfterSunrise(sunrise: "18:00", sunset: "06:00")]
        )
        // A malformed side reports its own issue, not an ordering issue.
        XCTAssertEqual(issues { $0.dayNight.sunset = "bad" }, [.sunset("bad")])
    }

    func testDayNightRulesApplyInCycleModeToo() {
        XCTAssertEqual(
            issues { $0.dayNight.mode = .cycle; $0.dayNight.sunset = "06:00" },
            [.sunsetNotAfterSunrise(sunrise: "06:00", sunset: "06:00")]
        )
    }

    func testCyclePeriodBoundaries() {
        XCTAssertEqual(issues { $0.dayNight.cyclePeriodMinutes = 5 }, [])
        XCTAssertEqual(issues { $0.dayNight.cyclePeriodMinutes = 1440 }, [])
        XCTAssertEqual(issues { $0.dayNight.cyclePeriodMinutes = 4 }, [.cyclePeriodMinutes(4)])
        XCTAssertEqual(issues { $0.dayNight.cyclePeriodMinutes = 1441 }, [.cyclePeriodMinutes(1441)])
    }

    func testDayRatioBoundaries() {
        XCTAssertEqual(issues { $0.dayNight.dayRatio = 0.1 }, [])
        XCTAssertEqual(issues { $0.dayNight.dayRatio = 0.9 }, [])
        XCTAssertEqual(issues { $0.dayNight.dayRatio = 0.09 }, [.dayRatio(0.09)])
        XCTAssertEqual(issues { $0.dayNight.dayRatio = 0.91 }, [.dayRatio(0.91)])
        XCTAssertEqual(issues { $0.dayNight.dayRatio = 0 }, [.dayRatio(0)])
        XCTAssertEqual(issues { $0.dayNight.dayRatio = 1 }, [.dayRatio(1)])
        XCTAssertEqual(issues { $0.dayNight.dayRatio = .nan }.count, 1)
    }

    func testCameraIntervalBoundaries() {
        XCTAssertEqual(issues { $0.camera.intervalMinutes = 1 }, [])
        XCTAssertEqual(issues { $0.camera.intervalMinutes = 60 }, [])
        XCTAssertEqual(issues { $0.camera.intervalMinutes = 0 }, [.cameraIntervalMinutes(0)])
        XCTAssertEqual(issues { $0.camera.intervalMinutes = 61 }, [.cameraIntervalMinutes(61)])
    }

    func testCameraContinuousPeriodBoundaries() {
        XCTAssertEqual(issues { $0.camera.continuousPeriodMinutes = 2 }, [])
        XCTAssertEqual(issues { $0.camera.continuousPeriodMinutes = 60 }, [])
        XCTAssertEqual(issues { $0.camera.continuousPeriodMinutes = 1 }, [.cameraContinuousPeriodMinutes(1)])
        XCTAssertEqual(issues { $0.camera.continuousPeriodMinutes = 61 }, [.cameraContinuousPeriodMinutes(61)])
    }

    func testCameraPitchBoundaries() {
        XCTAssertEqual(issues { $0.camera.base.pitchDeg = 20 }, [])
        XCTAssertEqual(issues { $0.camera.base.pitchDeg = 70 }, [])
        XCTAssertEqual(issues { $0.camera.base.pitchDeg = 19.9 }, [.cameraPitchDeg(19.9)])
        XCTAssertEqual(issues { $0.camera.base.pitchDeg = 70.1 }, [.cameraPitchDeg(70.1)])
        XCTAssertEqual(issues { $0.camera.base.pitchDeg = .nan }.count, 1)
    }

    func testCameraZoomBoundaries() {
        XCTAssertEqual(issues { $0.camera.base.zoom = 0.5 }, [])
        XCTAssertEqual(issues { $0.camera.base.zoom = 3 }, [])
        XCTAssertEqual(issues { $0.camera.base.zoom = 0.49 }, [.cameraZoom(0.49)])
        XCTAssertEqual(issues { $0.camera.base.zoom = 3.01 }, [.cameraZoom(3.01)])
    }

    func testDepthOfFieldStrengthBoundaries() {
        XCTAssertEqual(issues { $0.depthOfFieldStrength = 0.25 }, [])
        XCTAssertEqual(issues { $0.depthOfFieldStrength = 2 }, [])
        XCTAssertEqual(issues { $0.depthOfFieldStrength = 0.24 }, [.depthOfFieldStrength(0.24)])
        XCTAssertEqual(issues { $0.depthOfFieldStrength = 2.01 }, [.depthOfFieldStrength(2.01)])
        XCTAssertEqual(issues { $0.depthOfFieldStrength = 0 }, [.depthOfFieldStrength(0)])
        XCTAssertEqual(issues { $0.depthOfFieldStrength = .nan }.count, 1)
    }

    func testDepthOfFieldRangeBoundaries() {
        XCTAssertEqual(issues { $0.depthOfFieldRange = 0 }, [])
        XCTAssertEqual(issues { $0.depthOfFieldRange = 0.45 }, [])
        XCTAssertEqual(issues { $0.depthOfFieldRange = -0.01 }, [.depthOfFieldRange(-0.01)])
        XCTAssertEqual(issues { $0.depthOfFieldRange = 0.46 }, [.depthOfFieldRange(0.46)])
        XCTAssertEqual(issues { $0.depthOfFieldRange = .nan }.count, 1)
    }

    func testRepairedResetsOnlyBlurStrength() {
        let config = AppConfig(fps: 30, theme: .urban, depthOfField: false, depthOfFieldStrength: 5, depthOfFieldRange: 0.9,
                               wallpaperSnapshot: false)
        let repaired = config.repaired()
        XCTAssertEqual(repaired.validate(), [])
        XCTAssertEqual(repaired.depthOfFieldStrength, 0.6)
        XCTAssertEqual(repaired.depthOfFieldRange, 0.25)
        XCTAssertEqual(repaired.theme, .urban)
        XCTAssertFalse(repaired.depthOfField)
        XCTAssertFalse(repaired.wallpaperSnapshot)
        XCTAssertEqual(repaired.fps, 30)
    }

    func testMultipleIssuesAreAllReported() {
        let result = issues {
            $0.fps = 7
            $0.dayNight.dayRatio = 2
            $0.camera.base.zoom = 0
        }
        XCTAssertEqual(result, [.fps(7), .dayRatio(2), .cameraZoom(0)])
    }

    func testRepairedKeepsValidSettingsAndResetsOnlyOffendingGroups() {
        var config = AppConfig(projects: [ProjectConfig(path: "/a", name: "a")], fps: 30, hudVisible: true, displayUUID: "ABC")
        config.camera.mode = .continuous
        config.camera.base = CameraBase(azimuthDeg: 200, pitchDeg: 50, zoom: 2, target: [1, 2])
        config.sleepThresholdMinutes = 5
        config.dayNight.sunset = "05:00"
        config.dayNight.cyclePeriodMinutes = 90

        let repaired = config.repaired()

        XCTAssertEqual(repaired.validate(), [])
        // Offending groups are back to defaults.
        XCTAssertEqual(repaired.sleepThresholdMinutes, 120)
        XCTAssertEqual(repaired.dayNight, DayNightConfig())
        // Everything else survives.
        XCTAssertEqual(repaired.projects, config.projects)
        XCTAssertEqual(repaired.fps, 30)
        XCTAssertTrue(repaired.hudVisible)
        XCTAssertEqual(repaired.displayUUID, "ABC")
        XCTAssertEqual(repaired.camera, config.camera)
    }

    func testRepairedResetsEachCameraGroupSeparately() {
        var config = AppConfig()
        config.camera.mode = .interval
        config.camera.intervalMinutes = 0
        config.camera.continuousPeriodMinutes = 30
        config.camera.base = CameraBase(azimuthDeg: 200, pitchDeg: 50, zoom: 9, target: [1, 2])

        let repaired = config.repaired()

        XCTAssertEqual(repaired.validate(), [])
        XCTAssertEqual(repaired.camera.mode, .interval)
        XCTAssertEqual(repaired.camera.intervalMinutes, 10)
        XCTAssertEqual(repaired.camera.continuousPeriodMinutes, 30)
        XCTAssertEqual(repaired.camera.base, CameraBase())
    }

    func testRepairedIsIdentityForValidConfig() {
        let config = AppConfig(fps: 30, displayUUID: "ABC")
        XCTAssertEqual(config.repaired(), config)
    }
}
