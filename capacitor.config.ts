import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vistarunning.app',
  appName: 'Vista Running',
  /** Fallback if `ios.backgroundColor` is missing in copied JSON — avoids WKWebView `systemBackground`. */
  backgroundColor: '#0a0a0f',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    // Dev: point to local Express server so /api calls work in the simulator
    url: 'http://localhost:3003',
    cleartext: true,
  },
  ios: {
    // 'automatic' → UIScrollView contentInsetAdjustmentBehavior.automatic. Safe area is
    // often applied natively, so env(safe-area-inset-top) in CSS may be 0; auth UI uses a
    // rem floor in client/src/lib/auth-screen-layout.ts to avoid content under the island.
    contentInset: 'automatic',
    scrollEnabled: true,
    backgroundColor: '#0a0a0f',
    scheme: 'vistarunning',
    path: 'ios'
  },
  plugins: {
    SplashScreen: {
      // Simulator + live-reload can be slow; avoids native auto-hide before JS runs when server is up.
      launchShowDuration: 6000,
      launchAutoHide: true,
      backgroundColor: '#0a0a0f',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#4A90E2'
    },
    StatusBar: {
      // Capacitor naming: "DARK" = light status-bar text/icons for dark app backgrounds (native .lightContent).
      // "LIGHT" would map to .darkContent and forces the system light/ivory status bar — wrong for Vista.
      style: 'DARK',
      backgroundColor: '#0a0a0f',
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
