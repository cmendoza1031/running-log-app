import UIKit
import Capacitor

/// Scene-based lifecycle so `UIWindowScene.keyWindow` exists. The Capacitor Status Bar plugin's
/// `resizeWebView()` bails out when `keyWindow` is nil and can leave `WKWebView` at 0×0 → black screen.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController()
        window.makeKeyAndVisible()
        self.window = window

        let vistaBg = UIColor.black
        window.backgroundColor = vistaBg
        window.overrideUserInterfaceStyle = .dark

        // Forward any URL that launched the app cold (e.g. OAuth deep link from background).
        for context in connectionOptions.urlContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    /// Required for deep links when the app is already running (e.g. Strava OAuth callback).
    /// Without this, `vistarunning://strava-oauth?code=...` is silently dropped and
    /// Capacitor's `appUrlOpen` event never fires.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }
}
