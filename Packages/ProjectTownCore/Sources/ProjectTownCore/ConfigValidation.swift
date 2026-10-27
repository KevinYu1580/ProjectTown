import Foundation

/// Allowed ranges for user-editable settings (HANDOFF §8.8, §9.2). Shared by validation and the settings UI.
public enum ConfigLimits {
    public static let fps = [15, 30, 60, 120]
    public static let finishedWindowMinutes = 1...240
    public static let sleepThresholdMinutes = 10...1440
    public static let cyclePeriodMinutes = 5...1440
    public static let dayRatio = 0.1...0.9
    public static let intervalMinutes = 1...60
    public static let continuousPeriodMinutes = 2...60
    public static let pitchDeg = 20.0...70.0
    public static let zoom = 0.5...3.0
    public static let depthOfFieldStrength = 0.25...2.0
}

/// One reason a config is invalid; carries the offending value.
public enum ConfigIssue: Sendable, Equatable {
    case fps(Int)
    case finishedWindowMinutes(Int)
    case sleepThresholdMinutes(Int)
    /// `sleepThresholdMinutes` must be strictly greater than `finishedWindowMinutes`.
    case sleepThresholdNotAfterFinishedWindow(sleep: Int, finished: Int)
    case sunrise(String)
    case sunset(String)
    /// Sunset must be strictly later than sunrise (both valid "HH:mm").
    case sunsetNotAfterSunrise(sunrise: String, sunset: String)
    case cyclePeriodMinutes(Int)
    case dayRatio(Double)
    case cameraIntervalMinutes(Int)
    case cameraContinuousPeriodMinutes(Int)
    case cameraPitchDeg(Double)
    case cameraZoom(Double)
    case depthOfFieldStrength(Double)
}

extension AppConfig {
    /// All rule violations, empty when valid. Every field is checked regardless of the active day/night or
    /// camera mode, so a stored config never carries an out-of-range value in an inactive mode.
    public func validate() -> [ConfigIssue] {
        var issues: [ConfigIssue] = []

        if !ConfigLimits.fps.contains(fps) { issues.append(.fps(fps)) }
        if !ConfigLimits.finishedWindowMinutes.contains(finishedWindowMinutes) {
            issues.append(.finishedWindowMinutes(finishedWindowMinutes))
        }
        if !ConfigLimits.sleepThresholdMinutes.contains(sleepThresholdMinutes) {
            issues.append(.sleepThresholdMinutes(sleepThresholdMinutes))
        }
        if sleepThresholdMinutes <= finishedWindowMinutes {
            issues.append(.sleepThresholdNotAfterFinishedWindow(sleep: sleepThresholdMinutes, finished: finishedWindowMinutes))
        }

        let sunrise = Self.minutesOfDay(dayNight.sunrise)
        let sunset = Self.minutesOfDay(dayNight.sunset)
        if sunrise == nil { issues.append(.sunrise(dayNight.sunrise)) }
        if sunset == nil { issues.append(.sunset(dayNight.sunset)) }
        if let sunrise, let sunset, sunset <= sunrise {
            issues.append(.sunsetNotAfterSunrise(sunrise: dayNight.sunrise, sunset: dayNight.sunset))
        }
        if !ConfigLimits.cyclePeriodMinutes.contains(dayNight.cyclePeriodMinutes) {
            issues.append(.cyclePeriodMinutes(dayNight.cyclePeriodMinutes))
        }
        if !ConfigLimits.dayRatio.contains(dayNight.dayRatio) { issues.append(.dayRatio(dayNight.dayRatio)) }

        if !ConfigLimits.intervalMinutes.contains(camera.intervalMinutes) {
            issues.append(.cameraIntervalMinutes(camera.intervalMinutes))
        }
        if !ConfigLimits.continuousPeriodMinutes.contains(camera.continuousPeriodMinutes) {
            issues.append(.cameraContinuousPeriodMinutes(camera.continuousPeriodMinutes))
        }
        // NaN is not contained in any range, so it is rejected too.
        if !ConfigLimits.pitchDeg.contains(camera.base.pitchDeg) { issues.append(.cameraPitchDeg(camera.base.pitchDeg)) }
        if !ConfigLimits.zoom.contains(camera.base.zoom) { issues.append(.cameraZoom(camera.base.zoom)) }
        if !ConfigLimits.depthOfFieldStrength.contains(depthOfFieldStrength) {
            issues.append(.depthOfFieldStrength(depthOfFieldStrength))
        }

        return issues
    }

    /// Copy with each setting group that has an issue reset to its default; valid groups are kept.
    /// Groups: fps; finished/sleep pair; day/night; camera interval; camera period; camera view; blur strength.
    public func repaired() -> AppConfig {
        var fixed = self
        let defaults = AppConfig()
        for issue in validate() {
            switch issue {
            case .fps:
                fixed.fps = defaults.fps
            case .finishedWindowMinutes, .sleepThresholdMinutes, .sleepThresholdNotAfterFinishedWindow:
                fixed.finishedWindowMinutes = defaults.finishedWindowMinutes
                fixed.sleepThresholdMinutes = defaults.sleepThresholdMinutes
            case .sunrise, .sunset, .sunsetNotAfterSunrise, .cyclePeriodMinutes, .dayRatio:
                fixed.dayNight = defaults.dayNight
            case .cameraIntervalMinutes:
                fixed.camera.intervalMinutes = defaults.camera.intervalMinutes
            case .cameraContinuousPeriodMinutes:
                fixed.camera.continuousPeriodMinutes = defaults.camera.continuousPeriodMinutes
            case .cameraPitchDeg, .cameraZoom:
                fixed.camera.base = defaults.camera.base
            case .depthOfFieldStrength:
                fixed.depthOfFieldStrength = defaults.depthOfFieldStrength
            }
        }
        return fixed
    }

    /// Minutes since midnight for a strict "HH:mm" (two digits each, 00:00–23:59); nil otherwise.
    private static func minutesOfDay(_ s: String) -> Int? {
        let parts = s.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts.allSatisfy({ $0.count == 2 && $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              let h = Int(parts[0]), let m = Int(parts[1]), h < 24, m < 60 else { return nil }
        return h * 60 + m
    }
}
