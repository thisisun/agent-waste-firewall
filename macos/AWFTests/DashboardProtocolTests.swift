import XCTest
@testable import AWF

final class DashboardProtocolTests: XCTestCase {
    func testReadyAcceptsExactClosedLiveContract() throws {
        let endpoint = try DashboardEndpoint(
            readyData: SemanticTestFixtures.data(
                SemanticTestFixtures.ready()
            )
        )

        XCTAssertEqual(endpoint.host, "127.0.0.1")
        XCTAssertEqual(endpoint.port, 43_219)
        XCTAssertEqual(endpoint.token, SemanticTestFixtures.token)
        XCTAssertEqual(endpoint.source, .live)
        XCTAssertEqual(endpoint.dashboardURL.scheme, "http")
        XCTAssertEqual(endpoint.dashboardURL.host, "127.0.0.1")
        XCTAssertEqual(endpoint.dashboardURL.path, "/")
        XCTAssertEqual(endpoint.statusURL.path, "/api/status")
    }

    func testReadyAcceptsTraceAsProtocolValue() throws {
        let endpoint = try DashboardEndpoint(
            readyData: SemanticTestFixtures.data(
                SemanticTestFixtures.ready(source: "trace")
            )
        )
        XCTAssertEqual(endpoint.source, .trace)
    }

    func testReadyRejectsMissingAndExtraKeys() throws {
        var missing = SemanticTestFixtures.ready()
        missing.removeValue(forKey: "kind")
        XCTAssertThrowsError(
            try DashboardEndpoint(
                readyData: SemanticTestFixtures.data(missing)
            )
        ) {
            XCTAssertEqual(
                $0 as? PresentationProtocolError,
                .invalidReady
            )
        }

        var extra = SemanticTestFixtures.ready()
        extra["unexpected"] = true
        XCTAssertThrowsError(
            try DashboardEndpoint(
                readyData: SemanticTestFixtures.data(extra)
            )
        ) {
            XCTAssertEqual(
                $0 as? PresentationProtocolError,
                .invalidReady
            )
        }
    }

    func testReadyRejectsInvalidBoundaryValues() throws {
        let invalidValues: [[String: Any]] = [
            SemanticTestFixtures.ready(host: "localhost"),
            SemanticTestFixtures.ready(port: 0),
            SemanticTestFixtures.ready(port: 65_536),
            SemanticTestFixtures.ready(port: true),
            SemanticTestFixtures.ready(token: String(repeating: "A", count: 48)),
            SemanticTestFixtures.ready(source: "other"),
        ]

        for invalid in invalidValues {
            XCTAssertThrowsError(
                try DashboardEndpoint(
                    readyData: SemanticTestFixtures.data(invalid)
                )
            )
        }
    }

    func testReadyRejectsOversizedResponseBeforeDecoding() {
        XCTAssertThrowsError(
            try DashboardEndpoint(readyData: Data(repeating: 0x20, count: 1_025))
        ) {
            XCTAssertEqual(
                $0 as? PresentationProtocolError,
                .responseTooLarge
            )
        }
    }

    func testReadyAcceptsJSONSchemaIntegerLexicalForms() throws {
        let json = """
        {
          "v": 1e0,
          "kind": "dashboard_ready",
          "host": "127.0.0.1",
          "port": 43219.0,
          "token": "\(SemanticTestFixtures.token)",
          "source": "live"
        }
        """
        let endpoint = try DashboardEndpoint(readyData: Data(json.utf8))
        XCTAssertEqual(endpoint.port, 43_219)
    }

