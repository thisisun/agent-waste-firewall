import AppKit
import SwiftUI

@main
struct AWFApp: App {
    @NSApplicationDelegateAdaptor(AWFAppDelegate.self)
    private var appDelegate
    private let model = AppModel.shared

    var body: some Scene {
        Window(
            NSLocalizedString("app.name", comment: ""),
            id: "dashboard"
        ) {
            DashboardContainerView(model: model)
        }
        .defaultSize(width: 1180, height: 760)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }

        MenuBarExtra {
            MenuBarContentView(model: model)
        } label: {
            MenuBarLabelView(model: model)
        }
        .menuBarExtraStyle(.menu)
    }
}

@MainActor
final class AWFAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        AppModel.shared.startIfNeeded()
    }

    func applicationWillTerminate(_ notification: Notification) {
        AppModel.shared.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(
        _ sender: NSApplication
    ) -> Bool {
        false
    }
}
