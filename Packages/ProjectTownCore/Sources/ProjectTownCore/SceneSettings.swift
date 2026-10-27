import Foundation

public enum SceneLocale: String, Codable, Sendable {
    case zhHant = "zh-Hant"
    case en

    /// The first language decides: Traditional Chinese variants map to `.zhHant`, everything else
    /// (including zh-Hans) to `.en`. The app passes `Bundle.main.preferredLocalizations`, i.e. the language the
    /// bundle already chose for the Swift UI (the first system language the app has a localization for).
    public static func resolve(preferredLanguages: [String]) -> SceneLocale {
        guard let first = preferredLanguages.first?.lowercased() else { return .en }
        let traditional = ["zh-hant", "zh-tw", "zh-hk", "zh-mo"]
        return traditional.contains(where: { first == $0 || first.hasPrefix($0 + "-") }) ? .zhHant : .en
    }
}

/// Sent to the web scene via `applySettings`; JSON must match `SceneSettings` in `web/src/types.ts`.
public struct SceneSettings: Codable, Sendable, Equatable {
    public enum DayNight: Codable, Sendable, Equatable {
        case realtime(sunrise: String, sunset: String)
        case cycle(periodMinutes: Int, dayRatio: Double, cycleEpoch: Int64)

        private enum CodingKeys: String, CodingKey { case mode, sunrise, sunset, periodMinutes, dayRatio, cycleEpoch }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(DayNightMode.self, forKey: .mode) {
            case .realtime:
                self = .realtime(sunrise: try c.decode(String.self, forKey: .sunrise),
                                 sunset: try c.decode(String.self, forKey: .sunset))
            case .cycle:
                self = .cycle(periodMinutes: try c.decode(Int.self, forKey: .periodMinutes),
                              dayRatio: try c.decode(Double.self, forKey: .dayRatio),
                              cycleEpoch: try c.decode(Int64.self, forKey: .cycleEpoch))
            }
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            switch self {
            case let .realtime(sunrise, sunset):
                try c.encode(DayNightMode.realtime, forKey: .mode)
                try c.encode(sunrise, forKey: .sunrise)
                try c.encode(sunset, forKey: .sunset)
            case let .cycle(periodMinutes, dayRatio, cycleEpoch):
                try c.encode(DayNightMode.cycle, forKey: .mode)
                try c.encode(periodMinutes, forKey: .periodMinutes)
                try c.encode(dayRatio, forKey: .dayRatio)
                try c.encode(cycleEpoch, forKey: .cycleEpoch)
            }
        }
    }

    public var locale: SceneLocale
    public var fps: Int
    public var hudVisible: Bool
    public var hideSessionNames: Bool
    public var depthOfField: Bool
    public var dayNight: DayNight
    public var camera: CameraConfig

    public static func make(config: AppConfig, locale: SceneLocale, cycleEpochMs: Int64) -> SceneSettings {
        let dayNight: DayNight
        switch config.dayNight.mode {
        case .realtime:
            dayNight = .realtime(sunrise: config.dayNight.sunrise, sunset: config.dayNight.sunset)
        case .cycle:
            dayNight = .cycle(periodMinutes: config.dayNight.cyclePeriodMinutes, dayRatio: config.dayNight.dayRatio,
                              cycleEpoch: cycleEpochMs)
        }
        return SceneSettings(
            locale: locale, fps: config.fps, hudVisible: config.hudVisible, hideSessionNames: config.hideSessionNames,
            depthOfField: config.depthOfField, dayNight: dayNight, camera: config.camera
        )
    }
}
