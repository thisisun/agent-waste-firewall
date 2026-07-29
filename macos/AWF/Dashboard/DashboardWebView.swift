import AppKit
import SwiftUI
import WebKit

struct DashboardWebView: NSViewRepresentable {
    let endpoint: DashboardEndpoint

    func makeCoordinator() -> Coordinator {
        Coordinator(endpoint: endpoint)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = true
        webView.underPageBackgroundColor = .clear
        webView.load(
            URLRequest(
                url: endpoint.dashboardURL,
                cachePolicy: .reloadIgnoringLocalAndRemoteCacheData
            )
        )
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let expectedURL = endpoint.dashboardURL
        context.coordinator.update(endpoint: endpoint)
        if webView.url != expectedURL && !webView.isLoading {
            webView.load(
                URLRequest(
                    url: expectedURL,
                    cachePolicy: .reloadIgnoringLocalAndRemoteCacheData
                )
            )
        }
    }

    static func dismantleNSView(
        _ webView: WKWebView,
        coordinator: Coordinator
    ) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private var policy: DashboardNavigationPolicy

        init(endpoint: DashboardEndpoint) {
            policy = DashboardNavigationPolicy(
                dashboardURL: endpoint.dashboardURL
            )
        }

        func update(endpoint: DashboardEndpoint) {
            policy = DashboardNavigationPolicy(
                dashboardURL: endpoint.dashboardURL
            )
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (
                WKNavigationActionPolicy
            ) -> Void
        ) {
            guard
                !navigationAction.shouldPerformDownload,
                policy.allows(navigationAction.request.url)
            else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping @MainActor @Sendable (
                WKNavigationResponsePolicy
            ) -> Void
        ) {
            guard
                navigationResponse.canShowMIMEType,
                policy.allows(navigationResponse.response.url)
            else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            nil
        }
    }
}
