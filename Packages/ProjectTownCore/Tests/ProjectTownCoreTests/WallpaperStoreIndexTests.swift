import Foundation
import XCTest
@testable import ProjectTownCore

final class WallpaperStoreIndexTests: XCTestCase {
    private typealias Store = WallpaperStoreIndex
    private let directory = URL(fileURLWithPath: "/tmp/ProjectTown/Wallpaper", isDirectory: true)
    private let userPicture = URL(fileURLWithPath: "/Users/me/Pictures/cat.png")
    private lazy var cover = directory.appendingPathComponent("cover-D1.jpg")

    private func isOurs(_ url: URL) -> Bool {
        url.deletingLastPathComponent().path == directory.path
    }

    private func image(_ url: URL, placement: String = "Crop") -> [String: Any] {
        Store.imageContent(url, like: ["Shuffle": "$null", "EncodedOptionValues": Data(placement.utf8)])!
    }

    private func aerial(_ asset: String) -> [String: Any] {
        let configuration = try! PropertyListSerialization.data(fromPropertyList: ["assetID": asset], format: .binary, options: 0)
        return ["Choices": [["Provider": "com.apple.wallpaper.choice.aerials", "Files": [Any](), "Configuration": configuration]],
                "Shuffle": "$null"]
    }

    private func choice(_ content: [String: Any]) -> [String: Any] {
        ["Desktop": ["Content": content, "LastSet": Date(timeIntervalSince1970: 0)], "Idle": aerial("idle")]
    }

    /// D1 (the town's display): default = cat.png, Space S1 = cat.png, Space S2 = aerial A. D2: Space S1 = aerial B.
    private func fixture() -> Store.Index {
        [
            "Displays": ["D1": choice(image(userPicture)), "D2": choice(aerial("B"))],
            "Spaces": [
                "S1": ["Displays": ["D1": choice(image(userPicture)), "D2": choice(aerial("B"))]],
                "S2": ["Displays": ["D1": choice(aerial("A"))]],
            ],
            "SystemDefault": choice(aerial("A")),
        ]
    }

    private func shown(_ index: Store.Index, _ space: String?, _ display: String) -> URL? {
        Store.content(of: .init(space: space, display: display), in: index).flatMap(Store.imageURL(of:))
    }

    private func provider(_ index: Store.Index, _ space: String?, _ display: String) -> String? {
        let content = Store.content(of: .init(space: space, display: display), in: index)
        return ((content?["Choices"] as? [Any])?.first as? [String: Any])?["Provider"] as? String
    }

    func testEntriesOfADisplay() {
        let entries = Store.entries(of: "D1", in: fixture())
        XCTAssertEqual(entries.map(\.id), ["display/D1", "space/S1/D1", "space/S2/D1"])
        XCTAssertEqual(Store.displays(in: fixture()), ["D1", "D2"])
        XCTAssertTrue(Store.entries(of: "D9", in: fixture()).isEmpty)
    }

    func testImageURLOnlyForImages() {
        XCTAssertEqual(Store.imageURL(of: image(userPicture)), userPicture)
        XCTAssertNil(Store.imageURL(of: aerial("A")))
        XCTAssertNil(Store.imageURL(of: [:]))
    }

    func testCoverPointsEveryEntryOfTheDisplayAtTheFileAndKeepsOriginals() throws {
        let (index, originals) = try XCTUnwrap(Store.cover(fixture(), display: "D1", with: cover, isOurs: isOurs))
        for space in [nil, "S1", "S2"] as [String?] { XCTAssertEqual(shown(index, space, "D1"), cover) }
        XCTAssertEqual(Set(originals.keys), ["display/D1", "space/S1/D1", "space/S2/D1"])
        // Other displays and the rest of each entry are untouched.
        XCTAssertEqual(provider(index, "S1", "D2"), "com.apple.wallpaper.choice.aerials")
        XCTAssertNotNil(((index["Spaces"] as? [String: Any])?["S2"] as? [String: Any]).flatMap { ($0["Displays"] as? [String: Any])?["D1"] as? [String: Any] }?["Idle"])
        XCTAssertTrue(Store.isCovered(index, display: "D1", isOurs: isOurs))
        XCTAssertFalse(Store.isCovered(index, display: "D2", isOurs: isOurs))

        // Covering again does not take our own file for an original.
        let again = try XCTUnwrap(Store.cover(index, display: "D1", with: cover, isOurs: isOurs))
        XCTAssertTrue(again.originals.isEmpty)
    }

    func testRestorePutsBackImagesAndAerials() throws {
        let original = fixture()  // one instance: binary plists of equal dictionaries may differ in key order
        let (covered, originals) = try XCTUnwrap(Store.cover(original, display: "D1", with: cover, isOurs: isOurs))
        let restored = try XCTUnwrap(Store.restore(covered, displays: ["D1"], originals: originals, isOurs: isOurs, fallback: { _ in nil }))
        XCTAssertEqual(shown(restored, nil, "D1"), userPicture)
        XCTAssertEqual(shown(restored, "S1", "D1"), userPicture)
        XCTAssertEqual(provider(restored, "S2", "D1"), "com.apple.wallpaper.choice.aerials")
        XCTAssertEqual(NSDictionary(dictionary: restored), NSDictionary(dictionary: original))
        // Nothing of ours is left, so a second restore changes nothing.
        XCTAssertNil(Store.restore(restored, displays: ["D1"], originals: originals, isOurs: isOurs, fallback: { _ in nil }))
    }

    func testRestoreLeavesWallpapersTheUserPickedMeanwhile() throws {
        let (covered, originals) = try XCTUnwrap(Store.cover(fixture(), display: "D1", with: cover, isOurs: isOurs))
        let dog = URL(fileURLWithPath: "/Users/me/Pictures/dog.png")
        let changed = try XCTUnwrap(Store.cover(covered, display: "D1", with: dog, isOurs: { _ in false })).index
        XCTAssertNil(Store.restore(changed, displays: ["D1"], originals: originals, isOurs: isOurs, fallback: { _ in nil }))
    }

    func testRestoreFallsBackToThePlainImageOfOurFile() throws {
        // A Space set through NSWorkspace, which saves no store original, shows a slot file.
        let slotFile = directory.appendingPathComponent("town-4-1.jpg")
        let index = try XCTUnwrap(Store.cover(fixture(), display: "D1", with: slotFile, isOurs: isOurs)).index
        let restored = try XCTUnwrap(Store.restore(index, displays: ["D1"], originals: [:], isOurs: isOurs,
                                                   fallback: { $0 == slotFile ? self.userPicture : nil }))
        for space in [nil, "S1", "S2"] as [String?] { XCTAssertEqual(shown(restored, space, "D1"), userPicture) }
    }

    func testUnexpectedShapeIsRefused() {
        var index = fixture()
        index["Spaces"] = ["S1": ["Displays": ["D1": ["Desktop": "broken"]]]]
        XCTAssertNil(Store.cover(index, display: "D1", with: cover, isOurs: isOurs))
        XCTAssertNil(Store.cover([:], display: "D1", with: cover, isOurs: isOurs))
    }

    func testSaveAndLoadRoundTrip() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Index-\(UUID().uuidString).plist")
        defer { try? FileManager.default.removeItem(at: url) }
        let index = fixture()
        try Store.save(index, to: url)
        let loaded = try XCTUnwrap(Store.load(from: url))
        XCTAssertEqual(NSDictionary(dictionary: loaded), NSDictionary(dictionary: index))
        XCTAssertNil(Store.load(from: url.appendingPathExtension("missing")))
    }
}
