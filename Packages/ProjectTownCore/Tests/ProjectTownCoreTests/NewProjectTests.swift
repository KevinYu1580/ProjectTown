import Foundation
import XCTest
@testable import ProjectTownCore

final class NewProjectTests: XCTestCase {
    func testPaletteIsTheFixedEightColours() {
        XCTAssertEqual(ProjectPalette.colors, ["#5B8DEF", "#F2994A", "#27AE60", "#EB5757", "#9B51E0", "#F2C94C", "#2D9CDB", "#E36FA8"])
    }

    func testPaletteWrapsAroundAfterEight() {
        XCTAssertEqual(ProjectPalette.color(forProjectCount: 0), "#5B8DEF")
        XCTAssertEqual(ProjectPalette.color(forProjectCount: 7), "#E36FA8")
        XCTAssertEqual(ProjectPalette.color(forProjectCount: 8), "#5B8DEF")
        XCTAssertEqual(ProjectPalette.color(forProjectCount: 9), "#F2994A")
    }

    func testNameIsFolderNameAndDefaults() {
        let result = ProjectConfig.adding(paths: ["/a/b/MyProj"], to: [])
        XCTAssertEqual(result.projects, [ProjectConfig(path: "/a/b/MyProj", name: "MyProj", color: "#5B8DEF", buildingStyle: "auto")])
        XCTAssertEqual(result.duplicates, [])
    }

    func testNameIgnoresTrailingSlash() {
        XCTAssertEqual(ProjectConfig.adding(paths: ["/a/b/MyProj/"], to: []).projects.first?.name, "MyProj")
    }

    func testColoursTakenInOrderByCurrentProjectCount() {
        let existing = [ProjectConfig(path: "/p/one", name: "one", color: "#000000")]
        let result = ProjectConfig.adding(paths: ["/p/two", "/p/three"], to: existing)
        XCTAssertEqual(result.projects.map(\.name), ["one", "two", "three"])
        XCTAssertEqual(result.projects.map(\.color), ["#000000", "#F2994A", "#27AE60"])
    }

    func testNinthProjectWrapsToFirstColour() {
        let paths = (0..<9).map { "/p/proj\($0)" }
        let result = ProjectConfig.adding(paths: paths, to: [])
        XCTAssertEqual(result.projects.map(\.color), ProjectPalette.colors + [ProjectPalette.colors[0]])
    }

    func testExistingProjectsKeepOrderAndAreUntouched() {
        let existing = [ProjectConfig(path: "/p/a", name: "Renamed", color: "#123456", buildingStyle: "cafe")]
        let result = ProjectConfig.adding(paths: ["/p/b"], to: existing)
        XCTAssertEqual(result.projects.first, existing[0])
        XCTAssertEqual(result.projects.count, 2)
    }

    func testDuplicateExactPath() {
        let existing = [ProjectConfig(path: "/p/a", name: "a")]
        let result = ProjectConfig.adding(paths: ["/p/a"], to: existing)
        XCTAssertEqual(result.projects, existing)
        XCTAssertEqual(result.duplicates, ["/p/a"])
    }

    func testDuplicateIsCaseInsensitive() {
        let existing = [ProjectConfig(path: "/Users/Me/Proj", name: "Proj")]
        let result = ProjectConfig.adding(paths: ["/users/me/PROJ"], to: existing)
        XCTAssertEqual(result.projects, existing)
        XCTAssertEqual(result.duplicates, ["/users/me/PROJ"])
    }

    func testDuplicateWithTrailingSlash() {
        let existing = [ProjectConfig(path: "/p/a", name: "a")]
        XCTAssertEqual(ProjectConfig.adding(paths: ["/p/a/"], to: existing).duplicates, ["/p/a/"])
        let existingSlash = [ProjectConfig(path: "/p/a/", name: "a")]
        XCTAssertEqual(ProjectConfig.adding(paths: ["/p/a"], to: existingSlash).duplicates, ["/p/a"])
    }

    func testDuplicateViaSymlink() throws {
        let root = try makeTempDirectory()
        let real = root.appendingPathComponent("real")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: true)
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)

        let existing = [ProjectConfig(path: real.path, name: "real")]
        XCTAssertEqual(ProjectConfig.adding(paths: [link.path], to: existing).duplicates, [link.path])
        let viaLink = [ProjectConfig(path: link.path, name: "link")]
        XCTAssertEqual(ProjectConfig.adding(paths: [real.path], to: viaLink).duplicates, [real.path])
    }

    func testDuplicatesWithinTheSameBatch() {
        let result = ProjectConfig.adding(paths: ["/p/a", "/P/A/", "/p/b"], to: [])
        XCTAssertEqual(result.projects.map(\.path), ["/p/a", "/p/b"])
        XCTAssertEqual(result.duplicates, ["/P/A/"])
        // The skipped duplicate does not consume a palette colour.
        XCTAssertEqual(result.projects.map(\.color), ["#5B8DEF", "#F2994A"])
    }

    func testSimilarPrefixIsNotADuplicate() {
        let existing = [ProjectConfig(path: "/p/foo", name: "foo")]
        let result = ProjectConfig.adding(paths: ["/p/foobar"], to: existing)
        XCTAssertEqual(result.projects.count, 2)
        XCTAssertEqual(result.duplicates, [])
    }
}
