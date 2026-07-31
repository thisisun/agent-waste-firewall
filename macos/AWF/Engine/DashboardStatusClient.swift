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
        configuration.timeoutIntervalForRequest = 4
        configuration.timeoutIntervalForResource = 5
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.connectionProxyDictionary = [:]
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    func fetch(_ endpoint: DashboardEndpoint) async throws -> DashboardStatus {
        let data = try await fetchData(
            endpoint.statusURL,
            timeoutInterval: 2
        )
        return try DashboardStatus(data: data)
    }

    func fetchIntegration(
        _ endpoint: DashboardEndpoint
    ) async throws -> ProviderIntegrationStatus {
        let data = try await fetchData(
            endpoint.integrationURL,
            timeoutInterval: 4
        )
        return try ProviderIntegrationStatus(data: data)
    }

    private func fetchData(
        _ url: URL,
        timeoutInterval: TimeInterval
    ) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = timeoutInterval
        let (bytes, response) = try await session.bytes(
            for: request,
            delegate: redirectDelegate
        )
        guard
            let response = response as? HTTPURLResponse,
            response.statusCode == 200,
            response.url == url,
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
        return data
    }

    deinit {
        session.invalidateAndCancel()
    }
}
