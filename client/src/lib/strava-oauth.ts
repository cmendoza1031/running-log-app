import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import { apiRequest } from "@/lib/queryClient";

export type StravaConnectPhase = "idle" | "opening" | "browser" | "exchanging" | "success" | "error";

const OAUTH_PATH_MARKER = "strava-oauth";
const FLOW_TIMEOUT_MS = 120_000;

function parseStravaReturnUrl(url: string): { code?: string; state?: string; error?: string } {
  const q = url.includes("?") ? url.split("?")[1]!.split("#")[0]! : "";
  const sp = new URLSearchParams(q);
  return {
    code: sp.get("code") ?? undefined,
    state: sp.get("state") ?? undefined,
    error: sp.get("error") ?? undefined,
  };
}

function isStravaOAuthReturn(url: string): boolean {
  if (url.includes(OAUTH_PATH_MARKER)) return true;
  return url.startsWith("vistarunning:") && url.includes("code=");
}

/**
 * Web: full redirect (returns on your site with ?strava=connected).
 * Native: in-app browser + deep link + POST /api/strava/exchange.
 */
export async function connectStravaFlow(options: {
  onPhase: (p: StravaConnectPhase) => void;
  onFinally?: () => void;
}): Promise<void> {
  const { onPhase, onFinally } = options;

  const finish = () => {
    onFinally?.();
  };

  if (!Capacitor.isNativePlatform()) {
    onPhase("opening");
    try {
      const res = await apiRequest("GET", "/api/strava/auth", undefined);
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch {
      onPhase("error");
      finish();
    }
    return;
  }

  let urlListener: PluginListenerHandle | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const cleanup = async () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (settled) return;
    settled = true;
    await urlListener?.remove();
    finish();
  };

  const fail = async () => {
    onPhase("error");
    await cleanup();
  };

  try {
    onPhase("opening");
    const authRes = await apiRequest("GET", "/api/strava/auth?mode=app", undefined);
    const { url } = (await authRes.json()) as { url: string };

    urlListener = await App.addListener("appUrlOpen", async ({ url: incoming }) => {
      if (!incoming || !isStravaOAuthReturn(incoming)) return;
      const { code, state, error } = parseStravaReturnUrl(incoming);
      if (error) {
        onPhase("error");
        await cleanup();
        return;
      }
      if (!code || !state) {
        await fail();
        return;
      }
      onPhase("exchanging");
      try {
        await apiRequest("POST", "/api/strava/exchange", { code, state });
        onPhase("success");
      } catch {
        onPhase("error");
      }
      await cleanup();
    });

    timeoutId = setTimeout(() => {
      void (async () => {
        onPhase("idle");
        await cleanup();
      })();
    }, FLOW_TIMEOUT_MS);

    onPhase("browser");
    // window.open triggers Capacitor's createWebViewWith delegate → UIApplication.shared.open → external Safari
    window.open(url, "_blank");
  } catch {
    onPhase("error");
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    await urlListener?.remove();
    settled = true;
    finish();
  }
}

export const GARMIN_STRAVA_SETUP_URL =
  "https://support.strava.com/hc/en-us/articles/115000919304-How-do-I-connect-my-Garmin-device-to-Strava-";

/** Garmin activities usually reach Vista through Strava after linking in Garmin Connect. */
export async function openGarminStravaSetup(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    window.location.href = "garminconnect://";
    return;
  }
  window.open(GARMIN_STRAVA_SETUP_URL, "_blank", "noopener,noreferrer");
}

export async function openGarminStravaHelpArticle(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: GARMIN_STRAVA_SETUP_URL, presentationStyle: "fullscreen" });
    return;
  }
  window.open(GARMIN_STRAVA_SETUP_URL, "_blank", "noopener,noreferrer");
}
