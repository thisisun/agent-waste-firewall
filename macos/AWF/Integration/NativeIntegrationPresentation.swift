import SwiftUI

enum NativeIntegrationPayloadStatus: Equatable, Sendable {
    case checking
    case available
    case unavailable(NativeIntegrationFailure)
}

enum NativeIntegrationAction: String, CaseIterable, Equatable, Sendable {
    case install
    case repair
    case rollback
    case uninstall
    case refresh

    var titleKey: String {
        switch self {
        case .install:
            return "integration.action.install"
        case .repair:
            return "integration.action.repair"
        case .rollback:
            return "integration.action.rollback"
        case .uninstall:
            return "integration.action.uninstall"
        case .refresh:
            return "integration.action.refresh"
        }
    }

    var confirmationTitleKey: String {
        switch self {
        case .install:
            return "integration.confirm.install.title"
        case .repair:
            return "integration.confirm.repair.title"
        case .rollback:
            return "integration.confirm.rollback.title"
        case .uninstall:
            return "integration.confirm.uninstall.title"
        case .refresh:
            return "integration.action.refresh"
        }
    }

    var confirmationDetailKey: String {
        switch self {
        case .install:
            return "integration.confirm.install.detail"
        case .repair:
            return "integration.confirm.repair.detail"
        case .rollback:
            return "integration.confirm.rollback.detail"
        case .uninstall:
            return "integration.confirm.uninstall.detail"
        case .refresh:
            return "integration.detail.refresh"
        }
    }

    var applyingKey: String {
        switch self {
        case .install:
            return "integration.applying.install"
        case .repair:
            return "integration.applying.repair"
        case .rollback:
            return "integration.applying.rollback"
        case .uninstall:
            return "integration.applying.uninstall"
        case .refresh:
            return "integration.applying.refresh"
        }
    }

    var symbolName: String {
        switch self {
        case .install:
            return "square.and.arrow.down"
        case .repair:
            return "wrench.and.screwdriver"
        case .rollback:
            return "arrow.uturn.backward.circle"
        case .uninstall:
            return "trash"
        case .refresh:
            return "arrow.clockwise"
        }
    }

    var requiresConfirmation: Bool {
        self != .refresh
    }

    var isDestructive: Bool {
        self == .uninstall
    }
}

enum NativeIntegrationOperation: Equatable, Sendable {
    case idle
    case applying(NativeIntegrationAction)

    var applyingAction: NativeIntegrationAction? {
        guard case let .applying(action) = self else {
            return nil
        }
        return action
    }

    var isApplying: Bool {
        applyingAction != nil
    }
}

enum NativeIntegrationPresentationResult: Equatable, Sendable {
    case succeeded(NativeIntegrationMutationResult)
    case failed(NativeIntegrationFailure)
}

enum NativeIntegrationPresentationColor: String, Equatable, Sendable {
    case neutral
    case healthy
    case attention
    case danger

    var color: Color {
        switch self {
        case .neutral:
            return Color(red: 0.48, green: 0.50, blue: 0.54)
        case .healthy:
            return Color(red: 0.0, green: 0.78, blue: 0.42)
        case .attention:
            return Color(red: 0.96, green: 0.70, blue: 0.08)
        case .danger:
            return Color(red: 0.93, green: 0.16, blue: 0.18)
        }
    }
}

struct NativeIntegrationPresentationNotice: Equatable, Sendable {
    let key: String
    let symbolName: String
    let colorRole: NativeIntegrationPresentationColor
}

struct NativeIntegrationPresentation: Equatable, Sendable {
    static let targetDisplayPath =
        "~/Library/Application Support/" +
        "io.github.thisisun.agent-waste-firewall/integration-v1"

    static let ownedItemLabels = [
        "awf-hook",
        "activation.json",
        NativeIntegrationLedger.filename,
        "versions/<release>/awf-node",
    ]

    let titleKey: String
    let detailKey: String
    let reasonKey: String?
    let symbolName: String
    let colorRole: NativeIntegrationPresentationColor
    let primaryAction: NativeIntegrationAction?
    let secondaryActions: [NativeIntegrationAction]
    let applyingAction: NativeIntegrationAction?
    let notice: NativeIntegrationPresentationNotice?

    var isApplying: Bool {
        applyingAction != nil
    }

    var actions: [NativeIntegrationAction] {
        (primaryAction.map { [$0] } ?? []) + secondaryActions
    }

