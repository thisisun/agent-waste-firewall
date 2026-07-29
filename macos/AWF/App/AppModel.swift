import AppKit
import Combine
import Foundation

enum MonitorFailure: String, Equatable, Sendable {
    case nodeUnavailable
    case workerUnavailable
    case launchFailed
    case readinessTimedOut
    case invalidReadiness
    case statusUnavailable

    var localizedTitle: String {
        NSLocalizedString("failure.\(rawValue)", comment: "")
    }
}

@MainActor
final class AppModel: ObservableObject {
    static let shared = AppModel()

    @Published private(set) var endpoint: DashboardEndpoint?
    @Published private(set) var status: DashboardStatus?
    @Published private(set) var providerIntegration:
        ProviderIntegrationStatus?
    @Published private(set) var transport: MonitorTransportState = .starting
    @Published private(set) var failure: MonitorFailure?
    @Published var isSentinelVisible: Bool {
        didSet {
            UserDefaults.standard.set(
                isSentinelVisible,
                forKey: Self.sentinelVisibilityKey
            )
            sentinelController?.setVisible(isSentinelVisible)
        }
    }

    private static let sentinelVisibilityKey = "AWFSentinelVisible"
    private let supervisor = DashboardSupervisor()
    private let statusClient = DashboardStatusClient()
    private var reducer = DashboardStatusReducer()
    private var launchTask: Task<Void, Never>?
    private var monitorTask: Task<Void, Never>?
    private var integrationTask: Task<Void, Never>?
    private var sentinelController: SentinelPanelController?
    private var openDashboardAction: (@MainActor () -> Void)?
    private var started = false

    private init() {
        if UserDefaults.standard.object(
            forKey: Self.sentinelVisibilityKey
        ) == nil {
            isSentinelVisible = true
        } else {
            isSentinelVisible = UserDefaults.standard.bool(
                forKey: Self.sentinelVisibilityKey
            )
        }
    }

    var visualState: SentinelVisualState {
        SentinelVisualState.project(
            transport: transport,
            status: status,
            integration: providerIntegration
        )
    }

    var currentModeTitle: String {
        guard transport == .online, let mode = status?.mode else {
            return NSLocalizedString("mode.unavailable", comment: "")
        }
        return NSLocalizedString("mode.\(mode.rawValue)", comment: "")
    }

    var currentRuleTitle: String? {
        guard
            transport == .online,
            let rule = status?.warning?.rule
        else {
            return nil
        }
        return NSLocalizedString("rule.\(rule.rawValue)", comment: "")
    }

    func startIfNeeded() {
        installSentinelIfNeeded()
        guard !started else {
            return
        }
        started = true
        launch()
    }

    func retry() {
        monitorTask?.cancel()
        integrationTask?.cancel()
        launchTask?.cancel()
        supervisor.stop()
        if endpoint != nil {
            endpoint = nil
        }
        if status != nil {
            status = nil
        }
        if providerIntegration != nil {
            providerIntegration = nil
        }
        reducer = DashboardStatusReducer()
        if transport != .starting {
            transport = .starting
        }
        if failure != nil {
            failure = nil
        }
        refreshSentinel()
        launch()
    }

    func stop() {
        started = false
        launchTask?.cancel()
        monitorTask?.cancel()
        integrationTask?.cancel()
        launchTask = nil
        monitorTask = nil
        integrationTask = nil
        supervisor.stop()
        sentinelController?.close()
        sentinelController = nil
    }

    func toggleSentinel() {
        isSentinelVisible.toggle()
    }

    func registerOpenDashboard(
        _ action: @escaping @MainActor () -> Void
    ) {
        openDashboardAction = action
    }

    func requestOpenDashboard() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: {
            $0.title == "AWF" && $0.canBecomeMain
        }) {
            window.makeKeyAndOrderFront(nil)
        } else {
            openDashboardAction?()
        }
    }

    private func launch() {
        launchTask = Task { [weak self] in
            guard let self else {
                return
            }
            do {
                let configuration = try RuntimeLocator.locate()
                let endpoint = try await supervisor.start(
                    configuration: configuration
                )
                guard !Task.isCancelled else {
                    return
                }
                self.endpoint = endpoint
                if self.failure != nil {
                    self.failure = nil
                }
                if self.transport != .starting {
                    self.transport = .starting
                }
                self.refreshSentinel()
                self.startMonitoring(endpoint)
            } catch is CancellationError {
                return
            } catch let launchFailure as DashboardLaunchFailure {
                guard !Task.isCancelled else {
                    return
                }
                if self.transport != .offline {
                    self.transport = .offline
                }
                let failure = MonitorFailure(
                    rawValue: launchFailure.rawValue
                ) ?? .launchFailed
                if self.failure != failure {
                    self.failure = failure
                }
                self.refreshSentinel()
            } catch {
                guard !Task.isCancelled else {
                    return
                }
                if self.transport != .offline {
                    self.transport = .offline
                }
                if self.failure != .launchFailed {
                    self.failure = .launchFailed
                }
                self.refreshSentinel()
            }
        }
    }

    private func startMonitoring(_ endpoint: DashboardEndpoint) {
        monitorTask?.cancel()
        integrationTask?.cancel()
        monitorTask = Task { [weak self] in
            guard let self else {
                return
            }
            while !Task.isCancelled {
                do {
                    let candidate = try await statusClient.fetch(endpoint)
                    guard !Task.isCancelled else {
                        return
                    }
                    guard candidate.source == endpoint.source else {
                        throw PresentationProtocolError.invalidStatus
                    }
                    if reducer.accept(candidate), status != candidate {
                        status = candidate
                    }
                    if transport != .online {
                        transport = .online
                    }
                    if failure != nil {
                        failure = nil
                    }
                } catch {
                    guard !Task.isCancelled else {
                        return
                    }
                    if transport != .offline {
                        transport = .offline
                    }
                    if failure != .statusUnavailable {
                        failure = .statusUnavailable
                    }
                    if providerIntegration != nil {
                        providerIntegration = nil
                    }
                }
                refreshSentinel()
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch {
                    return
                }
            }
        }
        integrationTask = Task { [weak self] in
            guard let self else {
                return
            }
            while !Task.isCancelled {
                do {
                    let integration = try await statusClient
                        .fetchIntegration(endpoint)
                    guard !Task.isCancelled else {
                        return
                    }
                    guard
                        self.endpoint == endpoint,
                        transport == .online
                    else {
                        if providerIntegration != nil {
                            providerIntegration = nil
                            refreshSentinel()
                        }
                        try await Task.sleep(for: .seconds(1))
                        continue
                    }
                    if providerIntegration != integration {
                        providerIntegration = integration
                        refreshSentinel()
                    }
                } catch {
                    guard !Task.isCancelled else {
                        return
                    }
                    if providerIntegration != nil {
                        providerIntegration = nil
                        refreshSentinel()
                    }
                }
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch {
                    return
                }
            }
        }
    }

    private func installSentinelIfNeeded() {
        guard sentinelController == nil else {
            return
        }
        let controller = SentinelPanelController { [weak self] in
            self?.requestOpenDashboard()
        }
        sentinelController = controller
        controller.update(visualState)
        controller.setVisible(isSentinelVisible)
    }

    private func refreshSentinel() {
        sentinelController?.update(visualState)
    }
}
