import Foundation

enum DashboardSource: String, Sendable {
    case live
    case trace
}

struct DashboardEndpoint: Equatable, Sendable {
    static let readyKeys: Set<String> = [
        "v",
        "kind",
        "host",
        "port",
        "token",
        "source",
    ]

    let host: String
    let port: Int
    let token: String
    let source: DashboardSource

    init(readyData: Data) throws {
        let error = PresentationProtocolError.invalidReady
        let object = try ClosedJSON.object(
            from: readyData,
            maximumBytes: 1_024,
            error: error
        )
        try ClosedJSON.requireExactKeys(object, Self.readyKeys, error: error)
        guard
            try ClosedJSON.integer(object["v"], error: error) == 1,
            try ClosedJSON.string(object["kind"], error: error) == "dashboard_ready"
        else {
            throw error
        }
        let host = try ClosedJSON.string(object["host"], error: error)
        let port = try ClosedJSON.integer(
            object["port"],
            minimum: 1,
            maximum: 65_535,
            error: error
        )
        let token = try ClosedJSON.string(object["token"], error: error)
        let sourceValue = try ClosedJSON.string(object["source"], error: error)
        guard
            host == "127.0.0.1",
            ClosedJSON.hasLowercaseHex(token, prefix: "", count: 48),
            let source = DashboardSource(rawValue: sourceValue)
        else {
            throw error
        }
        self.host = host
        self.port = port
        self.token = token
        self.source = source
    }

    var dashboardURL: URL {
        url(path: "/")
    }

    var statusURL: URL {
        url(path: "/api/status")
    }

    private func url(path: String) -> URL {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = port
        components.path = path
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        precondition(components.url != nil)
        return components.url!
    }
}
