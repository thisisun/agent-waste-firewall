import SwiftUI

struct DashboardContainerView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ZStack(alignment: .top) {
            if let endpoint = model.endpoint {
                DashboardWebView(endpoint: endpoint)
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
                Button {
                    model.toggleSentinel()
                } label: {
                    Label(
                        model.isSentinelVisible
                            ? NSLocalizedString(
                                "action.hideSentinel",
                                comment: ""
                            )
                            : NSLocalizedString(
                                "action.showSentinel",
                                comment: ""
                            ),
                        systemImage: "magnifyingglass"
                    )
                }
                Button {
                    model.retry()
                } label: {
                    Label(
                        NSLocalizedString("action.retry", comment: ""),
                        systemImage: "arrow.clockwise"
                    )
                }
            }
        }
        .onAppear {
            registerWindowAction()
        }
    }

    private var launchPlaceholder: some View {
        VStack(spacing: 18) {
            Image(systemName: "magnifyingglass.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(model.visualState.color)
            Text(NSLocalizedString("launch.title", comment: ""))
                .font(.title2.bold())
            Text(
                model.failure?.localizedTitle
                    ?? NSLocalizedString("launch.starting", comment: "")
            )
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 460)
            Button(NSLocalizedString("action.retry", comment: "")) {
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
                model.failure?.localizedTitle
                    ?? NSLocalizedString(
                        "failure.statusUnavailable",
                        comment: ""
                    )
            )
            Button(NSLocalizedString("action.retry", comment: "")) {
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
            model.visualState.localizedTitle,
            systemImage: model.visualState.symbolName
        )
        .foregroundStyle(model.visualState.color)
        .accessibilityLabel(
            Text(NSLocalizedString("sentinel.accessibility.label", comment: ""))
        )
        .accessibilityValue(Text(model.visualState.localizedTitle))
    }

    private func registerWindowAction() {
        model.registerOpenDashboard {
            openWindow(id: "dashboard")
        }
    }
}
