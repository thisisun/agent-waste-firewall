import XCTest
@testable import AWF

@MainActor
final class SentinelVisualStateTests: XCTestCase {
    func testProjectionCoversEveryTransportAndSemanticState() throws {
        let empty = try status(
            SemanticTestFixtures.liveStatus(sourceState: "empty")
        )
        let clear = try status(SemanticTestFixtures.liveStatus())
        let low = try status(
            SemanticTestFixtures.liveStatus(
                warning: SemanticTestFixtures.warning(severity: "low")
            )
        )
        let medium = try status(
            SemanticTestFixtures.liveStatus(
                warning: SemanticTestFixtures.warning(severity: "medium")
            )
        )
        let highFirst = try status(
            SemanticTestFixtures.liveStatus(
                warning: SemanticTestFixtures.warning(
                    severity: "high",
                    occurrences: 1
                )
            )
        )
        let highSecond = try status(
            SemanticTestFixtures.liveStatus(
                warning: SemanticTestFixtures.warning(
                    severity: "high",
                    occurrences: 2
                )
            )
        )
        let highThird = try status(
            SemanticTestFixtures.liveStatus(
                warning: SemanticTestFixtures.warning(
                    severity: "high",
                    occurrences: 3
                )
            )
        )
        let stale = try status(
            SemanticTestFixtures.liveStatus(
                streamHealth: "stale",
                coverage: "unknown"
            )
        )
        let degraded = try status(
            SemanticTestFixtures.liveStatus(
                streamHealth: "degraded",
                coverage: "unknown"
            )
        )
        let incomplete = try status(
            SemanticTestFixtures.liveStatus(coverage: "incomplete")
        )
        let disconnected = try status(
            SemanticTestFixtures.liveStatus(
                connected: false,
                sourceState: "empty"
            )
        )
        let unobserved = try integration()
        let observed = try integration(
            codexState: "active",
            codexActivity: "observed"
        )

        let cases: [
            (
                transport: MonitorTransportState,
                status: DashboardStatus?,
                integration: ProviderIntegrationStatus?,
                expected: SentinelVisualState
            )
        ] = [
            (.starting, nil, nil, .offline),
            (.offline, clear, observed, .offline),
            (.online, disconnected, observed, .offline),
            (.online, empty, observed, .review),
            (.online, clear, observed, .clear),
            (.online, clear, unobserved, .review),
            (.online, clear, nil, .review),
            (.online, low, unobserved, .review),
            (.online, medium, unobserved, .review),
            (.online, highFirst, unobserved, .danger),
            (.online, highSecond, unobserved, .danger),
            (.online, highThird, unobserved, .critical),
            (.online, stale, observed, .degraded),
            (.online, degraded, observed, .degraded),
            (.online, incomplete, observed, .degraded),
        ]

        for current in cases {
            XCTAssertEqual(
                SentinelVisualState.project(
                    transport: current.transport,
                    status: current.status,
                    integration: current.integration
                ),
                current.expected
            )
        }
    }

    func testOnlyCriticalStateEnablesCriticalBackground() {
        for state in SentinelVisualState.allCases {
            XCTAssertEqual(state.isCritical, state == .critical)
        }
    }

    func testOnlyCriticalStateProvidesPanelBackgroundOpacity() {
        for state in SentinelVisualState.allCases where state != .critical {
            XCTAssertEqual(
                state.criticalBackgroundOpacity(
                    reduceTransparency: false
                ),
                0
            )
        }
        XCTAssertEqual(
            SentinelVisualState.critical.criticalBackgroundOpacity(
                reduceTransparency: false
            ),
            0.38
        )
        XCTAssertEqual(
            SentinelVisualState.critical.criticalBackgroundOpacity(
                reduceTransparency: true
            ),
            1
        )
    }

    private func status(
        _ object: [String: Any]
    ) throws -> DashboardStatus {
        try SemanticTestFixtures.decodedStatus(object)
    }

    private func integration(
        codexState: String = "installed_unverified",
        codexActivity: String = "not_observed"
    ) throws -> ProviderIntegrationStatus {
        try SemanticTestFixtures.decodedProviderIntegration(
            SemanticTestFixtures.providerIntegration(
                codexState: codexState,
                codexActivity: codexActivity
            )
        )
    }

}
