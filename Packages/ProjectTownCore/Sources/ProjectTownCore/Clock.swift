import Foundation
import os

/// Source of "now" in epoch milliseconds; injected so tests control time.
public protocol Clock: Sendable {
    func nowMs() -> Int64
}

public struct SystemClock: Clock {
    public init() {}

    public func nowMs() -> Int64 {
        Int64((Date().timeIntervalSince1970 * 1000).rounded())
    }
}

extension Logger {
    /// Shared subsystem for every Core logger; the category is the type name.
    static func projectTown(_ category: String) -> Logger {
        Logger(subsystem: "io.github.kevinyu1580.ProjectTown", category: category)
    }
}
