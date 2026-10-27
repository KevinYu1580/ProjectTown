import CryptoKit
import Foundation

/// JSON shapes here must match `web/src/types.ts` exactly.
public enum BuildingStyle: String, Codable, Sendable, CaseIterable {
    case office, factory, cafe, bookstore, lab, warehouse, radioTower, greenhouse, clockTower, ramenShop
}

public struct TownSession: Codable, Sendable, Equatable {
    public var id: String
    public var name: String?
    public var state: SessionState
    public var lastActivityAt: Int64

    private enum CodingKeys: String, CodingKey { case id, name, state, lastActivityAt }

    public init(id: String, name: String?, state: SessionState, lastActivityAt: Int64) {
        self.id = id
        self.name = name
        self.state = state
        self.lastActivityAt = lastActivityAt
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        // The web side expects `name: string | null`, so a missing name is an explicit null.
        if let name { try container.encode(name, forKey: .name) } else { try container.encodeNil(forKey: .name) }
        try container.encode(state, forKey: .state)
        try container.encode(lastActivityAt, forKey: .lastActivityAt)
    }
}

public struct TownProject: Codable, Sendable, Equatable {
    public var id: String
    public var name: String
    public var color: String
    public var buildingStyle: BuildingStyle
    public var sessions: [TownSession]

    public init(id: String, name: String, color: String, buildingStyle: BuildingStyle, sessions: [TownSession]) {
        self.id = id
        self.name = name
        self.color = color
        self.buildingStyle = buildingStyle
        self.sessions = sessions
    }
}

public struct TownState: Codable, Sendable, Equatable {
    public var version: Int = 1
    public var generatedAt: Int64
    public var dataSourceOk: Bool
    public var projects: [TownProject]

    public init(generatedAt: Int64, dataSourceOk: Bool, projects: [TownProject]) {
        self.generatedAt = generatedAt
        self.dataSourceOk = dataSourceOk
        self.projects = projects
    }

    /// `generatedAt` is ignored so a new timestamp alone never triggers a push (HANDOFF §5.6).
    public static func == (lhs: TownState, rhs: TownState) -> Bool {
        lhs.version == rhs.version && lhs.dataSourceOk == rhs.dataSourceOk && lhs.projects == rhs.projects
    }
}

public enum TownStateBuilder {
    public static func build(projects: [ProjectConfig], sessions: [DerivedSession], dataSourceOk: Bool, nowMs: Int64) -> TownState {
        let matcher = ProjectMatcher(projectPaths: projects.map(\.path))
        var buckets = [[DerivedSession]](repeating: [], count: projects.count)
        for session in sessions {
            if let index = matcher.match(cwd: session.file.cwd) { buckets[index].append(session) }  // unmatched are dropped
        }

        let townProjects = zip(projects, buckets).map { project, bucket -> TownProject in
            let path = ProjectMatcher.normalize(project.path)
            let ordered = bucket.sorted {
                ($0.file.startedAt ?? 0, $0.file.sessionId) < ($1.file.startedAt ?? 0, $1.file.sessionId)
            }
            return TownProject(
                id: projectId(normalizedPath: path),
                name: project.name,
                color: project.color,
                buildingStyle: BuildingStyle(rawValue: project.buildingStyle) ?? autoStyle(normalizedPath: path),
                sessions: ordered.map {
                    TownSession(id: $0.file.sessionId, name: $0.file.name, state: $0.state, lastActivityAt: $0.lastActivityAt)
                }
            )
        }
        return TownState(generatedAt: nowMs, dataSourceOk: dataSourceOk, projects: townProjects)
    }

    /// First 12 hex characters of SHA-256 over the normalized path.
    public static func projectId(normalizedPath: String) -> String {
        let digest = SHA256.hash(data: Data(normalizedPath.utf8))
        return String(digest.map { String(format: "%02x", $0) }.joined().prefix(12))
    }

    public static func autoStyle(normalizedPath: String) -> BuildingStyle {
        BuildingStyle.allCases[Int(fnv1a32(normalizedPath) % UInt32(BuildingStyle.allCases.count))]
    }

    /// FNV-1a over UTF-8 bytes; must stay identical to the web implementation.
    public static func fnv1a32(_ s: String) -> UInt32 {
        var hash: UInt32 = 2_166_136_261
        for byte in s.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return hash
    }
}

/// Remembers the last pushed state and says whether a new one is worth pushing.
public struct TownStateDiffer {
    private var last: TownState?

    public init() {}

    /// True for the first call and whenever `s` differs from the last pushed state (ignoring `generatedAt`).
    public mutating func shouldPush(_ s: TownState) -> Bool {
        guard last != s else { return false }
        last = s
        return true
    }
}
