import AppKit
import SwiftUI

struct MenuBarLabelView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Image(systemName: model.visualState.symbolName)
            .symbolRenderingMode(.monochrome)
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
}

struct MenuBarContentView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Text(
            model.visualState.localizedTitle(
                language: model.language
            )
        )
        Text(model.currentModeTitle)
            .foregroundStyle(.secondary)

        if let ruleTitle = model.currentRuleTitle {
            Text(ruleTitle)
        }

        Divider()

        Button(model.localized("action.openDashboard")) {
            openDashboard()
        }
        .keyboardShortcut("o")

        Button(model.localized("integration.action.manage")) {
            model.requestOpenIntegrationManager()
        }

        Button(
            model.isSentinelVisible
                ? model.localized("action.hideSentinel")
                : model.localized("action.showSentinel")
        ) {
            model.toggleSentinel()
        }

        Button(model.localized("action.retry")) {
            model.retry()
        }

        Divider()

        Button(model.localized("action.quit")) {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
        .onAppear {
            registerWindowAction()
        }
    }

    private func openDashboard() {
        NSApp.activate(ignoringOtherApps: true)
        openWindow(id: "dashboard")
    }

    private func registerWindowAction() {
        model.registerOpenDashboard {
            openDashboard()
        }
    }
}
