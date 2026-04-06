import UIKit
import Capacitor

/// Ensures WKWebView + scroll view never fall back to `UIColor.systemBackground` (light “ivory” in
/// margin/safe-area gaps). Capacitor reads `ios.backgroundColor` from config, but we reinforce here.
final class AppBridgeViewController: CAPBridgeViewController {

    private static let vistaBackground = UIColor(red: 10 / 255, green: 10 / 255, blue: 15 / 255, alpha: 1)

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        applyVistaChrome()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyVistaChrome()
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
