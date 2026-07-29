import Foundation

struct DashboardNavigationPolicy: Equatable, Sendable {
    private static let allowedFragments: Set<String?> = [
        nil,
        "",
        "main",
    ]

    let dashboardURL: URL

    func allows(_ candidate: URL?) -> Bool {
        guard let candidate else {
            return false
        }
        if candidate.absoluteString == "about:blank" {
            return true
        }
        guard
            let expected = URLComponents(
                url: dashboardURL,
                resolvingAgainstBaseURL: false
            ),
            let actual = URLComponents(
                url: candidate,
                resolvingAgainstBaseURL: false
            )
        else {
            return false
        }
        return actual.scheme == "http" &&
            actual.host == "127.0.0.1" &&
            actual.scheme == expected.scheme &&
            actual.host == expected.host &&
            actual.port == expected.port &&
            actual.path == "/" &&
            Self.allowedFragments.contains(actual.fragment) &&
            actual.user == nil &&
            actual.password == nil &&
            actual.queryItems == expected.queryItems
    }
}
