import AppKit
import SwiftUI

struct IntegrationManagerView: View {
    let snapshot: NativeIntegrationSnapshot
    let payloadStatus: NativeIntegrationPayloadStatus
    let operation: NativeIntegrationOperation
    let result: NativeIntegrationPresentationResult?
    let localized: (String) -> String
    let install: () -> Void
    let repair: () -> Void
    let rollback: () -> Void
    let uninstall: () -> Void
    let refresh: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pendingAction: NativeIntegrationAction?

    init(
        snapshot: NativeIntegrationSnapshot,
        payloadStatus: NativeIntegrationPayloadStatus,
        operation: NativeIntegrationOperation,
        result: NativeIntegrationPresentationResult?,
        localized: @escaping (String) -> String,
        install: @escaping () -> Void,
        repair: @escaping () -> Void,
        rollback: @escaping () -> Void,
        uninstall: @escaping () -> Void,
        refresh: @escaping () -> Void
    ) {
        self.snapshot = snapshot
        self.payloadStatus = payloadStatus
        self.operation = operation
        self.result = result
        self.localized = localized
        self.install = install
        self.repair = repair
        self.rollback = rollback
        self.uninstall = uninstall
        self.refresh = refresh
    }

    private var presentation: NativeIntegrationPresentation {
        NativeIntegrationPresentation.project(
            snapshot: snapshot,
            payloadStatus: payloadStatus,
            operation: operation,
            result: result
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            Group {
                if let applyingAction = presentation.applyingAction {
                    applyingView(applyingAction)
                } else if let pendingAction {
                    confirmationView(pendingAction)
                } else {
                    details
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
            actionBar
        }
        .frame(width: 560, height: 480)
        .background(Color(nsColor: .windowBackgroundColor))
        .interactiveDismissDisabled(presentation.isApplying)
        .accessibilityIdentifier("awf.integration.sheet")
        .onChange(of: snapshot) { _ in
            pendingAction = nil
        }
        .onChange(of: operation) { newValue in
            if newValue.isApplying {
                pendingAction = nil
            }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            Image(systemName: presentation.symbolName)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(presentation.colorRole.color)
                .frame(width: 38, height: 38)
                .background(
                    presentation.colorRole.color.opacity(0.12),
                    in: Circle()
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(localized("integration.title"))
                    .font(.headline)
                Text(localized(presentation.titleKey))
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(presentation.colorRole.color)
                    .accessibilityIdentifier("awf.integration.status")
            }

            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.borderless)
            .disabled(presentation.isApplying)
            .help(localized("integration.action.close"))
            .accessibilityLabel(
                Text(localized("integration.action.close"))
            )
            .accessibilityIdentifier("awf.integration.close")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 16)
    }

    private var details: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(localized(presentation.detailKey))
                        .font(.body)
                    if let reasonKey = presentation.reasonKey {
                        Label(
                            localized(reasonKey),
                            systemImage: "info.circle"
                        )
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    }
                }

                if let notice = presentation.notice {
                    Label(
                        localized(notice.key),
                        systemImage: notice.symbolName
                    )
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(notice.colorRole.color)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        notice.colorRole.color.opacity(0.10),
                        in: RoundedRectangle(
                            cornerRadius: 10,
                            style: .continuous
                        )
                    )
                    .accessibilityIdentifier("awf.integration.result")
                }

                targetSection

                Label(
                    localized("integration.privacy.rawFree"),
                    systemImage: "lock.shield.fill"
                )
                .font(.callout)

                Label(
                    localized("integration.providerTrust.separate"),
                    systemImage: "hand.raised.fill"
                )
                .font(.callout)
            }
            .padding(22)
        }
    }

    private var targetSection: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 9) {
                Text(NativeIntegrationPresentation.targetDisplayPath)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("awf.integration.target")

                Divider()

                ForEach(
                    NativeIntegrationPresentation.ownedItemLabels,
                    id: \.self
                ) { item in
                    Label(item, systemImage: "doc")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
        } label: {
            Text(localized("integration.target.title"))
                .font(.callout.weight(.semibold))
        }
    }

    private func applyingView(
        _ action: NativeIntegrationAction
    ) -> some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text(localized(action.applyingKey))
                .font(.title3.weight(.semibold))
            Text(localized("integration.applying.detail"))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 390)
        }
        .padding(32)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("awf.integration.applying")
    }

    private func confirmationView(
        _ action: NativeIntegrationAction
    ) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(
                localized(action.confirmationTitleKey),
                systemImage: action.symbolName
            )
            .font(.title3.weight(.bold))

            Text(localized(action.confirmationDetailKey))
                .foregroundStyle(.secondary)

            GroupBox {
                VStack(alignment: .leading, spacing: 8) {
                    Text(
                        NativeIntegrationPresentation.targetDisplayPath
                    )
                    .font(.system(.caption, design: .monospaced))
                    Text(
                        localized(
                            "integration.confirm.ownedItemsOnly"
                        )
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if action == .uninstall {
                Label(
                    localized(
                        "integration.confirm.uninstall.preservesData"
                    ),
                    systemImage: "externaldrive.fill"
                )
                .font(.callout)
            }

            Spacer()

            HStack {
                Spacer()
                Button(
                    localized("integration.action.cancel"),
                    role: .cancel
                ) {
                    pendingAction = nil
                }
                .keyboardShortcut(.cancelAction)

                Button(
                    localized(action.titleKey),
                    role: action.isDestructive ? .destructive : nil
                ) {
                    perform(action)
                }
                .buttonStyle(.borderedProminent)
                .tint(
                    action.isDestructive
                        ? NativeIntegrationPresentationColor.danger.color
                        : NativeIntegrationPresentationColor.healthy.color
                )
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier(
                    "awf.integration.confirm.\(action.rawValue)"
                )
            }
        }
        .padding(26)
        .accessibilityIdentifier("awf.integration.confirmation")
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            if let primary = presentation.primaryAction {
                actionButton(primary, prominent: true)
            }

            ForEach(presentation.secondaryActions, id: \.rawValue) {
                action in
                actionButton(action, prominent: false)
            }

            Spacer()

            Button(localized("integration.action.close")) {
                dismiss()
            }
            .disabled(presentation.isApplying)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
    }

    @ViewBuilder
    private func actionButton(
        _ action: NativeIntegrationAction,
        prominent: Bool
    ) -> some View {
        if prominent {
            actionControl(action)
                .buttonStyle(.borderedProminent)
        } else {
            actionControl(action)
                .buttonStyle(.bordered)
        }
    }

    private func actionControl(
        _ action: NativeIntegrationAction
    ) -> some View {
        Button(
            localized(action.titleKey),
            role: action.isDestructive ? .destructive : nil
        ) {
            request(action)
        }
        .tint(
            action.isDestructive
                ? NativeIntegrationPresentationColor.danger.color
                : NativeIntegrationPresentationColor.healthy.color
        )
        .disabled(presentation.isApplying)
        .accessibilityIdentifier(
            "awf.integration.action.\(action.rawValue)"
        )
    }

    private func request(_ action: NativeIntegrationAction) {
        guard !operation.isApplying else {
            return
        }
        if action.requiresConfirmation {
            pendingAction = action
        } else {
            refresh()
        }
    }

    private func perform(_ action: NativeIntegrationAction) {
        pendingAction = nil
        switch action {
        case .install:
            install()
        case .repair:
            repair()
        case .rollback:
            rollback()
        case .uninstall:
            uninstall()
        case .refresh:
            refresh()
        }
    }
}
