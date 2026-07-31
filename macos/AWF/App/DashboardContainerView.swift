import SwiftUI

struct DashboardContainerView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ZStack(alignment: .top) {
            if let endpoint = model.endpoint {
                DashboardWebView(
                    endpoint: endpoint,
                    language: $model.language
                )
                    .frame(minWidth: 720, minHeight: 520)
            } else {
                launchPlaceholder
            }

            if model.transport == .offline, model.endpoint != nil {
                offlineBanner
                    .padding(.top, 12)
            }
        }
        .frame(minWidth: 720, minHeight: 520)
        .toolbar {
            ToolbarItemGroup {
                statusLabel
                integrationStatusButton
                Button {
                    model.toggleSentinel()
                } label: {
                    Label(
                        model.isSentinelVisible
                            ? model.localized("action.hideSentinel")
                            : model.localized("action.showSentinel"),
                        systemImage: "magnifyingglass"
                    )
                }
                Button {
                    model.retry()
                } label: {
                    Label(
                        model.localized("action.retry"),
                        systemImage: "arrow.clockwise"
                    )
                }
            }
        }
        .onAppear {
            registerWindowAction()
        }
        .sheet(
            isPresented: $model.isIntegrationManagerPresented
        ) {
            IntegrationManagerView(
                snapshot: model.nativeIntegrationSnapshot,
                payloadStatus: model.nativeIntegrationPayloadStatus,
                operation: model.nativeIntegrationOperation,
                result: model.nativeIntegrationResult,
                localized: model.localized,
                install: model.installNativeIntegration,
                repair: model.repairNativeIntegration,
                rollback: model.rollbackNativeIntegration,
                uninstall: model.uninstallNativeIntegration,
                refresh: {
                    model.refreshNativeIntegration(clearResult: true)
                }
            )
        }
    }

    private var launchPlaceholder: some View {
        VStack(spacing: 18) {
            Image(systemName: "magnifyingglass.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(model.visualState.color)
            Text(model.localized("launch.title"))
                .font(.title2.bold())
            Text(
                model.failure?.localizedTitle(language: model.language)
                    ?? model.localized("launch.starting")
            )
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 460)
            Button(model.localized("action.retry")) {
                model.retry()
            }
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("awf.retry")
        }
        .padding(48)
        .accessibilityElement(children: .combine)
    }

    private var offlineBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(
                model.failure?.localizedTitle(language: model.language)
                    ?? model.localized("failure.statusUnavailable")
            )
            Button(model.localized("action.retry")) {
                model.retry()
            }
            .buttonStyle(.borderless)
        }
        .font(.callout.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Color.red.opacity(0.94), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var statusLabel: some View {
        Label(
            model.visualState.localizedTitle(language: model.language),
            systemImage: model.visualState.symbolName
        )
        .foregroundStyle(model.visualState.color)
        .accessibilityLabel(
            Text(model.localized("sentinel.accessibility.label"))
        )
        .accessibilityValue(
            Text(
                model.visualState.localizedTitle(
                    language: model.language
                )
            )
        )
    }

    private var integrationStatusButton: some View {
        let presentation = NativeIntegrationPresentation.project(
            snapshot: model.nativeIntegrationSnapshot,
            payloadStatus: model.nativeIntegrationPayloadStatus,
            operation: model.nativeIntegrationOperation,
            result: model.nativeIntegrationResult
        )
        return Button {
            model.requestOpenIntegrationManager()
        } label: {
            Label(
                model.localized(presentation.titleKey),
                systemImage: presentation.symbolName
            )
        }
        .foregroundStyle(presentation.colorRole.color)
        .help(model.localized("integration.action.manage"))
        .accessibilityIdentifier("awf.integration.open")
    }

    private func registerWindowAction() {
        model.registerOpenDashboard {
            openWindow(id: "dashboard")
        }
    }
}
