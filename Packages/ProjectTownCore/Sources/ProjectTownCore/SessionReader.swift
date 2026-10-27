import Foundation
import os

/// `status` in `~/.claude/sessions/<pid>.json`. Unknown strings decode to `.idle` (HANDOFF §5.1).
public enum SessionStatus: String, Sendable, Decodable {
    case busy, idle, waiting

    public init(from decoder: Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = raw.flatMap(SessionStatus.init(rawValue:)) ?? .idle
    }
}

/// One `~/.claude/sessions/<pid>.json` file. Only pid, sessionId, cwd and status are required.
public struct SessionFile: Decodable, Sendable, Equatable {
    public var pid: Int32
    public var sessionId: String
    public var cwd: String
    public var status: SessionStatus
    public var startedAt: Int64?
    public var procStart: String?
    public var version: String?
    public var kind: String?
    public var entrypoint: String?
    public var name: String?
    public var nameSource: String?
    public var nameSince: Int64?
    public var updatedAt: Int64?
    public var statusUpdatedAt: Int64?
    public var waitingFor: String?

    /// HANDOFF §5.4.
    public var lastActivityAt: Int64 { statusUpdatedAt ?? updatedAt ?? startedAt ?? 0 }
}

public struct SessionReadResult: Sendable {
    public var sessions: [SessionFile]
    public var directoryReadable: Bool
}

public struct SessionReader: Sendable {
    private static let log = Logger.projectTown("SessionReader")

    public static var defaultDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/sessions", isDirectory: true)
    }

    private let directory: URL

    public init(directory: URL = SessionReader.defaultDirectory) {
        self.directory = directory
    }

    /// Reads every `*.json` file (the `*.key` files are ignored) and keeps interactive sessions only.
    public func read() -> SessionReadResult {
        let urls: [URL]
        do {
            urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        } catch {
            Self.log.error("Cannot read sessions directory: \(error.localizedDescription, privacy: .public)")
            return SessionReadResult(sessions: [], directoryReadable: false)
        }

        let decoder = JSONDecoder()
        var sessions: [SessionFile] = []
        for url in urls.filter({ $0.pathExtension == "json" }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            do {
                let file = try decoder.decode(SessionFile.self, from: Data(contentsOf: url))
                if file.kind == nil || file.kind == "interactive" { sessions.append(file) }
            } catch CocoaError.fileReadNoSuchFile {
                // The session ended between listing the directory and reading its file.
                continue
            } catch {
                Self.log.error("Skipping \(url.lastPathComponent, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
        return SessionReadResult(sessions: sessions, directoryReadable: true)
    }
}
