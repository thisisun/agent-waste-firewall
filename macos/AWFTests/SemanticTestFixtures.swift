import Foundation
@testable import AWF

enum SemanticTestFixtures {
    static let token = String(repeating: "a", count: 48)
    static let streamA = "generation_" + String(repeating: "1", count: 32)
    static let streamB = "generation_" + String(repeating: "2", count: 32)
    static let sessionA = "session_" + String(repeating: "3", count: 32)

    static func data(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
    }

    static func ready(
        host: String = "127.0.0.1",
        port: Any = 43_219,
        token: String = token,
        source: String = "live"
    ) -> [String: Any] {
        [
            "v": 1,
            "kind": "dashboard_ready",
            "host": host,
            "port": port,
            "token": token,
            "source": source,
        ]
    }

    static func warning(
        severity: String = "medium",
        occurrences: Int = 1,
        ruleID: String = "exact_tool_repeat",
        attribution: String = "agent",
        issueIDs: [String] = []
    ) -> [String: Any] {
        [
            "ruleId": ruleID,
            "severity": severity,
            "attribution": attribution,
            "occurrences": occurrences,
            "issueIds": issueIDs,
        ]
    }

    static func liveStatus(
        connected: Bool = true,
        sourceState: String = "active",
        streamHealth: String = "healthy",
        coverage: String = "complete",
        generation: Int? = nil,
        streamAlias: String? = nil,
        mode: String = "warn",
        lastSequence: Int? = nil,
        warning: [String: Any]? = nil,
        promptCoachIssueIDs: [String] = []
    ) -> [String: Any] {
        let isEmpty = sourceState == "empty"
        let eventCount = isEmpty ? 0 : 1
        let incidentCount = warning == nil ? 0 : 1
        let resolvedGeneration = generation ?? (isEmpty ? 0 : 1)
        let resolvedStreamAlias: Any
        if let streamAlias {
            resolvedStreamAlias = streamAlias
        } else if isEmpty {
            resolvedStreamAlias = NSNull()
        } else {
            resolvedStreamAlias = streamA
        }
        return [
            "v": 1,
            "connected": connected,
            "source": "live",
            "sourceState": sourceState,
            "streamHealth": streamHealth,
            "traceHealth": streamHealth,
            "coverage": coverage,
            "generation": resolvedGeneration,
            "streamAlias": resolvedStreamAlias,
            "mode": mode,
            "state": isEmpty ? "idle" : "active",
            "traceId": NSNull(),
            "traceAlias": isEmpty ? NSNull() : sessionA,
            "metrics": [
                "events": eventCount,
                "incidents": incidentCount,
                "avoidableCalls": incidentCount,
                "elapsedMs": isEmpty ? 0 : 250,
            ],
            "lastSequence": lastSequence ?? (isEmpty ? 0 : 1),
            "currentWarning": warning ?? NSNull(),
            "promptCoach": [
                "issueIds": promptCoachIssueIDs,
            ],
        ]
    }

    static func traceStatus() -> [String: Any] {
        let traceAlias = "trace_" + String(repeating: "4", count: 24)
        return [
            "v": 1,
            "connected": true,
            "source": "trace",
            "sourceState": "active",
            "streamHealth": "healthy",
            "traceHealth": "healthy",
            "coverage": "complete",
            "generation": 1,
            "streamAlias": NSNull(),
            "mode": "observe",
            "state": "stopped",
            "traceId": traceAlias,
            "traceAlias": traceAlias,
            "metrics": [
                "events": 1,
                "incidents": 0,
                "avoidableCalls": 0,
                "elapsedMs": 100,
            ],
            "lastSequence": 1,
            "currentWarning": NSNull(),
            "promptCoach": [
                "issueIds": [],
            ],
        ]
    }

    static func decodedStatus(
        _ object: [String: Any]
    ) throws -> DashboardStatus {
        try DashboardStatus(data: data(object))
    }
}
