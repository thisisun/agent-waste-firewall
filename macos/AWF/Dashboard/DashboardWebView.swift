import AppKit
import SwiftUI
import WebKit

struct DashboardWebView: NSViewRepresentable {
    let endpoint: DashboardEndpoint
    @Binding var language: AppLanguage

    func makeCoordinator() -> Coordinator {
        let languageBinding = $language
        return Coordinator(
            endpoint: endpoint,
            language: language
        ) { language in
            languageBinding.wrappedValue = language
        }
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(
            context.coordinator,
            name: Coordinator.languageHandlerName
        )
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
        context.coordinator.update(
            endpoint: endpoint,
            language: language
        ) { language in
            self.language = language
        }
        if webView.url != expectedURL {
            if webView.isLoading {
                webView.stopLoading()
            }
            webView.load(
                URLRequest(
                    url: expectedURL,
                    cachePolicy: .reloadIgnoringLocalAndRemoteCacheData
                )
            )
        } else {
            context.coordinator.synchronizeLanguage(in: webView)
        }
    }

    static func dismantleNSView(
        _ webView: WKWebView,
        coordinator: Coordinator
    ) {
        webView.stopLoading()
        webView.configuration.userContentController
            .removeScriptMessageHandler(
                forName: Coordinator.languageHandlerName
            )
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator:
        NSObject,
        WKNavigationDelegate,
        WKUIDelegate,
        WKScriptMessageHandler
    {
        static let languageHandlerName = "awfLanguage"

        private var policy: DashboardNavigationPolicy
        private var language: AppLanguage
        private var documentReady = false
        private var lastAppliedLanguage: AppLanguage?
        private var languageChanged: (AppLanguage) -> Void

        init(
            endpoint: DashboardEndpoint,
            language: AppLanguage,
            languageChanged: @escaping (AppLanguage) -> Void
        ) {
            policy = DashboardNavigationPolicy(
                dashboardURL: endpoint.dashboardURL
            )
            self.language = language
            self.languageChanged = languageChanged
        }

        func update(
            endpoint: DashboardEndpoint,
            language: AppLanguage,
            languageChanged: @escaping (AppLanguage) -> Void
        ) {
            policy = DashboardNavigationPolicy(
                dashboardURL: endpoint.dashboardURL
            )
            self.language = language
            self.languageChanged = languageChanged
        }

        func synchronizeLanguage(in webView: WKWebView) {
            guard
                documentReady,
                !webView.isLoading,
                lastAppliedLanguage != language
            else {
                return
            }
            lastAppliedLanguage = language
            webView.evaluateJavaScript(
                "window.__awfSetLanguage?.('\(language.rawValue)');"
            )
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.name == Self.languageHandlerName,
                message.frameInfo.isMainFrame,
                message.frameInfo.request.url?.absoluteString
                    != "about:blank",
                policy.allows(message.frameInfo.request.url),
                let bridgeMessage = try? AppLanguageBridgeMessage(
                    body: message.body
                )
            else {
                return
            }
            if language != bridgeMessage.language {
                language = bridgeMessage.language
                lastAppliedLanguage = bridgeMessage.language
                languageChanged(bridgeMessage.language)
            }
        }

        func webView(
            _ webView: WKWebView,
            didStartProvisionalNavigation navigation: WKNavigation!
        ) {
            documentReady = false
            lastAppliedLanguage = nil
        }

        func webView(
            _ webView: WKWebView,
            didFinish navigation: WKNavigation!
        ) {
            documentReady = true
            synchronizeLanguage(in: webView)
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
