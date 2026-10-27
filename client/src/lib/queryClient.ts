import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAccessToken } from "./supabase";

/**
 * API base URL. Empty in dev/web (same origin). In the bundled iOS app the web assets are
 * served from capacitor://localhost, so API calls must go to the deployed server.
 */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export async function authHeaders(json = false): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const h: Record<string, string> = { "X-Timezone": deviceTimezone() };
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body?.message ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg || `Request failed (${res.status})`);
  }
}

export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const res = await fetch(apiUrl(url), {
    method,
    headers: await authHeaders(data !== undefined),
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  await throwIfResNotOk(res);
  return res;
}

export async function apiJson<T>(method: string, url: string, data?: unknown): Promise<T> {
  return (await apiRequest(method, url, data)).json() as Promise<T>;
}

export const getQueryFn: <T>(options: { on401: "returnNull" | "throw" }) => QueryFunction<T> =
  ({ on401 }) =>
  async ({ queryKey }) => {
    const [path, params] = queryKey as [string, Record<string, string | number> | undefined];
    const qs = params && typeof params === "object" ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
    const res = await fetch(apiUrl(`${path}${qs}`), { headers: await authHeaders() });
    if (on401 === "returnNull" && res.status === 401) return null;
    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      retry: 1,
    },
    mutations: { retry: false },
  },
});
