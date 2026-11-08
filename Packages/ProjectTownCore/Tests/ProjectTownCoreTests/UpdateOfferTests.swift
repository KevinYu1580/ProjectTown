import CryptoKit
import Foundation
import XCTest
@testable import ProjectTownCore

final class UpdateOfferTests: XCTestCase {
    private func release(tag: String, assets: [String]) -> Data {
        let list = assets.map { #"{ "name": "\#($0)", "browser_download_url": "https://example.com/\#($0)" }"# }
        return Data(#"{ "tag_name": "\#(tag)", "html_url": "https://example.com/\#(tag)", "assets": [\#(list.joined(separator: ","))] }"#.utf8)
    }

    func testVersionOrder() throws {
        XCTAssertLessThan(try XCTUnwrap(AppVersion("1.3.1")), try XCTUnwrap(AppVersion("v1.4.0")))
        XCTAssertLessThan(try XCTUnwrap(AppVersion("1.9")), try XCTUnwrap(AppVersion("1.10.0")))
        XCTAssertEqual(AppVersion("1.4"), AppVersion("v1.4.0"))
        XCTAssertNil(AppVersion("1.4.0-beta"))
        XCTAssertNil(AppVersion(""))
    }

    func testNewerReleaseIsOffered() throws {
        let data = release(tag: "v1.4.0", assets: ["ProjectTown-v1.4.0.zip", "ProjectTown-v1.4.0.zip.sig"])
        let offer = try XCTUnwrap(try UpdateOffer.from(latestRelease: data, currentVersion: "1.3.1"))
        XCTAssertEqual(offer.version, "1.4.0")
        XCTAssertEqual(offer.zipURL.absoluteString, "https://example.com/ProjectTown-v1.4.0.zip")
        XCTAssertEqual(offer.signatureURL.absoluteString, "https://example.com/ProjectTown-v1.4.0.zip.sig")
        XCTAssertEqual(offer.pageURL.absoluteString, "https://example.com/v1.4.0")
    }

    func testSameOrOlderReleaseIsNotOffered() throws {
        for tag in ["v1.3.1", "v1.3.0"] {
            let data = release(tag: tag, assets: ["ProjectTown-\(tag).zip", "ProjectTown-\(tag).zip.sig"])
            XCTAssertNil(try UpdateOffer.from(latestRelease: data, currentVersion: "1.3.1"), tag)
        }
    }

    /// Releases made before signing was added have no `.sig`; they cannot be installed, so they are not offered.
    func testReleaseWithoutSignatureIsNotOffered() throws {
        let data = release(tag: "v1.4.0", assets: ["ProjectTown-v1.4.0.zip"])
        XCTAssertNil(try UpdateOffer.from(latestRelease: data, currentVersion: "1.3.1"))
    }

    func testUnparsableTagIsNotOffered() throws {
        let data = release(tag: "nightly", assets: ["ProjectTown-nightly.zip", "ProjectTown-nightly.zip.sig"])
        XCTAssertNil(try UpdateOffer.from(latestRelease: data, currentVersion: "1.3.1"))
    }

    func testMalformedJSONThrows() {
        XCTAssertThrowsError(try UpdateOffer.from(latestRelease: Data("{}".utf8), currentVersion: "1.3.1"))
    }
}

final class UpdateSignatureTests: XCTestCase {
    func testSignatureMustMatchKeyAndData() throws {
        let key = Curve25519.Signing.PrivateKey()
        let publicKey = key.publicKey.rawRepresentation.base64EncodedString()
        let zip = Data("zip bytes".utf8)
        let signature = Data(try key.signature(for: zip).base64EncodedString().utf8)

        XCTAssertTrue(UpdateSignature.isValid(signature, for: zip, publicKey: publicKey))
        XCTAssertFalse(UpdateSignature.isValid(signature, for: Data("other bytes".utf8), publicKey: publicKey))
        let otherKey = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation.base64EncodedString()
        XCTAssertFalse(UpdateSignature.isValid(signature, for: zip, publicKey: otherKey))
        XCTAssertFalse(UpdateSignature.isValid(Data("garbage".utf8), for: zip, publicKey: publicKey))
    }

    /// The `.sig` file written by scripts/update-signing.swift ends with a newline.
    func testTrailingNewlineIsAccepted() throws {
        let key = Curve25519.Signing.PrivateKey()
        let zip = Data("zip bytes".utf8)
        let signature = Data((try key.signature(for: zip).base64EncodedString() + "\n").utf8)
        XCTAssertTrue(UpdateSignature.isValid(signature, for: zip, publicKey: key.publicKey.rawRepresentation.base64EncodedString()))
    }
}
