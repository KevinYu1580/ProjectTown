/// Session state shared with the web scene. Raw values must match `SessionState` in `web/src/types.ts`.
public enum SessionState: String, Codable, Sendable {
    case running
    case waiting
    case finished
    case idle
    case sleeping
}
