import Foundation

enum DashboardSourceState: String, Sendable {
    case empty
    case active
}

enum DashboardStreamHealth: String, Sendable {
    case healthy
    case stale
    case degraded
}

enum DashboardCoverage: String, Sendable {
    case complete
    case incomplete
    case unknown
}

enum DashboardMode: String, Sendable {
    case observe
    case warn
    case block
}

enum DashboardRuntimeState: String, Sendable {
    case idle
    case active
    case recording
    case stopped
}

enum DashboardRule: String, Sendable {
    case promptContract = "prompt_contract"
    case exactToolRepeat = "exact_tool_repeat"
    case unchangedReread = "unchanged_reread"
    case retryAfterSameFailure = "retry_after_same_failure"
    case repeatedFailureResult = "repeated_failure_result"
    case statusPollingLoop = "status_polling_loop"
    case editRevertOscillation = "edit_revert_oscillation"
}

enum DashboardWarningSeverity: String, Sendable {
    case low
    case medium
    case high
}

enum DashboardAttribution: String, Sendable {
    case userInstruction = "user_instruction"
    case agent
    case environment
    case harness
}

struct DashboardMetrics: Equatable, Sendable {
    let events: Int
    let incidents: Int
    let avoidableCalls: Int
    let elapsedMs: Int
}

struct DashboardWarning: Equatable, Sendable {
    let rule: DashboardRule
    let severity: DashboardWarningSeverity
    let attribution: DashboardAttribution
    let occurrences: Int
    let issueIDs: [String]
}

struct DashboardStatus: Equatable, Sendable {
    private static let statusKeys: Set<String> = [
        "v",
        "connected",
        "source",
        "sourceState",
        "streamHealth",
        "traceHealth",
        "coverage",
        "generation",
        "streamAlias",
        "mode",
        "state",
        "traceId",
        "traceAlias",
        "metrics",
        "lastSequence",
        "currentWarning",
        "promptCoach",
    ]
    private static let metricKeys: Set<String> = [
        "events",
        "incidents",
        "avoidableCalls",
        "elapsedMs",
    ]
    private static let warningKeys: Set<String> = [
        "ruleId",
        "severity",
        "attribution",
        "occurrences",
        "issueIds",
    ]
    private static let promptCoachKeys: Set<String> = ["issueIds"]
    private static let issueIDs: Set<String> = [
        "broad",
        "target",
        "success",
        "verify",
        "stop",
        "conflict",
    ]

    let connected: Bool
    let source: DashboardSource
    let sourceState: DashboardSourceState
    let streamHealth: DashboardStreamHealth
    let coverage: DashboardCoverage
    let generation: Int
    let streamAlias: String?
    let mode: DashboardMode
    let state: DashboardRuntimeState
    let traceID: String?
    let traceAlias: String?
    let metrics: DashboardMetrics
    let lastSequence: Int
    let warning: DashboardWarning?
    let promptCoachIssueIDs: [String]