    func testStatusAcceptsExactLiveAndTraceContracts() throws {
        let live = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                warning: SemanticTestFixtures.warning(
                    severity: "high",
                    occurrences: 2
                ),
                promptCoachIssueIDs: ["target", "verify"]
            )
        )
        XCTAssertEqual(live.source, .live)
        XCTAssertEqual(live.warning?.rule, .exactToolRepeat)
        XCTAssertEqual(live.warning?.severity, .high)
        XCTAssertEqual(live.warning?.occurrences, 2)
        XCTAssertEqual(live.promptCoachIssueIDs, ["target", "verify"])

        let trace = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.traceStatus()
        )
        XCTAssertEqual(trace.source, .trace)
        XCTAssertEqual(trace.state, .stopped)
        XCTAssertEqual(trace.traceID, trace.traceAlias)
    }

    func testStatusRejectsTopLevelAndNestedExtraKeys() throws {
        var topLevel = SemanticTestFixtures.liveStatus(
            sourceState: "empty"
        )
        topLevel["unexpected"] = true
        XCTAssertThrowsError(
            try SemanticTestFixtures.decodedStatus(topLevel)
        ) {
            XCTAssertEqual(
                $0 as? PresentationProtocolError,
                .invalidStatus
            )
        }

        var nested = SemanticTestFixtures.liveStatus(
            warning: SemanticTestFixtures.warning()
        )
        var warning = try XCTUnwrap(
            nested["currentWarning"] as? [String: Any]
        )
        warning["unexpected"] = 1
        nested["currentWarning"] = warning
        XCTAssertThrowsError(
            try SemanticTestFixtures.decodedStatus(nested)
        )

        var metricsExtra = SemanticTestFixtures.liveStatus()
        var metrics = try XCTUnwrap(
            metricsExtra["metrics"] as? [String: Any]
        )
        metrics["unexpected"] = false
        metricsExtra["metrics"] = metrics
        XCTAssertThrowsError(
            try SemanticTestFixtures.decodedStatus(metricsExtra)
        )
    }

    func testStatusRejectsInvalidEnumsAliasesAndCounters() throws {
        var invalidHealth = SemanticTestFixtures.liveStatus()
        invalidHealth["streamHealth"] = "unknown_health"

        var invalidAlias = SemanticTestFixtures.liveStatus()
        invalidAlias["streamAlias"] = "generation_not_hex"

        var invalidCounts = SemanticTestFixtures.liveStatus()
        invalidCounts["metrics"] = [
            "events": 1,
            "incidents": 2,
            "avoidableCalls": 0,
            "elapsedMs": 1,
        ]

        var invalidBooleanInteger = SemanticTestFixtures.liveStatus()
        invalidBooleanInteger["lastSequence"] = true

        var duplicateIssues = SemanticTestFixtures.liveStatus(
            warning: SemanticTestFixtures.warning(
                issueIDs: ["target", "target"]
            )
        )
        duplicateIssues["promptCoach"] = ["issueIds": []]

        for invalid in [
            invalidHealth,
            invalidAlias,
            invalidCounts,
            invalidBooleanInteger,
            duplicateIssues,
        ] {
            XCTAssertThrowsError(
                try SemanticTestFixtures.decodedStatus(invalid)
            )
        }
    }

    func testStatusRejectsAliasesFromTheWrongSourceDomain() throws {
        var live = SemanticTestFixtures.liveStatus()
        live["traceAlias"] =
            "trace_" + String(repeating: "4", count: 24)

        var trace = SemanticTestFixtures.traceStatus()
        trace["traceAlias"] = SemanticTestFixtures.sessionA

        for invalid in [live, trace] {
            XCTAssertThrowsError(
                try SemanticTestFixtures.decodedStatus(invalid)
            )
        }
    }

    func testStatusRejectsInconsistentHealthCoverageAndEmptyState() throws {
        let inconsistentCoverage = SemanticTestFixtures.liveStatus(
            sourceState: "empty",
            streamHealth: "degraded",
            coverage: "complete"
        )

        var inconsistentEmpty = SemanticTestFixtures.liveStatus(
            sourceState: "empty"
        )
        inconsistentEmpty["metrics"] = [
            "events": 1,
            "incidents": 0,
            "avoidableCalls": 0,
            "elapsedMs": 0,
        ]

        XCTAssertThrowsError(
            try SemanticTestFixtures.decodedStatus(inconsistentCoverage)
        )
        XCTAssertThrowsError(
            try SemanticTestFixtures.decodedStatus(inconsistentEmpty)
        )
    }

    func testStatusReducerRejectsRegressionWithinSameStream() throws {
        var reducer = DashboardStatusReducer()
        let current = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                generation: 7,
                streamAlias: SemanticTestFixtures.streamA,
                lastSequence: 20
            )
        )
        let regressed = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                generation: 7,
                streamAlias: SemanticTestFixtures.streamA,
                lastSequence: 19
            )
        )

        XCTAssertTrue(reducer.accept(current))
        XCTAssertFalse(reducer.accept(regressed))
        XCTAssertEqual(reducer.current, current)
    }

    func testStatusReducerUsesLiveAliasAsStreamIdentityAcrossGenerationChange() throws {
        var reducer = DashboardStatusReducer()
        let current = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                generation: 7,
                streamAlias: SemanticTestFixtures.streamA,
                lastSequence: 20
            )
        )
        let generationOnlyChange = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                generation: 8,
                streamAlias: SemanticTestFixtures.streamA,
                lastSequence: 19
            )
        )

        XCTAssertTrue(reducer.accept(current))
        XCTAssertFalse(reducer.accept(generationOnlyChange))
        XCTAssertEqual(reducer.current, current)
    }

    func testStatusReducerAcceptsNewStreamAliasAsAtomicReset() throws {
        var reducer = DashboardStatusReducer()
        let previous = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                generation: 7,
                streamAlias: SemanticTestFixtures.streamA,
                lastSequence: 20
            )
        )
        let reset = try SemanticTestFixtures.decodedStatus(
            SemanticTestFixtures.liveStatus(
                generation: 1,
                streamAlias: SemanticTestFixtures.streamB,
                lastSequence: 1
            )
        )

        XCTAssertTrue(reducer.accept(previous))
        XCTAssertTrue(reducer.accept(reset))
        XCTAssertEqual(reducer.current, reset)
    }
}