    static func project(
        snapshot: NativeIntegrationSnapshot,
        payloadStatus: NativeIntegrationPayloadStatus,
        operation: NativeIntegrationOperation,
        result: NativeIntegrationPresentationResult?
    ) -> Self {
        if let action = operation.applyingAction {
            return Self(
                titleKey: "integration.status.applying",
                detailKey: action.applyingKey,
                reasonKey: nil,
                symbolName: "arrow.triangle.2.circlepath",
                colorRole: .neutral,
                primaryAction: nil,
                secondaryActions: [],
                applyingAction: action,
                notice: notice(for: result)
            )
        }

        let state = statePresentation(
            snapshot: snapshot,
            payloadStatus: payloadStatus
        )
        return Self(
            titleKey: state.titleKey,
            detailKey: state.detailKey,
            reasonKey: state.reasonKey,
            symbolName: state.symbolName,
            colorRole: state.colorRole,
            primaryAction: state.primaryAction,
            secondaryActions: state.secondaryActions,
            applyingAction: nil,
            notice: notice(for: result)
        )
    }

    private struct StatePresentation {
        let titleKey: String
        let detailKey: String
        let reasonKey: String?
        let symbolName: String
        let colorRole: NativeIntegrationPresentationColor
        let primaryAction: NativeIntegrationAction?
        let secondaryActions: [NativeIntegrationAction]
    }

    private static func statePresentation(
        snapshot: NativeIntegrationSnapshot,
        payloadStatus: NativeIntegrationPayloadStatus
    ) -> StatePresentation {
        switch snapshot.condition {
        case .notInstalled:
            return notInstalledPresentation(payloadStatus)
        case .healthy:
            var actions: [NativeIntegrationAction] = []
            if snapshot.canRollback {
                actions.append(.rollback)
            }
            actions.append(contentsOf: [.uninstall, .refresh])
            return StatePresentation(
                titleKey: "integration.status.ready",
                detailKey: "integration.detail.ready",
                reasonKey: nil,
                symbolName: "checkmark.shield.fill",
                colorRole: .healthy,
                primaryAction: nil,
                secondaryActions: actions
            )
        case .needsRepair:
            return repairPresentation(
                snapshot: snapshot,
                payloadStatus: payloadStatus
            )
        case .unsafeLayout:
            return StatePresentation(
                titleKey: "integration.status.blocked",
                detailKey: "integration.detail.blocked",
                reasonKey: "integration.reason.unsafeLayout",
                symbolName: "exclamationmark.shield.fill",
                colorRole: .danger,
                primaryAction: nil,
                secondaryActions: [.refresh]
            )
        }
    }

    private static func notInstalledPresentation(
        _ payloadStatus: NativeIntegrationPayloadStatus
    ) -> StatePresentation {
        switch payloadStatus {
        case .checking:
            return StatePresentation(
                titleKey: "integration.status.checkingPayload",
                detailKey: "integration.detail.checkingPayload",
                reasonKey: nil,
                symbolName: "hourglass.circle.fill",
                colorRole: .neutral,
                primaryAction: nil,
                secondaryActions: [.refresh]
            )
        case .available:
            return StatePresentation(
                titleKey: "integration.status.notInstalled",
                detailKey: "integration.detail.notInstalled",
                reasonKey: nil,
                symbolName: "square.and.arrow.down.fill",
                colorRole: .attention,
                primaryAction: .install,
                secondaryActions: [.refresh]
            )
        case let .unavailable(failure):
            return StatePresentation(
                titleKey: "integration.status.payloadUnavailable",
                detailKey: "integration.detail.payloadUnavailable",
                reasonKey: payloadFailureKey(failure),
                symbolName: "exclamationmark.triangle.fill",
                colorRole: .attention,
                primaryAction: nil,
                secondaryActions: [.refresh]
            )
        }
    }

