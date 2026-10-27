import Foundation
import XCTest
@testable import ProjectTownCore

final class WallpaperSnapshotLedgerTests: XCTestCase {
    private let directory = URL(fileURLWithPath: "/tmp/ProjectTown/Wallpaper", isDirectory: true)
    private let userWallpaper = WallpaperSnapshotLedger.Original(
        url: URL(fileURLWithPath: "/System/Library/Desktop Pictures/Sonoma.heic"), imageScaling: 3, allowClipping: true
    )

    private func ours(_ slot: Int, _ serial: Int64) -> URL {
        directory.appendingPathComponent(WallpaperSnapshotLedger.fileName(slot: slot, serial: serial))
    }

    func testFileNameRoundTrip() {
        XCTAssertEqual(WallpaperSnapshotLedger.fileName(slot: 3, serial: 1_792_924_800_123), "town-3-1792924800123.jpg")
        let parsed = WallpaperSnapshotLedger.parse(fileName: "town-3-1792924800123.jpg")
        XCTAssertEqual(parsed?.slot, 3)
        XCTAssertEqual(parsed?.serial, 1_792_924_800_123)
    }

    func testParseRejectsOtherNames() {
        for name in ["town-3.jpg", "town--5.jpg", "town-3-.jpg", "town-a-1.jpg", "town-3-1.png", "town-3-1-2.jpg",
                     "slots.json", "Sonoma.heic", "xtown-3-1.jpg", "town-3-1.jpg.tmp", "town-+3-1.jpg"] {
            XCTAssertNil(WallpaperSnapshotLedger.parse(fileName: name), name)
        }
    }

    func testOnlyOurDirectoryCounts() {
        XCTAssertEqual(WallpaperSnapshotLedger.slot(of: ours(2, 10), in: directory), 2)
        XCTAssertNil(WallpaperSnapshotLedger.slot(of: URL(fileURLWithPath: "/Users/me/Pictures/town-2-10.jpg"), in: directory))
        XCTAssertNil(WallpaperSnapshotLedger.slot(of: userWallpaper.url, in: directory))
        XCTAssertNil(WallpaperSnapshotLedger.slot(of: URL(string: "https://example.com/Wallpaper/town-2-10.jpg")!, in: directory))
    }

    func testForeignWallpaperGetsNewSlotAndIsRemembered() {
        var ledger = WallpaperSnapshotLedger()
        XCTAssertTrue(ledger.isEmpty)
        let first = ledger.slot(replacing: userWallpaper, in: directory)
        XCTAssertEqual(first.slot, 1)
        XCTAssertTrue(first.isNew)
        XCTAssertEqual(ledger.originals, [1: userWallpaper])

        // Another Space with a different wallpaper gets the next slot.
        let other = WallpaperSnapshotLedger.Original(url: URL(fileURLWithPath: "/Users/me/Pictures/cat.png"))
        let second = ledger.slot(replacing: other, in: directory)
        XCTAssertEqual(second.slot, 2)
        XCTAssertTrue(second.isNew)
        XCTAssertEqual(ledger.originals, [1: userWallpaper, 2: other])
    }

    func testOurWallpaperKeepsItsSlot() {
        var ledger = WallpaperSnapshotLedger(originals: [4: userWallpaper])
        let result = ledger.slot(replacing: .init(url: ours(4, 99)), in: directory)
        XCTAssertEqual(result.slot, 4)
        XCTAssertFalse(result.isNew)
        XCTAssertEqual(ledger.originals, [4: userWallpaper])  // the original is not overwritten by our own file
    }

    func testRestoreFindsOriginalBySlot() {
        let ledger = WallpaperSnapshotLedger(originals: [1: userWallpaper])
        XCTAssertEqual(ledger.original(toRestore: ours(1, 5), in: directory), userWallpaper)
        XCTAssertNil(ledger.original(toRestore: ours(2, 5), in: directory))  // ours, but the slot is unknown
        XCTAssertNil(ledger.original(toRestore: userWallpaper.url, in: directory))  // not ours: leave it alone
    }

    func testObsoleteFilesKeepTwoNewestPerSlot() {
        let names = ["town-1-5.jpg", "town-1-30.jpg", "town-1-7.jpg", "town-1-12.jpg",
                     "town-2-3.jpg", "town-2-4.jpg", "town-3-1.jpg", "slots.json", "notes.txt"]
        XCTAssertEqual(Set(WallpaperSnapshotLedger.obsoleteFiles(names)), ["town-1-5.jpg", "town-1-7.jpg"])
        XCTAssertEqual(WallpaperSnapshotLedger.obsoleteFiles([]), [])
    }

    func testSaveAndLoad() throws {
        let file = try makeTempDirectory().appendingPathComponent("Wallpaper/slots.json")
        let ledger = WallpaperSnapshotLedger(originals: [1: userWallpaper, 7: .init(url: URL(fileURLWithPath: "/a b/c.jpg"))])
        try ledger.save(to: file)
        XCTAssertEqual(WallpaperSnapshotLedger.load(from: file), ledger)
        let json = try String(contentsOf: file, encoding: .utf8)
        XCTAssertTrue(json.contains("\"file:///System/Library/Desktop%20Pictures/Sonoma.heic\""), json)  // URLs as strings
    }

    func testLoadMissingOrBrokenFileIsEmpty() throws {
        let dir = try makeTempDirectory()
        XCTAssertEqual(WallpaperSnapshotLedger.load(from: dir.appendingPathComponent("missing.json")), WallpaperSnapshotLedger())
        let broken = dir.appendingPathComponent("broken.json")
        try Data("{ nope".utf8).write(to: broken)
        XCTAssertEqual(WallpaperSnapshotLedger.load(from: broken), WallpaperSnapshotLedger())
    }
}