    init(data: Data) throws {
        let error = PresentationProtocolError.invalidStatus
        let object = try ClosedJSON.object(
            from: data,
            maximumBytes: 16 * 1_024,
            error: error
        )
        try ClosedJSON.requireExactKeys(object, Self.statusKeys, error: error)
        guard try ClosedJSON.integer(object["v"], error: error) == 1 else {
            throw error
        }
        let connected = try ClosedJSON.bool(object["connected"], error: error)
        let source = try Self.enumValue(
            DashboardSource.self,
            object["source"],
            error: error
        )
        let sourceState = try Self.enumValue(
            DashboardSourceState.self,
            object["sourceState"],
            error: error
        )
        let streamHealth = try Self.enumValue(
            DashboardStreamHealth.self,
            object["streamHealth"],
            error: error
        )
        let traceHealth = try Self.enumValue(
            DashboardStreamHealth.self,
            object["traceHealth"],
            error: error
        )
        let coverage = try Self.enumValue(
            DashboardCoverage.self,
            object["coverage"],
            error: error
        )
        guard
            streamHealth == traceHealth,
            (streamHealth == .healthy) == (coverage != .unknown)
        else {
            throw error
        }
        let generation = try ClosedJSON.integer(
            object["generation"],
            error: error
        )
        let streamAlias = try ClosedJSON.optionalString(
            object["streamAlias"],
            error: error
        )
        let mode = try Self.enumValue(
            DashboardMode.self,
            object["mode"],
            error: error
        )
        let state = try Self.enumValue(
            DashboardRuntimeState.self,
            object["state"],
            error: error
        )
        let traceID = try ClosedJSON.optionalString(
            object["traceId"],
            error: error
        )
        let traceAlias = try ClosedJSON.optionalString(
            object["traceAlias"],
            error: error
        )
        let metrics = try Self.metrics(object["metrics"], error: error)
        let lastSequence = try ClosedJSON.integer(
            object["lastSequence"],
            error: error
        )
        let warning = try Self.warning(
            object["currentWarning"],
            error: error
        )
        let promptCoach = try ClosedJSON.nestedObject(
            object["promptCoach"],
            error: error
        )
        try ClosedJSON.requireExactKeys(
            promptCoach,
            Self.promptCoachKeys,
            error: error
        )
        let promptCoachIssueIDs = try ClosedJSON.stringArray(
            promptCoach["issueIds"],
            maximumCount: 6,
            allowed: Self.issueIDs,
            error: error
        )

        guard
            (sourceState == .empty) == (metrics.events == 0),
            metrics.incidents <= metrics.events,
            metrics.avoidableCalls <= metrics.incidents,
            metrics.events > 0 || lastSequence == 0,
            warning == nil || metrics.incidents > 0
        else {
            throw error
        }

        switch source {
        case .live:
            guard
                traceID == nil,
                (generation == 0 && streamAlias == nil) ||
                    (generation > 0 &&
                        streamAlias.map(Self.isStreamAlias) == true),
                state == (sourceState == .empty ? .idle : .active),
                traceAlias == nil ||
                    traceAlias.map(Self.isSessionAlias) == true
            else {
                throw error
            }
        case .trace:
            guard
                generation >= 1,
                streamAlias == nil,
                connected
                    ? traceID.map(Self.isTraceAlias) == true &&
                        traceAlias == traceID &&
                        (state == .recording || state == .stopped)
                    : traceID == nil &&
                        traceAlias == nil &&
                        state == .idle
            else {
                throw error
            }
        }

        self.connected = connected
        self.source = source
        self.sourceState = sourceState
        self.streamHealth = streamHealth
        self.coverage = coverage
        self.generation = generation
        self.streamAlias = streamAlias
        self.mode = mode
        self.state = state
        self.traceID = traceID
        self.traceAlias = traceAlias
        self.metrics = metrics
        self.lastSequence = lastSequence
        self.warning = warning
        self.promptCoachIssueIDs = promptCoachIssueIDs
    }

