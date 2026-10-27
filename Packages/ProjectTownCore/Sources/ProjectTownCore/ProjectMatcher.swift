import Foundation

/// Maps a session `cwd` to a configured project (HANDOFF §5.5).
public struct ProjectMatcher: Sendable {
    /// Lowercased path components per project; nil for an empty path (matches nothing).
    private let projects: [[String]?]

    public init(projectPaths: [String]) {
        projects = projectPaths.map { $0.isEmpty ? nil : Self.components(of: $0) }
    }

    /// Index of the project containing `cwd`; the longest match wins, nil when none.
    public func match(cwd: String) -> Int? {
        let target = Self.components(of: cwd)
        var best: (index: Int, count: Int)?
        for (index, project) in projects.enumerated() {
            guard let project, project.count <= target.count, Array(target.prefix(project.count)) == project else { continue }
            if best == nil || project.count > best!.count { best = (index, project.count) }
        }
        return best?.index
    }

    public static func normalize(_ path: String) -> String {
        guard !path.isEmpty else { return "" }
        let expanded = (path as NSString).expandingTildeInPath
        var result = URL(fileURLWithPath: expanded).resolvingSymlinksInPath().standardizedFileURL.path
        while result.count > 1, result.hasSuffix("/") { result.removeLast() }
        return result
    }

    private static func components(of path: String) -> [String] {
        normalize(path).split(separator: "/").map { $0.lowercased() }
    }
}
