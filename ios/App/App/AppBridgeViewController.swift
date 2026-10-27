import UIKit
import Capacitor

/// Ensures WKWebView + scroll view never fall back to `UIColor.systemBackground` (light “ivory” in
/// margin/safe-area gaps). Capacitor reads `ios.backgroundColor` from config, but we reinforce here.
final class AppBridgeViewController: CAPBridgeViewController {

    private static let vistaBackground = UIColor.black

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        // Allow window.open() after awaits (OAuth flow calls it post-fetch, losing the user-gesture token).
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        return config
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        applyVistaChrome()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyVistaChrome()
        // If StatusBar’s resizeWebView no-op’d (nil keyWindow), WKWebView can stay 0×0 until next layout.
        DispatchQueue.main.async { [weak self] in
            self?.repairWebViewFrameIfCollapsed()
        }
    }

    private func repairWebViewFrameIfCollapsed() {
        guard let wv = webView else { return }
        let target = view.window?.bounds ?? view.bounds
        guard target.width > 1, target.height > 1 else { return }
        if wv.frame.width < 1 || wv.frame.height < 1 {
            wv.frame = target
            applyVistaChrome()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        .lightContent
    }

    private func applyVistaChrome() {
        let c = Self.vistaBackground
        view.backgroundColor = c
        webView?.isOpaque = true
        webView?.backgroundColor = c
        webView?.scrollView.backgroundColor = c
        if #available(iOS 15.0, *) {
            webView?.underPageBackgroundColor = c
        }
    }
}
