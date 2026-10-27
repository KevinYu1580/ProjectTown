import Foundation

extension KeyedDecodingContainer {
    /// Decodes `key`, falling back to `defaultValue` when the key is absent.
    fileprivate func value<T: Decodable>(_ key: Key, default defaultValue: @autoclosure () -> T) throws -> T {
        try decodeIfPresent(T.self, forKey: key) ?? defaultValue()
    }
}

public struct ProjectConfig: Codable, Sendable, Equatable {
    public var path: String
    public var name: String
    public var color: String
    /// "auto" or a `BuildingStyle` key.
    public var buildingStyle: String

    public init(path: String, name: String, color: String = "#5B8DEF", buildingStyle: String = "auto") {
        self.path = path
        self.name = name
        self.color = color
        self.buildingStyle = buildingStyle
    }

    private enum CodingKeys: String, CodingKey { case path, name, color, buildingStyle }

    // Hand-edited in M2, so only `path` is required.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let path = try c.decode(String.self, forKey: .path)
        self.init(
            path: path,
            name: try c.value(.name, default: URL(fileURLWithPath: path).lastPathComponent),
            color: try c.value(.color, default: "#5B8DEF"),
            buildingStyle: try c.value(.buildingStyle, default: "auto")
        )
    }
}

public enum DayNightMode: String, Codable, Sendable { case realtime, cycle }
public enum CameraMode: String, Codable, Sendable { case fixed, interval, continuous }
/// What surrounds the town: countryside or a city neighbourhood.
public enum SceneTheme: String, Codable, Sendable { case pastoral, urban }

public struct CameraBase: Codable, Sendable, Equatable {
    public var azimuthDeg: Double
    public var pitchDeg: Double
    public var zoom: Double
    /// `[x, z]`.
    public var target: [Double]

    public init(azimuthDeg: Double = 45, pitchDeg: Double = 40, zoom: Double = 1, target: [Double] = [0, 0]) {
        self.azimuthDeg = azimuthDeg
        self.pitchDeg = pitchDeg
        self.zoom = zoom
        self.target = target
    }

    private enum CodingKeys: String, CodingKey { case azimuthDeg, pitchDeg, zoom, target }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let target: [Double] = try c.value(.target, default: [0, 0])
        self.init(
            azimuthDeg: try c.value(.azimuthDeg, default: 45),
            pitchDeg: try c.value(.pitchDeg, default: 40),
            zoom: try c.value(.zoom, default: 1),
            target: target.count == 2 ? target : [0, 0]  // the web side indexes target[0] and target[1]
        )
    }
}

public struct DayNightConfig: Codable, Sendable, Equatable {
    public var mode: DayNightMode
    public var sunrise: String
    public var sunset: String
    public var cyclePeriodMinutes: Int
    public var dayRatio: Double

    public init(mode: DayNightMode = .realtime, sunrise: String = "06:00", sunset: String = "18:00",
                cyclePeriodMinutes: Int = 60, dayRatio: Double = 0.5) {
        self.mode = mode
        self.sunrise = sunrise
        self.sunset = sunset
        self.cyclePeriodMinutes = cyclePeriodMinutes
        self.dayRatio = dayRatio
    }

    private enum CodingKeys: String, CodingKey { case mode, sunrise, sunset, cyclePeriodMinutes, dayRatio }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            mode: try c.value(.mode, default: .realtime),
            sunrise: try c.value(.sunrise, default: "06:00"),
            sunset: try c.value(.sunset, default: "18:00"),
            cyclePeriodMinutes: try c.value(.cyclePeriodMinutes, default: 60),
            dayRatio: try c.value(.dayRatio, default: 0.5)
        )
    }
}

public struct CameraConfig: Codable, Sendable, Equatable {
    public var mode: CameraMode
    public var intervalMinutes: Int
    public var continuousPeriodMinutes: Int
    public var base: CameraBase

    public init(mode: CameraMode = .fixed, intervalMinutes: Int = 10, continuousPeriodMinutes: Int = 60,
                base: CameraBase = CameraBase()) {
        self.mode = mode
        self.intervalMinutes = intervalMinutes
        self.continuousPeriodMinutes = continuousPeriodMinutes
        self.base = base
    }

    private enum CodingKeys: String, CodingKey { case mode, intervalMinutes, continuousPeriodMinutes, base }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            mode: try c.value(.mode, default: .fixed),
            intervalMinutes: try c.value(.intervalMinutes, default: 10),
            continuousPeriodMinutes: try c.value(.continuousPeriodMinutes, default: 60),
            base: try c.value(.base, default: CameraBase())
        )
    }
}