    private static func repairPresentation(
        snapshot: NativeIntegrationSnapshot,
        payloadStatus: NativeIntegrationPayloadStatus
    ) -> StatePresentation {
        var actions: [NativeIntegrationAction] = []
        if snapshot.canRollback {
            actions.append(.rollback)
        }
        actions.append(contentsOf: [.uninstall, .refresh])

        let primaryAction: NativeIntegrationAction?
        let detailKey: String
        let payloadReasonKey: String?
        switch payloadStatus {
        case .available:
            primaryAction = .repair
            detailKey = "integration.detail.needsRepair"
            payloadReasonKey = nil
        case .checking:
            primaryAction = nil
            detailKey = "integration.detail.repairPayloadChecking"
            payloadReasonKey = nil
        case let .unavailable(failure):
            primaryAction = nil
            detailKey = "integration.detail.repairPayloadUnavailable"
            payloadReasonKey = payloadFailureKey(failure)
        }

        return StatePresentation(
            titleKey: "integration.status.needsRepair",
            detailKey: detailKey,
            reasonKey: payloadReasonKey ??
                repairReasonKey(snapshot.reason),
            symbolName: "wrench.and.screwdriver.fill",
            colorRole: .attention,
            primaryAction: primaryAction,
            secondaryActions: actions
        )
    }

    private static func repairReasonKey(
        _ reason: NativeIntegrationRepairReason?
    ) -> String {
        switch reason {
        case .helperMissing:
            return "integration.reason.helperMissing"
        case .helperInvalid:
            return "integration.reason.helperInvalid"
        case .activationMissing:
            return "integration.reason.activationMissing"
        case .activationInvalid:
            return "integration.reason.activationInvalid"
        case .ledgerMissing:
            return "integration.reason.ledgerMissing"
        case .ledgerInvalid:
            return "integration.reason.ledgerInvalid"
        case .runtimeMissing:
            return "integration.reason.runtimeMissing"
        case .runtimeInvalid:
            return "integration.reason.runtimeInvalid"
        case .unsupportedProtocol:
            return "integration.reason.unsupportedProtocol"
        case nil:
            return "integration.reason.unknown"
        }
    }

    private static func payloadFailureKey(
        _ failure: NativeIntegrationFailure
    ) -> String {
        switch failure {
        case .payloadUnavailable:
            return "integration.payload.missing"
        case .payloadInvalid:
            return "integration.payload.invalid"
        case .runtimeIncompatible:
            return "integration.payload.incompatible"
        case .unsafeLayout,
             .invalidLedger,
             .invalidActivation,
             .noRollbackCandidate,
             .ioFailure,
             .injectedFailure:
            return "integration.payload.unavailable"
        }
    }

    private static func notice(
        for result: NativeIntegrationPresentationResult?
    ) -> NativeIntegrationPresentationNotice? {
        guard let result else {
            return nil
        }
        switch result {
        case let .succeeded(mutation):
            let role: NativeIntegrationPresentationColor =
                mutation == .uninstalledWithResidue
                    ? .attention
                    : .healthy
            return NativeIntegrationPresentationNotice(
                key: resultKey(mutation),
                symbolName: mutation == .uninstalledWithResidue
                    ? "exclamationmark.circle.fill"
                    : "checkmark.circle.fill",
                colorRole: role
            )
        case let .failed(failure):
            return NativeIntegrationPresentationNotice(
                key: failureKey(failure),
                symbolName: "xmark.octagon.fill",
                colorRole: .danger
            )
        }
    }

    private static func resultKey(
        _ result: NativeIntegrationMutationResult
    ) -> String {
        switch result {
        case .installed:
            return "integration.result.installed"
        case .upgraded:
            return "integration.result.upgraded"
        case .repaired:
            return "integration.result.repaired"
        case .rolledBack:
            return "integration.result.rolledBack"
        case .uninstalled:
            return "integration.result.uninstalled"
        case .uninstalledWithResidue:
            return "integration.result.uninstalledWithResidue"
        case .noChange:
            return "integration.result.noChange"
        }
    }

    private static func failureKey(
        _ failure: NativeIntegrationFailure
    ) -> String {
        switch failure {
        case .payloadUnavailable:
            return "integration.failure.payloadUnavailable"
        case .payloadInvalid:
            return "integration.failure.payloadInvalid"
        case .runtimeIncompatible:
            return "integration.failure.runtimeIncompatible"
        case .unsafeLayout:
            return "integration.failure.unsafeLayout"
        case .invalidLedger:
            return "integration.failure.invalidLedger"
        case .invalidActivation:
            return "integration.failure.invalidActivation"
        case .noRollbackCandidate:
            return "integration.failure.noRollbackCandidate"
        case .ioFailure:
            return "integration.failure.ioFailure"
        case .injectedFailure:
            return "integration.failure.operationFailed"
        }
    }
}
