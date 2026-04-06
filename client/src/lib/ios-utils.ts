import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@capacitor/app';

/**
 * iOS-specific utilities for native app functionality
 * Following SOLID principles with single responsibility pattern
 */

export class IOSFeedbackManager {
  /**
   * Light haptic feedback for subtle interactions (scrolling, selection changes)
   */
  static async lightImpact(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch (error) {
      console.log('Haptic feedback unavailable:', error);
    }
  }

  /**
   * Medium haptic feedback for button presses and confirmations
   */
  static async mediumImpact(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch (error) {
      console.log('Haptic feedback unavailable:', error);
    }
  }

  /**
   * Heavy haptic feedback for important actions (save, delete)
   */
  static async heavyImpact(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } catch (error) {
      console.log('Haptic feedback unavailable:', error);
    }
  }

  /**
   * Success notification haptic for completed actions
   */
  static async successNotification(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch (error) {
      console.log('Haptic feedback unavailable:', error);
    }
  }

  /**
   * Error notification haptic for failed actions
   */
  static async errorNotification(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch (error) {
      console.log('Haptic feedback unavailable:', error);
    }
  }
}

export class IOSStatusBarManager {
  /**
   * Light status-bar glyphs (white) for dark app UI. Uses Capacitor `Style.Dark` (yes, the names are confusing).
   */
  static async setLightContent(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await StatusBar.setStyle({ style: Style.Dark });
    } catch (error) {
      console.log('Status bar control unavailable:', error);
    }
  }

  /**
   * Dark status-bar glyphs for light app UI. Uses Capacitor `Style.Light`.
   */
  static async setDarkContent(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await StatusBar.setStyle({ style: Style.Light });
    } catch (error) {
      console.log('Status bar control unavailable:', error);
    }
  }

  /**
   * Hide the status bar
   */
  static async hide(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await StatusBar.hide();
    } catch (error) {
      console.log('Status bar control unavailable:', error);
    }
  }

  /**
   * Show the status bar
   */
  static async show(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      await StatusBar.show();
    } catch (error) {
      console.log('Status bar control unavailable:', error);
    }
  }
}

export class IOSAppManager {
  /**
   * Initialize iOS app settings
   */
  static async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;

    try {
      await IOSStatusBarManager.setLightContent();
      await StatusBar.setBackgroundColor({ color: '#0a0a0f' }).catch(() => {});
      
      // Add app state change listeners
      App.addListener('appStateChange', ({ isActive }) => {
        console.log('App state changed. Is active?', isActive);
      });

    } catch (error) {
      console.log('iOS app initialization error:', error);
    }
  }

  /**
   * Handle app going to background (save state, pause timers, etc.)
   */
  static async handleBackground(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    console.log('App going to background - implement state saving logic here');
    // Implementation for background state handling
  }

  /**
   * Handle app coming to foreground (restore state, resume timers, etc.)
   */
  static async handleForeground(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    
    console.log('App coming to foreground - implement state restoration logic here');
    // Implementation for foreground state handling
  }
}

/**
 * Enhanced button interactions with iOS-native feel
 */
export class IOSButtonInteractions {
  /**
   * Add haptic feedback to button press with visual feedback
   */
  static async handleButtonPress(
    element: HTMLElement,
    callback: () => void,
    feedbackType: 'light' | 'medium' | 'heavy' = 'medium'
  ): Promise<void> {
    // Add pressed state for visual feedback
    element.style.transform = 'scale(0.95)';
    element.style.transition = 'transform 0.1s ease';
    
    // Trigger haptic feedback
    switch (feedbackType) {
      case 'light':
        await IOSFeedbackManager.lightImpact();
        break;
      case 'medium':
        await IOSFeedbackManager.mediumImpact();
        break;
      case 'heavy':
        await IOSFeedbackManager.heavyImpact();
        break;
    }
    
    // Execute callback
    callback();
    
    // Remove pressed state
    setTimeout(() => {
      element.style.transform = '';
    }, 100);
  }
}

/**
 * iOS-specific performance optimizations
 */
export class IOSPerformanceManager {
  /**
   * Optimize scrolling performance for iOS
   */
  static optimizeScrolling(element: HTMLElement): void {
    (element.style as CSSStyleDeclaration & { webkitOverflowScrolling?: string }).webkitOverflowScrolling = 'touch';
    element.style.transform = 'translate3d(0,0,0)';
  }

  /**
   * Optimize animations for iOS
   */
  static optimizeAnimations(element: HTMLElement): void {
    element.style.willChange = 'transform';
    element.style.backfaceVisibility = 'hidden';
    element.style.perspective = '1000px';
  }

  /**
   * Prevent iOS zoom on double tap
   */
  static preventZoom(): void {
    const viewport = document.querySelector('meta[name=viewport]');
    if (viewport) {
      viewport.setAttribute('content', 
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'
      );
    }
  }
}

/**
 * Check if running on iOS
 */
export const isIOS = (): boolean => {
  return Capacitor.getPlatform() === 'ios';
};

/**
 * Check if running on native platform (not web)
 */
export const isNative = (): boolean => {
  return Capacitor.isNativePlatform();
};
