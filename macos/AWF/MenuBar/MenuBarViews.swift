import AppKit
import SwiftUI

struct MenuBarLabelView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Image(systemName: model.visualState.symbolName)
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(model.visualState.color)
            .accessibilityLabel(
                Text(NSLocalizedString("sentinel.accessibility.label", comment: ""))
            )
            .accessibilityValue(Text(model.visualState.localizedTitle))
    }
}

struct MenuBarContentView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Text(model.visualState.localizedTitle)
        Text(model.currentModeTitle)
            .foregroundStyle(.secondary)

        if let ruleTitle = model.currentRuleTitle {
            Text(ruleTitle)
        }

        Divider()

        Button(NSLocalizedString("action.openDashboard", comment: "")) {
            openDashboard()
        }
        .keyboardShortcut("o")

        Button(
            model.isSentinelVisible
                ? NSLocalizedString("action.hideSentinel", comment: "")
                : NSLocalizedString("action.showSentinel", comment: "")
        ) {
            model.toggleSentinel()
        }

        Button(NSLocalizedString("action.retry", comment: "")) {
            model.retry()
        }

        Divider()

        Button(NSLocalizedString("action.quit", comment: "")) {
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
