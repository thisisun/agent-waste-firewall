import SwiftUI

struct SentinelView: View {
    @ObservedObject var model: SentinelPanelModel
    let openDashboard: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityDifferentiateWithoutColor)
    private var differentiateWithoutColor
    @State private var pulsing = false

    var body: some View {
        ZStack {
            if model.state.isCritical {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(
                        model.state.color.opacity(
                            model.state.criticalBackgroundOpacity(
                                reduceTransparency: reduceTransparency
                            )
                        )
                    )
            }

            Button(action: openDashboard) {
                ZStack {
                    Circle()
                        .stroke(model.state.color, lineWidth: 7)
                        .frame(width: 62, height: 62)

                    Image(systemName: model.state.symbolName)
                        .font(.system(size: 25, weight: .black))
                        .symbolRenderingMode(.monochrome)
                        .foregroundStyle(model.state.color)

                    Capsule()
                        .fill(model.state.color)
                        .frame(width: 37, height: 8)
                        .rotationEffect(.degrees(47))
                        .offset(x: 29, y: 29)
                }
                .frame(width: 88, height: 88)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                Text(
                    AppLocalization.string(
                        "sentinel.accessibility.label",
                        language: model.language
                    )
                )
            )
            .accessibilityValue(
                Text(
                    model.state.localizedTitle(
                        language: model.language
                    )
                )
            )
            .accessibilityHint(
                Text(
                    AppLocalization.string(
                        "sentinel.accessibility.hint",
                        language: model.language
                    )
                )
            )

            if differentiateWithoutColor && model.state != .clear {
                Image(systemName: model.state.symbolName)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(5)
                    .background(model.state.color, in: Circle())
                    .offset(x: 35, y: -35)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: 112, height: 112)
        .background(Color.clear)
        .scaleEffect(
            model.state.isCritical && pulsing && !reduceMotion ? 1.04 : 1
        )
        .onAppear {
            updateAnimation()
        }
        .onChange(of: model.state) { _ in
            updateAnimation()
        }
        .onChange(of: reduceMotion) { _ in
            updateAnimation()
        }
    }

    private func updateAnimation() {
        guard model.state.isCritical, !reduceMotion else {
            if pulsing {
                pulsing = false
            }
            return
        }
        withAnimation(
            .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
        ) {
            pulsing = true
        }
    }
}
