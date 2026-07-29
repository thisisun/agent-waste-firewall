import AppKit
import SwiftUI

private final class SentinelPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class SentinelPanelController {
    private let panel: SentinelPanel
    private let model = SentinelPanelModel()

    init(openDashboard: @escaping () -> Void) {
        panel = SentinelPanel(
            contentRect: NSRect(x: 0, y: 0, width: 112, height: 112),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.collectionBehavior = [
            .canJoinAllApplications,
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
        ]
        panel.animationBehavior = .none
        panel.isMovableByWindowBackground = true
        panel.contentView = NSHostingView(
            rootView: SentinelView(
                model: model,
                openDashboard: openDashboard
            )
        )
        if !panel.setFrameUsingName("AWFSentinelPanel") {
            positionAtTopRight()
        }
        panel.setFrameAutosaveName("AWFSentinelPanel")
    }

    func update(_ state: SentinelVisualState) {
        model.update(state)
    }

    func setVisible(_ visible: Bool) {
        if visible {
            panel.orderFrontRegardless()
        } else {
            panel.orderOut(nil)
        }
    }

    func close() {
        panel.orderOut(nil)
        panel.close()
    }

    private func positionAtTopRight() {
        guard let screen = NSScreen.main else {
            panel.center()
            return
        }
        let visible = screen.visibleFrame
        panel.setFrameOrigin(
            NSPoint(
                x: visible.maxX - panel.frame.width - 24,
                y: visible.maxY - panel.frame.height - 24
            )
        )
    }
}
