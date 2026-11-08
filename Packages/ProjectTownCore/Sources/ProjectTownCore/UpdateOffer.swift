import CryptoKit
import Foundation

/// A release version such as `1.4.0` or `v1.4.0`; missing parts count as 0. Pre-release suffixes are not parsed.
public struct AppVersion: Comparable, Sendable {
    private let parts: [Int]

    public init?(_ text: String) {
        let trimmed = text.hasPrefix("v") ? String(text.dropFirst()) : text
        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
        guard !parts.isEmpty, parts.allSatisfy({ $0 != nil }) else { return nil }
        self.parts = parts.map { $0! }
    }

    private func part(_ index: Int) -> Int { index < parts.count ? parts[index] : 0 }

    public static func == (a: AppVersion, b: AppVersion) -> Bool {
        (0..<max(a.parts.count, b.parts.count)).allSatisfy { a.part($0) == b.part($0) }
    }

    public static func < (a: AppVersion, b: AppVersion) -> Bool {
        for i in 0..<max(a.parts.count, b.parts.count) where a.part(i) != b.part(i) {
            return a.part(i) < b.part(i)
        }
        return false
    }
}

/// A newer release found on GitHub that can be installed: its zip and the zip's Ed25519 signature.
public struct UpdateOffer: Equatable, Sendable {
    public let version: String
    public let zipURL: URL
    public let signatureURL: URL
    public let pageURL: URL

    private struct Release: Decodable {
        struct Asset: Decodable {
            let name: String
            let browser_download_url: URL
        }
        let tag_name: String
        let html_url: URL
        let assets: [Asset]
    }

    /// Reads the body of GitHub's `releases/latest`. Nil when the release is not newer than `currentVersion` or
    /// lacks `ProjectTown-<tag>.zip` and its `.sig`. Throws when the body is not a release.
    public static func from(latestRelease data: Data, currentVersion: String) throws -> UpdateOffer? {
        let release = try JSONDecoder().decode(Release.self, from: data)
        guard let latest = AppVersion(release.tag_name), let current = AppVersion(currentVersion), current < latest else {
            return nil
        }
        let zipName = "ProjectTown-\(release.tag_name).zip"
        func url(_ name: String) -> URL? { release.assets.first { $0.name == name }?.browser_download_url }
        guard let zip = url(zipName), let signature = url(zipName + ".sig") else { return nil }
        let version = release.tag_name.hasPrefix("v") ? String(release.tag_name.dropFirst()) : release.tag_name
        return UpdateOffer(version: version, zipURL: zip, signatureURL: signature, pageURL: release.html_url)
    }
}

public enum UpdateSignature {
    /// `signature` is the `.sig` file: the base64 Ed25519 signature of the zip, as written by
    /// scripts/update-signing.swift. `publicKey` is the base64 raw public key built into the app.
    public static func isValid(_ signature: Data, for zip: Data, publicKey: String) -> Bool {
        let text = String(decoding: signature, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let raw = Data(base64Encoded: text),
              let keyData = Data(base64Encoded: publicKey),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData) else { return false }
        return key.isValidSignature(raw, for: zip)
    }
}
