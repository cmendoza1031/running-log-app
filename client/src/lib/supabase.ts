import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Module-level token cache — updated by AuthProvider via onAuthStateChange.
// Avoids calling getSession() (which acquires a navigator.locks mutex) on every
// API request, which causes lock contention in WKWebView when many queries fire
// simultaneously on mount.
let _cachedToken: string | null = null;
let _authResolved = false;

export function updateCachedToken(token: string | null) {
  _cachedToken = token;
  _authResolved = true;
}

/**
 * Get the current session's access token for API requests.
 * Uses the cached token after auth is resolved to avoid lock contention.
 */
export async function getAccessToken(): Promise<string | null> {
  if (_authResolved) return _cachedToken;
  // First load: auth state hasn't been read yet — do a single getSession() call.
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
