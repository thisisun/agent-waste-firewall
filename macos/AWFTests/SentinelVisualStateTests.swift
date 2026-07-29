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

        let cases: [
            (
                transport: MonitorTransportState,
                status: DashboardStatus?,
                expected: SentinelVisualState
            )
        ] = [
            (.starting, nil, .offline),
            (.offline, clear, .offline),
            (.online, disconnected, .offline),
            (.online, empty, .review),
            (.online, clear, .clear),
            (.online, low, .review),
            (.online, medium, .review),
            (.online, highFirst, .danger),
            (.online, highSecond, .danger),
            (.online, highThird, .critical),
            (.online, stale, .degraded),
            (.online, degraded, .degraded),
            (.online, incomplete, .degraded),
        ]

        for current in cases {
            XCTAssertEqual(
                SentinelVisualState.project(
                    transport: current.transport,
                    status: current.status
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

}
