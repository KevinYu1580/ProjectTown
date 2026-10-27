import Foundation
import os

/// Reads and writes `config.json` (HANDOFF §9.1).
public struct ConfigStore: Sendable {
    private static let log = Logger.projectTown("ConfigStore")

    public static var defaultURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ProjectTown", isDirectory: true)
            .appendingPathComponent("config.json")
    }

    private let fileURL: URL
    private let clock: Clock

    public init(fileURL: URL = ConfigStore.defaultURL, clock: Clock = SystemClock()) {
        self.fileURL = fileURL
        self.clock = clock
    }

    /// Missing file: writes defaults. Unparseable file: moves it to `config.json.broken-<yyyyMMdd-HHmmss>`
    /// and writes defaults. The broken file is never overwritten or deleted.
    public func load() -> ConfigLoadResult {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            let config = AppConfig()
            writeDefaults(config)
            return .createdDefault(config)
        }
        do {
            return .loaded(try JSONDecoder().decode(AppConfig.self, from: Data(contentsOf: fileURL)))
        } catch {
            Self.log.error("Unreadable config, recovering: \(error.localizedDescription, privacy: .public)")
        }

        let config = AppConfig()
        guard let backup = moveAsideBrokenFile() else {
            // Could not preserve the broken file, so run on in-memory defaults and leave the file alone.
            return .loaded(config)
        }
        writeDefaults(config)
        return .recoveredFromBroken(config, backup: backup)
    }

    /// Atomic, pretty-printed write.
    public func save(_ config: AppConfig) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(config).write(to: fileURL, options: .atomic)
    }

    private func writeDefaults(_ config: AppConfig) {
        do { try save(config) } catch { Self.log.error("Cannot write default config: \(error.localizedDescription, privacy: .public)") }
    }

    private func moveAsideBrokenFile() -> URL? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let stamp = formatter.string(from: Date(timeIntervalSince1970: Double(clock.nowMs()) / 1000))
        let base = fileURL.lastPathComponent + ".broken-" + stamp
        let directory = fileURL.deletingLastPathComponent()

        for attempt in 0..<100 {
            let candidate = directory.appendingPathComponent(attempt == 0 ? base : "\(base)-\(attempt)")
            guard !FileManager.default.fileExists(atPath: candidate.path) else { continue }
            do {
                try FileManager.default.moveItem(at: fileURL, to: candidate)
                return candidate
            } catch {
                Self.log.error("Cannot back up broken config: \(error.localizedDescription, privacy: .public)")
                return nil
            }
        }
        return nil
    }
}
