import Foundation
import XCTest

/// Guards `app/Resources/Localizable.xcstrings`. The app target has no test bundle, so these tests
/// live here and read the repo files located through `#filePath`.
final class LocalizationCatalogTests: XCTestCase {
    private static let repoRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()  // ProjectTownCoreTests, Tests
        .deletingLastPathComponent().deletingLastPathComponent()  // ProjectTownCore, Packages
        .deletingLastPathComponent()                              // repo root
    private static let catalogURL = repoRoot.appendingPathComponent("app/Resources/Localizable.xcstrings")
    private static let sourcesURL = repoRoot.appendingPathComponent("app/Sources")

    private func loadCatalog() throws -> [String: [String: Any]] {
        let data = try Data(contentsOf: Self.catalogURL)
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(root["sourceLanguage"] as? String, "en")
        return try XCTUnwrap(root["strings"] as? [String: [String: Any]])
    }

    private func value(_ entry: [String: Any], _ language: String) -> String? {
        let localizations = entry["localizations"] as? [String: Any]
        let unit = (localizations?[language] as? [String: Any])?["stringUnit"] as? [String: Any]
        return unit?["value"] as? String
    }

    /// `%@`, `%lld`, `%1$lld`, ... with positions dropped and sorted, so reordering is allowed but dropping is not.
    private func specifiers(_ text: String) -> [String] {
        let pattern = try! NSRegularExpression(pattern: "%(?:\\d+\\$)?(?:l{0,2}[dfs@]|%)")
        let range = NSRange(text.startIndex..., in: text)
        return pattern.matches(in: text, range: range)
            .map { String(text[Range($0.range, in: text)!]).replacingOccurrences(of: "\\d+\\$", with: "", options: .regularExpression) }
            .sorted()
    }

    func testEveryKeyHasEnglishAndTraditionalChinese() throws {
        let strings = try loadCatalog()
        XCTAssertFalse(strings.isEmpty)
        for (key, entry) in strings {
            for language in ["en", "zh-Hant"] {
                let text = value(entry, language)
                XCTAssertFalse(text?.trimmingCharacters(in: .whitespaces).isEmpty ?? true, "\"\(key)\" has no \(language) value")
            }
            XCTAssertEqual(specifiers(value(entry, "en") ?? ""), specifiers(value(entry, "zh-Hant") ?? ""),
                           "\"\(key)\": en and zh-Hant use different format specifiers")
            XCTAssertEqual(specifiers(key), specifiers(value(entry, "en") ?? ""), "\"\(key)\": en changes the format specifiers")
        }
    }

    func testNoLocalizationOtherThanEnglishAndTraditionalChinese() throws {
        for (key, entry) in try loadCatalog() {
            let languages = Set((entry["localizations"] as? [String: Any])?.keys.map { $0 } ?? [])
            XCTAssertEqual(languages, ["en", "zh-Hant"], "\"\(key)\"")
        }
    }

    /// Every `String(localized: "…")` literal in `app/Sources` must be a key of the catalog, so a new string that is
    /// not yet translated fails `make check`.
    ///
    /// Limits: this is a text scan, not a compiler. It only sees `String(localized: "literal")` on one line. It does
    /// not see SwiftUI `Text("…")` / `Label("…")` literals, `LocalizedStringKey`, `NSLocalizedString`, multi-line
    /// literals, non-literal keys, or code inside comments. An interpolation matches any format specifier, so
    /// `%lld` vs `%@` is not checked. Xcode's own extraction (`SWIFT_EMIT_LOC_STRINGS`, then `xcrun xcstringstool
    /// sync app/Resources/Localizable.xcstrings --stringsdata <build>/…/*.stringsdata`) is the complete source of
    /// keys; after a sync, delete the empty key `""` that `TextField("")` and `ColorPicker("")` add.
    func testEverySwiftLiteralIsInTheCatalog() throws {
        let catalogKeys = Set(try loadCatalog().keys.map(Self.normalize))
        let enumerator = try XCTUnwrap(FileManager.default.enumerator(at: Self.sourcesURL, includingPropertiesForKeys: nil))
        let files = enumerator.compactMap { $0 as? URL }.filter { $0.pathExtension == "swift" }
        XCTAssertFalse(files.isEmpty)
        var found = 0
        for file in files {
            let text = try String(contentsOf: file, encoding: .utf8)
            for literal in Self.localizedLiterals(in: text) {
                found += 1
                XCTAssertTrue(catalogKeys.contains(literal), "\(file.lastPathComponent): \"\(literal)\" is missing from Localizable.xcstrings")
            }
        }
        XCTAssertGreaterThan(found, 50, "the scan found suspiciously few String(localized:) literals")
    }

    func testLiteralScannerHandlesInterpolation() {
        let source = #"""
        a = String(localized: "Plain")
        b = String(localized: "Range \(limits.lower) to \(f(g(1), 2)) min")
        c = String(localized: "Quote \"x\" ok")
        """#
        XCTAssertEqual(Self.localizedLiterals(in: source), ["Plain", "Range \u{0} to \u{0} min", "Quote \\\"x\\\" ok"])
        XCTAssertEqual(Self.normalize("Range %1$lld to %2$lld min"), "Range \u{0} to \u{0} min")
    }

    /// Catalog keys and source literals are compared with every format specifier / interpolation as `\u{0}`.
    private static func normalize(_ key: String) -> String {
        key.replacingOccurrences(of: "%(?:\\d+\\$)?l{0,2}[dfs@]", with: "\u{0}", options: .regularExpression)
    }

    private static func localizedLiterals(in source: String) -> [String] {
        let marker = Array("String(localized:")
        let chars = Array(source)
        var result: [String] = []
        var i = 0
        while i + marker.count < chars.count {
            guard Array(chars[i..<i + marker.count]) == marker else { i += 1; continue }
            i += marker.count
            while i < chars.count, chars[i] == " " { i += 1 }
            guard i < chars.count, chars[i] == "\"" else { continue }
            i += 1
            var literal = ""
            while i < chars.count, chars[i] != "\"" {
                if chars[i] == "\\", i + 1 < chars.count, chars[i + 1] == "(" {
                    var depth = 1
                    i += 2
                    while i < chars.count, depth > 0 {
                        if chars[i] == "(" { depth += 1 } else if chars[i] == ")" { depth -= 1 }
                        i += 1
                    }
                    literal.append("\u{0}")
                } else if chars[i] == "\\", i + 1 < chars.count {
                    literal.append(chars[i]); literal.append(chars[i + 1])
                    i += 2
                } else {
                    literal.append(chars[i])
                    i += 1
                }
            }
            result.append(literal)
        }
        return result
    }
}
