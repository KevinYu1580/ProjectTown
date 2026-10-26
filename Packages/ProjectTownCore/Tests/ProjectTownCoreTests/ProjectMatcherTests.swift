import Foundation
import XCTest
@testable import ProjectTownCore

final class ProjectMatcherTests: XCTestCase {
    func testExactAndChildMatch() {
        let m = ProjectMatcher(projectPaths: ["/a/foo"])
        XCTAssertEqual(m.match(cwd: "/a/foo"), 0)
        XCTAssertEqual(m.match(cwd: "/a/foo/src/deep"), 0)
    }

    func testMatchesByComponentNotStringPrefix() {
        let m = ProjectMatcher(projectPaths: ["/a/foo"])
        XCTAssertNil(m.match(cwd: "/a/foobar"))
        XCTAssertNil(m.match(cwd: "/a/foobar/x"))
        XCTAssertNil(m.match(cwd: "/a"))
        XCTAssertEqual(ProjectMatcher(projectPaths: ["/a/foo", "/a/foobar"]).match(cwd: "/a/foobar/x"), 1)
    }

    func testNestedProjectsLongestWins() {
        let outerFirst = ProjectMatcher(projectPaths: ["/a/foo", "/a/foo/sub"])
        XCTAssertEqual(outerFirst.match(cwd: "/a/foo/sub/x"), 1)
        XCTAssertEqual(outerFirst.match(cwd: "/a/foo/other"), 0)
        let innerFirst = ProjectMatcher(projectPaths: ["/a/foo/sub", "/a/foo"])
        XCTAssertEqual(innerFirst.match(cwd: "/a/foo/sub/x"), 0)
        XCTAssertEqual(innerFirst.match(cwd: "/a/foo/other"), 1)
    }

    func testSymlinkedProjectPathMatchesRealCwd() throws {
        let root = try makeTempDirectory()
        let real = root.appendingPathComponent("real")
        try FileManager.default.createDirectory(at: real.appendingPathComponent("sub"), withIntermediateDirectories: true)
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)

        let viaLink = ProjectMatcher(projectPaths: [link.path])
        XCTAssertEqual(viaLink.match(cwd: real.appendingPathComponent("sub").path), 0)
        XCTAssertEqual(viaLink.match(cwd: link.appendingPathComponent("sub").path), 0)
        let viaReal = ProjectMatcher(projectPaths: [real.path])
        XCTAssertEqual(viaReal.match(cwd: link.appendingPathComponent("sub").path), 0)
    }

    func testCaseInsensitive() {
        let m = ProjectMatcher(projectPaths: ["/Users/Me/Proj"])
        XCTAssertEqual(m.match(cwd: "/users/me/PROJ/x"), 0)
    }

    func testTrailingSlash() {
        XCTAssertEqual(ProjectMatcher(projectPaths: ["/a/foo/"]).match(cwd: "/a/foo"), 0)
        XCTAssertEqual(ProjectMatcher(projectPaths: ["/a/foo"]).match(cwd: "/a/foo/"), 0)
        XCTAssertEqual(ProjectMatcher.normalize("/a/foo/"), "/a/foo")
        XCTAssertEqual(ProjectMatcher.normalize("/a/foo///"), "/a/foo")
        XCTAssertEqual(ProjectMatcher.normalize("/"), "/")
    }

    func testTildeExpansion() {
        let home = NSHomeDirectory()
        let m = ProjectMatcher(projectPaths: ["~/code/foo"])
        XCTAssertEqual(m.match(cwd: home + "/code/foo/bar"), 0)
        XCTAssertNil(m.match(cwd: home + "/code/foobar"))
        XCTAssertEqual(ProjectMatcher.normalize("~/code/foo"), ProjectMatcher.normalize(home + "/code/foo"))
    }

    func testWorktreeUnderProjectMatches() {
        let m = ProjectMatcher(projectPaths: ["/a/proj"])
        XCTAssertEqual(m.match(cwd: "/a/proj/.claude/worktrees/feature-x"), 0)
        XCTAssertEqual(m.match(cwd: "/a/proj/.claude/worktrees/feature-x/src"), 0)
        // A git worktree living outside the project directory does not count.
        XCTAssertNil(m.match(cwd: "/a/proj-worktrees/feature-x"))
    }

    func testNoMatch() {
        let m = ProjectMatcher(projectPaths: ["/a/foo", "/b/bar"])
        XCTAssertNil(m.match(cwd: "/c/baz"))
        XCTAssertNil(ProjectMatcher(projectPaths: []).match(cwd: "/a/foo"))
    }

    func testEmptyProjectPathMatchesNothing() {
        XCTAssertNil(ProjectMatcher(projectPaths: [""]).match(cwd: "/a/foo"))
    }

    func testNormalizeCollapsesDotSegments() {
        XCTAssertEqual(ProjectMatcher.normalize("/a/./foo/../foo"), "/a/foo")
    }
}
