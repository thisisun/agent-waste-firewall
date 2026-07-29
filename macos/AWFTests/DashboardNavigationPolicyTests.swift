import Foundation
import XCTest
@testable import AWF

final class DashboardNavigationPolicyTests: XCTestCase {
    private var endpoint: DashboardEndpoint!
    private var policy: DashboardNavigationPolicy!

    override func setUpWithError() throws {
        endpoint = try DashboardEndpoint(
            readyData: SemanticTestFixtures.data(
                SemanticTestFixtures.ready(port: 49_123)
            )
        )
        policy = DashboardNavigationPolicy(
            dashboardURL: endpoint.dashboardURL
        )
    }

    func testAllowsOnlyExactDashboardURLAndWebKitBlankBootstrap() {
        XCTAssertTrue(policy.allows(endpoint.dashboardURL))
        XCTAssertTrue(policy.allows(URL(string: "about:blank")))
        XCTAssertFalse(policy.allows(nil))
    }

    func testAllowsOnlyBundledSameDocumentFragments() {
        let token = SemanticTestFixtures.token
        XCTAssertTrue(
            policy.allows(
                URL(string: "http://127.0.0.1:49123/?token=\(token)#main")
            )
        )
        XCTAssertTrue(
            policy.allows(
                URL(string: "http://127.0.0.1:49123/?token=\(token)#")
            )
        )
        XCTAssertFalse(
            policy.allows(
                URL(string: "http://127.0.0.1:49123/?token=\(token)#other")
            )
        )
        XCTAssertFalse(
            policy.allows(
                URL(
                    string: "http://127.0.0.1:49123/api/status?token=\(token)#main"
                )
            )
        )
    }

    func testRejectsHostPortSchemePathAndTokenChanges() {
        let token = SemanticTestFixtures.token
        let rejected = [
            "http://localhost:49123/?token=\(token)",
            "http://127.0.0.1:49124/?token=\(token)",
            "https://127.0.0.1:49123/?token=\(token)",
            "file:///tmp/index.html",
            "http://127.0.0.1:49123/api/status?token=\(token)",
            "http://127.0.0.1:49123/?token=\(String(repeating: "b", count: 48))",
            "http://127.0.0.1:49123/?token=\(token)&extra=1",
            "http://127.0.0.1:49123/?token=\(token)#fragment",
            "http://user@127.0.0.1:49123/?token=\(token)",
        ]

        for value in rejected {
            XCTAssertFalse(policy.allows(URL(string: value)), value)
        }
    }

    func testRejectsLoopbackLookalikes() {
        let token = SemanticTestFixtures.token
        let rejected = [
            "http://127.0.0.2:49123/?token=\(token)",
            "http://[::1]:49123/?token=\(token)",
            "http://127.0.0.1.example:49123/?token=\(token)",
        ]

        for value in rejected {
            XCTAssertFalse(policy.allows(URL(string: value)), value)
        }
    }
}
