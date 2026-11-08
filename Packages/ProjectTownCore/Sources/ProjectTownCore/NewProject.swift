import Foundation

/// The preset colour palette for new projects, in fixed order.
public enum ProjectPalette {
    public static let colors = ["#5B8DEF", "#F2994A", "#27AE60", "#EB5757", "#9B51E0", "#F2C94C", "#2D9CDB", "#E36FA8"]

    /// The colour for the project added when `projectCount` projects exist; wraps around.
    public static func color(forProjectCount projectCount: Int) -> String {
        colors[((projectCount % colors.count) + colors.count) % colors.count]
    }
}

public struct AddProjectsResult: Sendable, Equatable {
    public var projects: [ProjectConfig]
    /// Input paths skipped because they match an existing (or earlier) project.
    public var duplicates: [String]
}

extension ProjectConfig {
    /// Appends a project per path: name = folder name, next palette colour, style "auto". A path whose
    /// `ProjectMatcher.normalize` form (case-insensitive) equals an existing project's is skipped and reported.
    public static func adding(paths: [String], to projects: [ProjectConfig]) -> AddProjectsResult {
        var result = AddProjectsResult(projects: projects, duplicates: [])
        var seen = Set(projects.map { key(for: $0.path) })
        for path in paths {
            guard seen.insert(key(for: path)).inserted else {
                result.duplicates.append(path)
                continue
            }
            result.projects.append(ProjectConfig(
                path: path,
                name: URL(fileURLWithPath: path).lastPathComponent,
                color: ProjectPalette.color(forProjectCount: result.projects.count)
            ))
        }
        return result
    }

    private static func key(for path: String) -> String { ProjectMatcher.normalize(path).lowercased() }
}
