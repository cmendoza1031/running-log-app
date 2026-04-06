import { Capacitor } from "@capacitor/core";
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import { supabase } from "@/lib/supabase";

/**
 * Native iOS Sign in with Apple → Supabase `signInWithIdToken`.
 *
 * Why not `signInWithOAuth` on Capacitor? That starts a **web** OAuth flow (Safari).
 * Apple’s web flow expects a **Services ID** as `client_id`, not the app bundle ID,
 * and return URLs registered for that Services ID — hence "invalid client id or web redirect url"
 * when Supabase is configured with only `com.vistarunning.app`.
 *
 * Supabase (native): add your **bundle ID** under Apple provider → Client IDs. No custom domain needed.
 * @see https://supabase.com/docs/guides/auth/social-login/auth-apple
 */
export function canUseNativeAppleSignIn(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

function isUserCanceled(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("cancel") || m.includes("1001") || m.includes("user denied");
}

export async function signInWithNativeApple(): Promise<{ error: string | null }> {
  try {
    const apple = await SignInWithApple.authorize({
      // iOS native path ignores these; plugin API still requires strings.
      clientId: "com.vistarunning.app",
      redirectURI: "https://localhost",
      scopes: "email name",
    });

    const token = apple.response.identityToken;
    if (!token) {
      return { error: "Apple did not return an identity token." };
    }

    const { error, data } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token,
    });

    if (error) {
      return { error: error.message };
    }

    const { givenName, familyName } = apple.response;
    if (data.user && (givenName || familyName)) {
      const parts = [givenName, familyName].filter(Boolean) as string[];
      const fullName = parts.join(" ").trim();
      if (fullName) {
        await supabase.auth.updateUser({
          data: {
            full_name: fullName,
            given_name: givenName ?? undefined,
            family_name: familyName ?? undefined,
          },
        });
      }
    }

    return { error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isUserCanceled(message)) {
      return { error: null };
    }
    return { error: message };
  }
}
