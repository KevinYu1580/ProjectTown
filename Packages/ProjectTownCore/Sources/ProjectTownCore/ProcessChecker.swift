import Darwin
import Foundation

public enum SignalResult: Sendable { case alive, permissionDenied, noSuchProcess }

/// Thin syscall wrapper so tests can fake process state.
public protocol ProcessInspecting: Sendable {
    /// `kill(pid, 0)` plus errno.
    func signalZero(pid: Int32) -> SignalResult
    /// `proc_pidinfo(PROC_PIDTBSDINFO).pbi_start_tvsec`, nil when unavailable.
    func startTimeSeconds(pid: Int32) -> Int64?
}

public struct SystemProcessInspector: ProcessInspecting {
    public init() {}

    public func signalZero(pid: Int32) -> SignalResult {
        // pid <= 0 would signal a process group; never a session process.
        guard pid > 0 else { return .noSuchProcess }
        if kill(pid, 0) == 0 { return .alive }
        return errno == EPERM ? .permissionDenied : .noSuchProcess
    }

    public func startTimeSeconds(pid: Int32) -> Int64? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
        return Int64(info.pbi_start_tvsec)
    }
}

public protocol ProcessChecking: Sendable {
    func isAlive(pid: Int32, procStart: String?) -> Bool
}

public struct ProcessChecker: ProcessChecking {
    private let inspector: ProcessInspecting
    private let timeZone: TimeZone

    public init(inspector: ProcessInspecting = SystemProcessInspector(), timeZone: TimeZone = .current) {
        self.inspector = inspector
        self.timeZone = timeZone
    }

    public func isAlive(pid: Int32, procStart: String?) -> Bool {
        if inspector.signalZero(pid: pid) == .noSuchProcess { return false }
        // Pid-reuse guard; without a usable procStart or start time only the signal check counts.
        // Claude Code 2.1.308 writes procStart in UTC although HANDOFF §5.2 says local time,
        // so a start time matching either reading within 2 s counts as the same process.
        guard let procStart, let actual = inspector.startTimeSeconds(pid: pid) else { return true }
        let readings = [TimeZone(identifier: "UTC")!, timeZone].compactMap { ProcStartParser.parse(procStart, timeZone: $0) }
        guard !readings.isEmpty else { return true }
        return readings.contains { abs(Int64($0.timeIntervalSince1970) - actual) <= 2 }
    }
}

public enum ProcStartParser {
    /// Parses ctime-style "Sun Oct 25 10:28:45 2026" in the given time zone.
    public static func parse(_ s: String, timeZone: TimeZone = .current) -> Date? {
        // ctime pads single-digit days with a space ("Oct  5"), so collapse whitespace runs first.
        let collapsed = s.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "EEE MMM d HH:mm:ss yyyy"
        return formatter.date(from: collapsed)
    }
}
