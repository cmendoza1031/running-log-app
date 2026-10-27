import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vistarunning.app',
  appName: 'Vista',
  /** Fallback if `ios.backgroundColor` is missing in copied JSON — avoids WKWebView `systemBackground`. */
  backgroundColor: '#000000',
  webDir: 'dist/public',
  // Release builds bundle the web app (dist/public) and call the API at VITE_API_URL.
  // For live-reload development against `npm run dev`, sync with CAP_LIVE_RELOAD=1
  // (optionally CAP_SERVER_URL=http://<your-mac-ip>:3003 for a physical device).
  server: process.env.CAP_LIVE_RELOAD
    ? { url: process.env.CAP_SERVER_URL || 'http://localhost:3003', cleartext: true, androidScheme: 'https' }
    : { androidScheme: 'https' },
  ios: {
    // 'automatic' → UIScrollView contentInsetAdjustmentBehavior.automatic. Safe area is
    // often applied natively, so env(safe-area-inset-top) in CSS may be 0; auth UI uses a
    // rem floor in client/src/lib/auth-screen-layout.ts to avoid content under the island.
    contentInset: 'automatic',
    scrollEnabled: true,
    backgroundColor: '#000000',
    scheme: 'vistarunning',
    path: 'ios'
  },
  plugins: {
    SplashScreen: {
      // Simulator + live-reload can be slow; avoids native auto-hide before JS runs when server is up.
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#000000',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#0A84FF'
    },
    StatusBar: {
      // Capacitor naming: "DARK" = light status-bar text/icons for dark app backgrounds (native .lightContent).
      // "LIGHT" would map to .darkContent and forces the system light/ivory status bar — wrong for Vista.
      style: 'DARK',
      backgroundColor: '#000000',
      overlaysWebView: true,
    },
    Haptics: {
      // Enable haptic feedback (default enabled on iOS)
    },
    App: {
      // App lifecycle configuration
    },
    Device: {
      // Device info access
    }
  }
};

export default config;
