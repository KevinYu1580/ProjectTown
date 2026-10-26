import Foundation
import XCTest
@testable import ProjectTownCore

final class SessionStateTests: XCTestCase {
    // Raw values must match the JS protocol strings in web/src/types.ts.
    func testRawValuesMatchJSProtocol() throws {
        XCTAssertEqual(SessionState.running.rawValue, "running")
        XCTAssertEqual(SessionState.waiting.rawValue, "waiting")
        XCTAssertEqual(SessionState.finished.rawValue, "finished")
        XCTAssertEqual(SessionState.idle.rawValue, "idle")
        XCTAssertEqual(SessionState.sleeping.rawValue, "sleeping")
        let data = try JSONEncoder().encode([SessionState.running, .sleeping])
        XCTAssertEqual(String(decoding: data, as: UTF8.self), #"["running","sleeping"]"#)
    }
}
