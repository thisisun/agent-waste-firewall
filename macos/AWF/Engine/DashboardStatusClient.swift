import Foundation

enum DashboardStatusClientError: Error {
    case invalidResponse
}

private final class NoRedirectTaskDelegate:
    NSObject,
    URLSessionTaskDelegate,
    @unchecked Sendable
{
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

final class DashboardStatusClient: Sendable {
    private static let maximumResponseBytes = 16 * 1_024
    private let session: URLSession
    private let redirectDelegate = NoRedirectTaskDelegate()

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 2
        configuration.timeoutIntervalForResource = 3
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.connectionProxyDictionary = [:]
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    func fetch(_ endpoint: DashboardEndpoint) async throws -> DashboardStatus {
        var request = URLRequest(url: endpoint.statusURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let (bytes, response) = try await session.bytes(
            for: request,
            delegate: redirectDelegate
        )
        guard
            let response = response as? HTTPURLResponse,
            response.statusCode == 200,
            response.url == endpoint.statusURL,
            response.mimeType == "application/json",
            response.expectedContentLength <=
                Int64(Self.maximumResponseBytes)
        else {
            bytes.task.cancel()
            throw DashboardStatusClientError.invalidResponse
        }

        let task = bytes.task
        var data = Data()
        data.reserveCapacity(
            min(
                max(Int(response.expectedContentLength), 0),
                Self.maximumResponseBytes
            )
        )
        for try await byte in bytes {
            guard data.count < Self.maximumResponseBytes else {
                task.cancel()
                throw DashboardStatusClientError.invalidResponse
            }
            data.append(byte)
        }
        return try DashboardStatus(data: data)
    }

    deinit {
        session.invalidateAndCancel()
    }
}