/// `config.json` (HANDOFF §9.1). Missing keys decode to the §9.1 defaults.
public struct AppConfig: Codable, Sendable, Equatable {
    public var version: Int
    public var projects: [ProjectConfig]
    public var fps: Int
    public var hudVisible: Bool
    public var hideSessionNames: Bool
    public var theme: SceneTheme
    public var depthOfField: Bool
    /// Multiplies the depth-of-field blur; 1 is the default look.
    public var depthOfFieldStrength: Double
    /// Height of the blurred band along the top and the bottom edge of the screen, as a fraction of its height.
    public var depthOfFieldRange: Double
    /// Swift only: keep the system wallpaper of the town's display set to a snapshot of the town.
    public var wallpaperSnapshot: Bool
    public var finishedWindowMinutes: Int
    public var sleepThresholdMinutes: Int
    public var dayNight: DayNightConfig
    public var camera: CameraConfig
    public var displayUUID: String?

    public init(version: Int = 1, projects: [ProjectConfig] = [], fps: Int = 15, hudVisible: Bool = false,
                hideSessionNames: Bool = true, theme: SceneTheme = .pastoral, depthOfField: Bool = true,
                depthOfFieldStrength: Double = 0.6, depthOfFieldRange: Double = 0.25, wallpaperSnapshot: Bool = true,
                finishedWindowMinutes: Int = 30,
                sleepThresholdMinutes: Int = 120, dayNight: DayNightConfig = DayNightConfig(),
                camera: CameraConfig = CameraConfig(), displayUUID: String? = nil) {
        self.version = version
        self.projects = projects
        self.fps = fps
        self.hudVisible = hudVisible
        self.hideSessionNames = hideSessionNames
        self.theme = theme
        self.depthOfField = depthOfField
        self.depthOfFieldStrength = depthOfFieldStrength
        self.depthOfFieldRange = depthOfFieldRange
        self.wallpaperSnapshot = wallpaperSnapshot
        self.finishedWindowMinutes = finishedWindowMinutes
        self.sleepThresholdMinutes = sleepThresholdMinutes
        self.dayNight = dayNight
        self.camera = camera
        self.displayUUID = displayUUID
    }

    private enum CodingKeys: String, CodingKey {
        case version, projects, fps, hudVisible, hideSessionNames, theme, depthOfField, depthOfFieldStrength, depthOfFieldRange
        case wallpaperSnapshot
        case finishedWindowMinutes, sleepThresholdMinutes, dayNight, camera, displayUUID
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppConfig()
        self.init(
            version: try c.value(.version, default: d.version),
            projects: try c.value(.projects, default: d.projects),
            fps: try c.value(.fps, default: d.fps),
            hudVisible: try c.value(.hudVisible, default: d.hudVisible),
            hideSessionNames: try c.value(.hideSessionNames, default: d.hideSessionNames),
            theme: try c.value(.theme, default: d.theme),
            depthOfField: try c.value(.depthOfField, default: d.depthOfField),
            depthOfFieldStrength: try c.value(.depthOfFieldStrength, default: d.depthOfFieldStrength),
            depthOfFieldRange: try c.value(.depthOfFieldRange, default: d.depthOfFieldRange),
            wallpaperSnapshot: try c.value(.wallpaperSnapshot, default: d.wallpaperSnapshot),
            finishedWindowMinutes: try c.value(.finishedWindowMinutes, default: d.finishedWindowMinutes),
            sleepThresholdMinutes: try c.value(.sleepThresholdMinutes, default: d.sleepThresholdMinutes),
            dayNight: try c.value(.dayNight, default: d.dayNight),
            camera: try c.value(.camera, default: d.camera),
            displayUUID: try c.decodeIfPresent(String.self, forKey: .displayUUID)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encode(projects, forKey: .projects)
        try c.encode(fps, forKey: .fps)
        try c.encode(hudVisible, forKey: .hudVisible)
        try c.encode(hideSessionNames, forKey: .hideSessionNames)
        try c.encode(theme, forKey: .theme)
        try c.encode(depthOfField, forKey: .depthOfField)
        try c.encode(depthOfFieldStrength, forKey: .depthOfFieldStrength)
        try c.encode(depthOfFieldRange, forKey: .depthOfFieldRange)
        try c.encode(wallpaperSnapshot, forKey: .wallpaperSnapshot)
        try c.encode(finishedWindowMinutes, forKey: .finishedWindowMinutes)
        try c.encode(sleepThresholdMinutes, forKey: .sleepThresholdMinutes)
        try c.encode(dayNight, forKey: .dayNight)
        try c.encode(camera, forKey: .camera)
        // §9.1 shows `"displayUUID": null`, so keep the key when unset.
        if let displayUUID { try c.encode(displayUUID, forKey: .displayUUID) } else { try c.encodeNil(forKey: .displayUUID) }
    }
}

public enum ConfigLoadResult: Sendable {
    case loaded(AppConfig)
    case createdDefault(AppConfig)
    case recoveredFromBroken(AppConfig, backup: URL)
}
