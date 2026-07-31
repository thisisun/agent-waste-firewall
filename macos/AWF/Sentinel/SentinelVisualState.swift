import SwiftUI

enum MonitorTransportState: Equatable, Sendable {
    case starting
    case online
    case offline
}

enum SentinelVisualState: String, CaseIterable, Sendable {
    case clear
    case review
    case danger
    case critical
    case degraded
    case offline

    static func project(
        transport: MonitorTransportState,
        status: DashboardStatus?,
        integration: ProviderIntegrationStatus?
    ) -> SentinelVisualState {
        guard transport == .online, let status, status.connected else {
            return .offline
        }
        guard
            status.streamHealth == .healthy,
            status.coverage == .complete
        else {
            return .degraded
        }
        if let warning = status.warning {
            switch warning.severity {
            case .low, .medium:
                return .review
            case .high:
                return warning.occurrences >= 3 ? .critical : .danger
            }
        }
        guard
            status.sourceState != .empty,
            integration?.hasObservedActivity == true
        else {
            return .review
        }
        return .clear
    }

    var color: Color {
        switch self {
        case .clear:
            return Color(red: 0.0, green: 0.78, blue: 0.42)
        case .review:
            return Color(red: 0.96, green: 0.70, blue: 0.08)
        case .danger, .critical, .degraded:
            return Color(red: 0.93, green: 0.16, blue: 0.18)
        case .offline:
            return Color(red: 0.48, green: 0.50, blue: 0.54)
        }
    }

    var symbolName: String {
        switch self {
        case .clear:
            return "eye.fill"
        case .review:
            return "exclamationmark.circle.fill"
        case .danger:
            return "exclamationmark.triangle.fill"
        case .critical:
            return "exclamationmark.octagon.fill"
        case .degraded:
            return "xmark.octagon.fill"
        case .offline:
            return "eye.slash.fill"
        }
    }

    func localizedTitle(language: AppLanguage) -> String {
        AppLocalization.string(
            "status.\(rawValue)",
            language: language
        )
    }

    var isCritical: Bool {
        self == .critical
    }

    func criticalBackgroundOpacity(
        reduceTransparency: Bool
    ) -> Double {
        guard isCritical else {
            return 0
        }
        return reduceTransparency ? 1 : 0.38
    }
}

@MainActor
final class SentinelPanelModel: ObservableObject {
    @Published private(set) var state: SentinelVisualState = .offline
    @Published private(set) var language: AppLanguage = .defaultLanguage

    func update(
        _ state: SentinelVisualState,
        language: AppLanguage
    ) {
        if self.state != state {
            self.state = state
        }
        if self.language != language {
            self.language = language
        }
    }
}
