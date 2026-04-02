import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vistarunning.app',
  appName: 'Vista Running',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https',
    // Dev: point to local Express server so /api calls work in the simulator
    url: 'http://localhost:3003',
    cleartext: true,
  },
  ios: {
    // 'automatic': native iOS positions the WebView below the Dynamic Island.
    // The gap above is filled by backgroundColor (ivory), giving a seamless look.
    // This is more reliable than 'never' + CSS env() which doesn't work on all iOS versions.
    contentInset: 'automatic',
    scrollEnabled: true,
    backgroundColor: '#f5f5db', // Matches --ivory: hsl(60, 56%, 91%)
    scheme: 'vistarunning',
    path: 'ios'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#f5f5db',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#4A90E2'
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#f5f5db'
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
