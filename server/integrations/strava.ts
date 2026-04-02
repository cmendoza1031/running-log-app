import { storage } from "../storage";
import type { Run } from "@shared/schema";

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: { id: number; firstname: string; lastname: string };
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number;
  total_elevation_gain: number; // meters
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number; // m/s
  description?: string;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export function buildStravaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: STRAVA_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${process.env.APP_URL || "http://localhost:5000"}/api/strava/callback`,
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Strava token exchange failed: ${await res.text()}`);
  return res.json() as Promise<StravaTokenResponse>;
}

export async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${await res.text()}`);
  return res.json() as Promise<StravaTokenResponse>;
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function getValidAccessToken(userId: string): Promise<string | null> {
  const integration = await storage.getIntegration(userId, "strava");
  if (!integration?.accessToken) return null;

  const now = new Date();
  const expiresAt = integration.tokenExpiresAt ? new Date(integration.tokenExpiresAt) : null;

  if (expiresAt && now >= expiresAt && integration.refreshToken) {
    try {
      const refreshed = await refreshStravaToken(integration.refreshToken);
      await storage.upsertIntegration(userId, "strava", {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        tokenExpiresAt: new Date(refreshed.expires_at * 1000),
      });
      return refreshed.access_token;
    } catch {
      return null;
    }
  }

  return integration.accessToken;
}

export async function fetchStravaActivities(
  userId: string,
  after?: number // Unix timestamp
): Promise<StravaActivity[]> {
  const token = await getValidAccessToken(userId);
  if (!token) throw new Error("No valid Strava token");

  const params = new URLSearchParams({
    per_page: "50",
    ...(after ? { after: String(after) } : {}),
  });

  const res = await fetch(`${STRAVA_API_BASE}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`Strava API error: ${res.status}`);
  return res.json() as Promise<StravaActivity[]>;
}

// ─── Sync Logic ───────────────────────────────────────────────────────────────

function metersToMiles(m: number): number {
  return m / 1609.344;
}

function metersPerSecondToPace(mps: number): { paceMinutes: number; paceSeconds: number } {
  if (mps <= 0) return { paceMinutes: 0, paceSeconds: 0 };
  const secondsPerMile = 1609.344 / mps;
  const paceMinutes = Math.floor(secondsPerMile / 60);
  const paceSeconds = Math.round(secondsPerMile % 60);
  return { paceMinutes, paceSeconds };
}

function mapStravaTypeToRunType(sportType: string): string {
  const map: Record<string, string> = {
    Run: "easy",
    TrailRun: "trail",
    Race: "race",
    VirtualRun: "easy",
  };
  return map[sportType] || "easy";
}

export async function syncStravaActivities(userId: string): Promise<{ synced: number; skipped: number }> {
  const integration = await storage.getIntegration(userId, "strava");
  const afterTs = integration?.lastSyncedAt
    ? Math.floor(new Date(integration.lastSyncedAt).getTime() / 1000) - 86400 // 1 day overlap
    : Math.floor(Date.now() / 1000) - 90 * 86400; // Default: last 90 days

  const activities = await fetchStravaActivities(userId, afterTs);
  const runActivities = activities.filter((a) =>
    ["Run", "TrailRun", "VirtualRun"].includes(a.sport_type || a.type)
  );

  let synced = 0;
  let skipped = 0;

  for (const activity of runActivities) {
    // Check if already synced
    const existing = await storage.getRunsByUserIdAndDateRange(
      userId,
      activity.start_date.split("T")[0],
      activity.start_date.split("T")[0]
    );
    const alreadyImported = existing.some((r: Run) => r.externalId === String(activity.id));

    if (alreadyImported) {
      skipped++;
      continue;
    }

    const distance = metersToMiles(activity.distance);
    const totalSeconds = activity.moving_time;
    const timeHours = Math.floor(totalSeconds / 3600);
    const timeMinutes = Math.floor((totalSeconds % 3600) / 60);
    const { paceMinutes, paceSeconds } = metersPerSecondToPace(activity.average_speed);

    await storage.createRun(
      {
        date: activity.start_date.split("T")[0],
        sportType: "running",
        distanceUnit: "mi",
        distance: String(distance.toFixed(2)),
        timeHours,
        timeMinutes,
        paceMinutes,
        paceSeconds,
        runType: mapStravaTypeToRunType(activity.sport_type || activity.type),
        title: activity.name,
        notes: activity.description || null,
        elevationGain: activity.total_elevation_gain
          ? Math.round(activity.total_elevation_gain * 3.28084) // m to feet
          : undefined,
        heartRateAvg: activity.average_heartrate ? Math.round(activity.average_heartrate) : undefined,
        heartRateMax: activity.max_heartrate ? Math.round(activity.max_heartrate) : undefined,
        externalId: String(activity.id),
        externalSource: "strava",
      },
      userId
    );
    synced++;
  }

  // Update last synced timestamp
  await storage.upsertIntegration(userId, "strava", { lastSyncedAt: new Date() });

  return { synced, skipped };
}