    private static func enumValue<T: RawRepresentable>(
        _ type: T.Type,
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> T where T.RawValue == String {
        let rawValue = try ClosedJSON.string(value, error: error)
        guard let value = T(rawValue: rawValue) else {
            throw error
        }
        return value
    }

    private static func metrics(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> DashboardMetrics {
        let object = try ClosedJSON.nestedObject(value, error: error)
        try ClosedJSON.requireExactKeys(object, metricKeys, error: error)
        return DashboardMetrics(
            events: try ClosedJSON.integer(object["events"], error: error),
            incidents: try ClosedJSON.integer(
                object["incidents"],
                error: error
            ),
            avoidableCalls: try ClosedJSON.integer(
                object["avoidableCalls"],
                error: error
            ),
            elapsedMs: try ClosedJSON.integer(
                object["elapsedMs"],
                error: error
            )
        )
    }

    private static func warning(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> DashboardWarning? {
        if value is NSNull {
            return nil
        }
        let object = try ClosedJSON.nestedObject(value, error: error)
        try ClosedJSON.requireExactKeys(object, warningKeys, error: error)
        return DashboardWarning(
            rule: try enumValue(
                DashboardRule.self,
                object["ruleId"],
                error: error
            ),
            severity: try enumValue(
                DashboardWarningSeverity.self,
                object["severity"],
                error: error
            ),
            attribution: try enumValue(
                DashboardAttribution.self,
                object["attribution"],
                error: error
            ),
            occurrences: try ClosedJSON.integer(
                object["occurrences"],
                minimum: 1,
                maximum: 1_000_000,
                error: error
            ),
            issueIDs: try ClosedJSON.stringArray(
                object["issueIds"],
                maximumCount: 6,
                allowed: issueIDs,
                error: error
            )
        )
    }

    private static func isStreamAlias(_ value: String) -> Bool {
        ClosedJSON.hasLowercaseHex(value, prefix: "generation_", count: 32)
    }

    private static func isSessionAlias(_ value: String) -> Bool {
        ClosedJSON.hasLowercaseHex(value, prefix: "session_", count: 32)
    }

    private static func isTraceAlias(_ value: String) -> Bool {
        ClosedJSON.hasLowercaseHex(value, prefix: "trace_", count: 24)
    }
}

enum ProviderName: String, Sendable {
    case codex
    case claude
}

enum ProviderState: String, Sendable {
    case notDetected = "not_detected"
    case needsInstall = "needs_install"
    case needsEnable = "needs_enable"
    case installedUnverified = "installed_unverified"
    case active
    case unknown
}

enum ProviderActivity: String, Sendable {
    case notObserved = "not_observed"
    case observed
    case unknown
}

struct ProviderVersion: Equatable, Sendable {
    let major: Int
    let minor: Int
    let patch: Int
}

struct ProviderStatus: Equatable, Sendable {
    let provider: ProviderName
    let state: ProviderState
    let version: ProviderVersion?
    let activity: ProviderActivity
}

struct ProviderIntegrationStatus: Equatable, Sendable {
    private static let statusKeys: Set<String> = [
        "v",
        "kind",
        "providers",
    ]
    private static let providerKeys: Set<String> = [
        "provider",
        "state",
        "version",
        "activity",
    ]
    private static let versionKeys: Set<String> = [
        "major",
        "minor",
        "patch",
    ]

    let providers: [ProviderStatus]

    init(data: Data) throws {
        let error = PresentationProtocolError.invalidIntegration
        let object = try ClosedJSON.object(
            from: data,
            maximumBytes: 16 * 1_024,
            error: error
        )
        try ClosedJSON.requireExactKeys(
            object,
            Self.statusKeys,
            error: error
        )
        guard
            try ClosedJSON.integer(object["v"], error: error) == 1,
            try ClosedJSON.string(object["kind"], error: error) ==
                "provider_integration_status",
            let rawProviders = object["providers"] as? [Any],
            rawProviders.count == 2
        else {
            throw error
        }
        let providers = try rawProviders.map {
            try Self.provider($0, error: error)
        }
        guard
            providers[0].provider == .codex,
            providers[1].provider == .claude
        else {
            throw error
        }
        self.providers = providers
    }

    var hasObservedActivity: Bool {
        providers.contains { $0.activity == .observed }
    }

    private static func provider(
        _ value: Any,
        error: PresentationProtocolError
    ) throws -> ProviderStatus {
        let object = try ClosedJSON.nestedObject(value, error: error)
        try ClosedJSON.requireExactKeys(
            object,
            providerKeys,
            error: error
        )
        guard
            let provider = ProviderName(
                rawValue: try ClosedJSON.string(
                    object["provider"],
                    error: error
                )
            ),
            let state = ProviderState(
                rawValue: try ClosedJSON.string(
                    object["state"],
                    error: error
                )
            ),
            let activity = ProviderActivity(
                rawValue: try ClosedJSON.string(
                    object["activity"],
                    error: error
                )
            )
        else {
            throw error
        }
        let version = try Self.version(object["version"], error: error)
        let detected = state != .notDetected && state != .unknown
        guard
            !(state == .notDetected && version != nil),
            !detected || version != nil,
            state != .active || activity == .observed,
            activity != .observed ||
                state == .active ||
                state == .unknown
        else {
            throw error
        }
        return ProviderStatus(
            provider: provider,
            state: state,
            version: version,
            activity: activity
        )
    }

    private static func version(
        _ value: Any?,
        error: PresentationProtocolError
    ) throws -> ProviderVersion? {
        if value is NSNull {
            return nil
        }
        let object = try ClosedJSON.nestedObject(value, error: error)
        try ClosedJSON.requireExactKeys(
            object,
            versionKeys,
            error: error
        )
        return ProviderVersion(
            major: try ClosedJSON.integer(
                object["major"],
                maximum: 999_999,
                error: error
            ),
            minor: try ClosedJSON.integer(
                object["minor"],
                maximum: 999_999,
                error: error
            ),
            patch: try ClosedJSON.integer(
                object["patch"],
                maximum: 999_999,
                error: error
            )
        )
    }
}

struct DashboardStatusReducer: Sendable {
    private(set) var current: DashboardStatus?

    mutating func accept(_ candidate: DashboardStatus) -> Bool {
        if let current,
           isSameStream(current, candidate),
           candidate.lastSequence < current.lastSequence {
            return false
        }
        current = candidate
        return true
    }

    private func isSameStream(
        _ current: DashboardStatus,
        _ candidate: DashboardStatus
    ) -> Bool {
        guard current.source == candidate.source else {
            return false
        }
        switch candidate.source {
        case .live:
            return current.streamAlias == candidate.streamAlias
        case .trace:
            return current.generation == candidate.generation &&
                current.traceAlias == candidate.traceAlias
        }
    }
}
