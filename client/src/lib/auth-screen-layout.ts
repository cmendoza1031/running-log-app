/**
 * Auth (sign-in) screen layout tokens for Capacitor / WKWebView.
 *
 * With `ios.contentInset: 'automatic'`, the native scroll view often already insets the
 * page below the Dynamic Island while `env(safe-area-inset-top)` in CSS is still `0px`.
 * A large rem floor (e.g. max(8rem, …)) then **stacks** on that inset and shoves the
 * whole form downward with a big empty band above the logo.
 *
 * Use a **small** floor for the env=0 case plus `env()` when the engine reports it.
 * If the logo ever clips the island on a device where both are wrong, nudge the floor slightly.
 *
 * Do not use huge `padding-bottom` (e.g. 40vh) — WKWebView scrolls focused inputs; extra vh
 * only adds empty scroll when the keyboard is closed.
 */

/**
 * Top padding: small minimum when env is 0 (native inset already applied), else env + gap.
 */
export const AUTH_SCROLL_CONTAINER_PADDING_TOP =
  "max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.875rem))" as const;

/** Bottom: home indicator + comfortable margin above it. */
export const AUTH_SCROLL_CONTAINER_PADDING_BOTTOM =
  "max(2rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))" as const;

/**
 * Onboarding top padding. With `ios.contentInset: 'automatic'`, native already clears the
 * Dynamic Island, so a large CSS floor stacks and wastes space. Keep a modest gap below the
 * status area; nudge `1.25rem` if the step label ever clips on a device.
 */
export const SCREEN_EDGE_PADDING_TOP =
  "max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))" as const;

export const SCREEN_EDGE_PADDING_BOTTOM = AUTH_SCROLL_CONTAINER_PADDING_BOTTOM;
