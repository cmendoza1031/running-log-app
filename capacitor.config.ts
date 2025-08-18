import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vistarunning.app',
  appName: 'Vista Running',
  webDir: 'dist/public',
  server: {
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
    backgroundColor: '#f8f9fa', // Ivory background color
    // App Store ready iOS configuration
    scheme: 'vistarunning',
    path: 'ios'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#f8f9fa',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#4A90E2'
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#f8f9fa'
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
