/**
 * Strava integration: OAuth, activity import, detail/streams enrichment, and webhooks.
 *
 * Garmin, COROS, Wahoo, Apple Watch, Zwift… all push to Strava, so one integration covers
 * every device. New activities arrive via Strava's push webhook (seconds after the watch
 * syncs); a background poller is the safety net.
 */
import crypto from "crypto";
import { storage } from "../storage";
import type { Run } from "@shared/schema";
import { toSport, type Sport, METERS_PER_MILE } from "@shared/physiology";
import { computeLoad } from "@shared/training-load";
import {
  insertActivity,
  getActivityByExternal,
  patchActivity,
  deleteActivity,
  getActivitiesNeedingDetail,
  getThresholds,
  type RunInsert,
} from "../data";
import { computeStreamMetrics, type Streams } from "../analytics/streams";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const clientId = () => process.env.STRAVA_CLIENT_ID ?? "";
const clientSecret = () => process.env.STRAVA_CLIENT_SECRET ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname: string; lastname: string; profile?: string };
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  timezone?: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  average_speed: number;
  max_speed?: number;
  average_cadence?: number;
  average_watts?: number;
  max_watts?: number;
  device_watts?: boolean;
  weighted_average_watts?: number;
  kilojoules?: number;
  trainer?: boolean;
  description?: string;
  calories?: number;
  device_name?: string;
  workout_type?: number | null; // run: 1=race, 2=long, 3=workout; ride: 11=race, 12=workout
  laps?: StravaLap[];
  best_efforts?: { name: string; distance: number; moving_time: number; elapsed_time: number }[];
}

interface StravaLap {
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_speed?: number;
  average_heartrate?: number;
  average_watts?: number;
  average_cadence?: number;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/** Latest usage reported by Strava headers: [15-min, daily] (read limits). */
const rate = { usage15: 0, limit15: 100, usageDay: 0, limitDay: 1000, updatedAt: 0 };

function recordRateHeaders(res: Response) {
  const usage = res.headers.get("x-readratelimit-usage") ?? res.headers.get("x-ratelimit-usage");
  const limit = res.headers.get("x-readratelimit-limit") ?? res.headers.get("x-ratelimit-limit");
  if (usage) {
    const [a, b] = usage.split(",").map(Number);
    rate.usage15 = a;
    rate.usageDay = b;
  }
  if (limit) {
    const [a, b] = limit.split(",").map(Number);
    rate.limit15 = a;
    rate.limitDay = b;
  }
  rate.updatedAt = Date.now();
}

/** Keep headroom for interactive syncs; background enrichment stops earlier. */
export function stravaBudgetAvailable(reserve = 20): boolean {
  if (Date.now() - rate.updatedAt > 15 * 60 * 1000) return true;
  return rate.usage15 < rate.limit15 - reserve && rate.usageDay < rate.limitDay - reserve * 3;
}

export class StravaAuthError extends Error {}

async function stravaGet<T>(userId: string, path: string): Promise<T> {
  const token = await getValidAccessToken(userId);
  if (!token) throw new StravaAuthError("Strava is not connected");
  const res = await fetch(`${STRAVA_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  recordRateHeaders(res);
  if (res.status === 401) {
    throw new StravaAuthError("Strava authorization expired — reconnect Strava");
  }
  if (res.status === 429) throw new Error("Strava rate limit reached — try again in a few minutes");
  if (!res.ok) throw new Error(`Strava API error ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── OAuth ────────────────────────────────────────────────────────────────────

export type StravaOAuthMode = "web" | "app";

/**
 * Strava allows a single Authorization Callback Domain, so both flows return to this server:
 * web → /api/strava/callback; iOS → /api/strava/app-callback, which bounces into the app via
 * the vistarunning:// deep link (the app then calls /api/strava/exchange).
 */
export function stravaRedirectUri(mode: StravaOAuthMode): string {
  const base = (process.env.APP_URL || "http://localhost:3003").replace(/\/$/, "");
  if (mode === "app") return process.env.STRAVA_REDIRECT_URI_APP || `${base}/api/strava/app-callback`;
  return `${base}/api/strava/callback`;
}

/** Signed OAuth state so the callback can't be forged to attach someone else's Strava. */
function stateSecret(): string {
  return process.env.STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || clientSecret() || "vista-dev-secret";
}

export function createStravaOAuthState(userId: string, mode: StravaOAuthMode): string {
  const payload = Buffer.from(JSON.stringify({ userId, mode, nonce: crypto.randomBytes(8).toString("hex"), iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function parseStravaOAuthState(state: string): { userId: string; mode: StravaOAuthMode } {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) throw new Error("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid OAuth state signature");
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { userId: string; mode?: StravaOAuthMode; iat?: number };
  if (data.iat && Date.now() - data.iat > 30 * 60 * 1000) throw new Error("OAuth state expired");
  return { userId: data.userId, mode: data.mode === "app" ? "app" : "web" };
}

export function buildStravaAuthUrl(state: string, mode: StravaOAuthMode = "web"): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    redirect_uri: stravaRedirectUri(mode),
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<StravaTokenResponse> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId(), client_secret: clientSecret(), ...body }),
  });
  if (!res.ok) throw new Error(`Strava token request failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<StravaTokenResponse>;
}

export async function finishStravaOAuth(userId: string, code: string): Promise<void> {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code" });
  await storage.upsertIntegration(userId, "strava", {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(tokens.expires_at * 1000),
    athleteId: tokens.athlete ? String(tokens.athlete.id) : null,
    isActive: true,
    lastSyncedAt: null,
    metadata: { athlete: tokens.athlete ?? null } as Record<string, unknown>,
  });
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const integration = await storage.getIntegration(userId, "strava");
  if (!integration?.isActive || !integration.accessToken) return null;
  const expiresAt = integration.tokenExpiresAt ? new Date(integration.tokenExpiresAt).getTime() : 0;
  if (Date.now() < expiresAt - 5 * 60 * 1000) return integration.accessToken;
  if (!integration.refreshToken) return null;
  try {
    const refreshed = await tokenRequest({ refresh_token: integration.refreshToken, grant_type: "refresh_token" });
    await storage.upsertIntegration(userId, "strava", {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      tokenExpiresAt: new Date(refreshed.expires_at * 1000),
    });
    return refreshed.access_token;
  } catch (err) {
    console.error("[strava] token refresh failed", err);
    return null;
  }
}

export async function deauthorizeStrava(userId: string): Promise<void> {
  const token = await getValidAccessToken(userId).catch(() => null);
  if (token) {
    await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  await storage.upsertIntegration(userId, "strava", { isActive: false, accessToken: null, refreshToken: null });
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

const CYCLING = new Set(["Ride", "VirtualRide", "EBikeRide", "GravelRide", "MountainBikeRide", "EMountainBikeRide", "Handcycle", "Velomobile"]);
const SWIM = new Set(["Swim", "OpenWaterSwim"]);
const RUN = new Set(["Run", "TrailRun", "VirtualRun"]);

export function stravaSportType(t: string): "running" | "cycling" | "swimming" | null {
  if (CYCLING.has(t)) return "cycling";
  if (SWIM.has(t)) return "swimming";
  if (RUN.has(t)) return "running";
  return null;
}

function workoutTypeFor(a: StravaActivity, sport: Sport): string {
  const t = a.sport_type ?? a.type;
  if (sport === "run") {
    if (a.workout_type === 1) return "race";
    if (a.workout_type === 2) return "long";
    if (a.workout_type === 3) return "interval";
    if (t === "TrailRun") return "trail";
    return a.moving_time >= 5400 ? "long" : "easy";
  }
  if (sport === "bike") {
    if (a.workout_type === 11) return "race_ride";
    if (a.workout_type === 12) return "interval_ride";
    return a.moving_time >= 3 * 3600 ? "long_ride" : "easy_ride";
  }
  if (t === "OpenWaterSwim") return "open_water_swim";
  return "easy_swim";
}

function compactLaps(laps: StravaLap[] | undefined) {
  if (!laps?.length || laps.length > 200) return null;
  return laps.map((l) => ({
    name: l.name,
    distanceM: Math.round(l.distance),
    movingSec: l.moving_time,
    avgSpeed: l.average_speed ?? null,
    avgHr: l.average_heartrate ? Math.round(l.average_heartrate) : null,
    avgPower: l.average_watts ? Math.round(l.average_watts) : null,
    avgCadence: l.average_cadence ?? null,
  }));
}

/** Map a Strava summary/detail activity into canonical + legacy columns. */
export function mapStravaActivity(a: StravaActivity, userId: string): RunInsert | null {
  const t = a.sport_type ?? a.type;
  const sportType = stravaSportType(t);
  if (!sportType) return null;
  const sport = toSport(sportType)!;
  const secs = a.moving_time || a.elapsed_time;
  const legacyDistance =
    sport === "swim" ? Math.round(a.distance) : Math.round((a.distance / METERS_PER_MILE) * 100) / 100;
  let paceMin = 0;
  let paceSec = 0;
  if (a.distance > 0 && secs > 0 && sport !== "bike") {
    const perUnit = sport === "swim" ? (secs / a.distance) * 100 : secs / (a.distance / METERS_PER_MILE);
    paceMin = Math.floor(perUnit / 60);
    paceSec = Math.round(perUnit % 60);
    if (paceSec === 60) {
      paceMin++;
      paceSec = 0;
    }
  }
  const hasPowerMeter = a.device_watts === true;
  return {
    userId,
    // start_date_local is wall-clock time at the activity location — the athlete's "day".
    date: a.start_date_local.slice(0, 10),
    startTime: new Date(a.start_date),
    sportType,
    distance: String(legacyDistance),
    distanceUnit: sport === "swim" ? "meters" : "mi",
    timeHours: Math.floor(secs / 3600),
    timeMinutes: Math.floor((secs % 3600) / 60),
    paceMinutes: Math.min(paceMin, 99),
    paceSeconds: paceSec,
    runType: workoutTypeFor(a, sport),
    title: a.name,
    notes: a.description || null,
    heartRateAvg: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    heartRateMax: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    elevationGain: a.total_elevation_gain ? Math.round(a.total_elevation_gain * 3.28084) : null,
    averagePower: hasPowerMeter && a.average_watts ? Math.round(a.average_watts) : null,
    externalId: String(a.id),
    externalSource: "strava",
    movingTimeSec: secs,
    elapsedTimeSec: a.elapsed_time,
    distanceMeters: a.distance,
    elevationGainM: a.total_elevation_gain ?? null,
    avgSpeed: a.average_speed || null,
    maxSpeed: a.max_speed ?? null,
    avgCadence: a.average_cadence ?? null,
    normalizedPower: hasPowerMeter && a.weighted_average_watts ? Math.round(a.weighted_average_watts) : null,
    maxPower: hasPowerMeter && a.max_watts ? Math.round(a.max_watts) : null,
    kilojoules: a.kilojoules ?? null,
    hasPowerMeter,
    trainer: a.trainer ?? false,
    deviceName: a.device_name ?? null,
    providerSportType: t,
    calories: a.calories ? Math.round(a.calories) : null,
  };
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function fetchActivitiesSince(userId: string, afterTs: number): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await stravaGet<StravaActivity[]>(userId, `/athlete/activities?per_page=200&page=${page}&after=${afterTs}`);
    all.push(...batch);
    if (batch.length < 200) break;
  }
  return all;
}

export interface ImportResult {
  created: Run[];
  skipped: number;
}

/** Import summaries since the last sync (first sync: one year). Newly created rows get load immediately. */
export async function importNewStravaActivities(userId: string): Promise<ImportResult> {
  const integration = await storage.getIntegration(userId, "strava");
  if (!integration?.isActive) throw new StravaAuthError("Strava is not connected");
  const afterTs = integration.lastSyncedAt
    ? Math.floor(new Date(integration.lastSyncedAt).getTime() / 1000) - 3 * 86400
    : Math.floor(Date.now() / 1000) - 365 * 86400;
  const acts = await fetchActivitiesSince(userId, afterTs);
  const th = await getThresholds(userId);
  const created: Run[] = [];
  let skipped = 0;
  for (const a of acts) {
    const row = mapStravaActivity(a, userId);
    if (!row) {
      skipped++;
      continue;
    }
    const existing = await getActivityByExternal(userId, "strava", String(a.id));
    if (existing) {
      skipped++;
      continue;
    }
    const load = loadFor(row, th);
    const inserted = await insertActivity({ ...row, ...load });
    if (inserted) created.push(inserted);
  }
  await storage.upsertIntegration(userId, "strava", { lastSyncedAt: new Date() });
  return { created, skipped };
}

function loadFor(row: RunInsert, th: Awaited<ReturnType<typeof getThresholds>>) {
  const l = computeLoad(
    {
      sport: toSport(row.sportType),
      movingTimeSec: row.movingTimeSec ?? 0,
      distanceMeters: row.distanceMeters,
      elevationGainM: row.elevationGainM,
      avgHr: row.heartRateAvg,
      avgPower: row.averagePower,
      normalizedPower: row.normalizedPower,
      hasPowerMeter: row.hasPowerMeter ?? undefined,
      rpe: row.perceivedEffort,
      workoutType: row.runType,
      trainer: row.trainer,
    },
    th,
  );
  return { tss: l.tss, intensityFactor: Math.round(l.intensityFactor * 100) / 100, loadSource: l.source };
}

/**
 * Fetch full detail (laps, best efforts, description) and streams for one activity,
 * then compute zone distribution, NP, power curve, decoupling, EF, and load.
 */
export async function enrichActivity(userId: string, run: Run): Promise<Run | undefined> {
  if (!run.externalId) return run;
  const detail = await stravaGet<StravaActivity>(userId, `/activities/${run.externalId}?include_all_efforts=false`);
  const base = mapStravaActivity(detail, userId);
  const sport = toSport(run.sportType);
  const patch: Partial<RunInsert> = { detailFetched: true, laps: compactLaps(detail.laps) };
  if (base) {
    Object.assign(patch, {
      title: base.title,
      notes: run.notes ?? base.notes,
      deviceName: base.deviceName,
      calories: base.calories,
      normalizedPower: base.normalizedPower,
      maxPower: base.maxPower,
      runType: run.runType === "easy" || run.runType === "easy_ride" ? base.runType : run.runType,
    });
  }
  const bests: Record<string, number> = {};
  for (const e of detail.best_efforts ?? []) bests[String(Math.round(e.distance))] = e.moving_time;

  try {
    const keys = "time,heartrate,watts,velocity_smooth,distance,moving,cadence";
    const raw = await stravaGet<Record<string, { data: unknown[] }>>(userId, `/activities/${run.externalId}/streams?keys=${keys}&key_by_type=true`);
    const streams: Streams = {};
    for (const [k, v] of Object.entries(raw)) (streams as Record<string, unknown>)[k] = v.data;
    const th = await getThresholds(userId);
    const m = computeStreamMetrics(sport, streams, th);
    Object.assign(patch, {
      streamsFetched: true,
      hrZoneSec: m.hrZoneSec,
      powerZoneSec: m.powerZoneSec,
      paceZoneSec: m.paceZoneSec,
      decoupling: m.decoupling,
      efficiencyFactor: m.efficiencyFactor,
    });
    if (m.normalizedPower && run.hasPowerMeter) patch.normalizedPower = m.normalizedPower;
    if (m.powerCurve) Object.assign(bests, m.powerCurve);
    if (m.paceBests) for (const [k, v] of Object.entries(m.paceBests)) bests[k] = Math.min(bests[k] ?? Infinity, v);
  } catch (err) {
    if (err instanceof StravaAuthError) throw err;
    console.warn("[strava] streams unavailable for", run.externalId, (err as Error).message);
  }
  if (Object.keys(bests).length) patch.bestEfforts = bests;
  const th = await getThresholds(userId);
  const merged = { ...run, ...patch } as RunInsert;
  Object.assign(patch, loadFor(merged, th));
  return patchActivity(userId, run.id, patch);
}

/** Enrich up to `limit` recent activities that don't have detail yet, respecting rate limits. */
export async function enrichBacklog(userId: string, limit: number): Promise<number> {
  const pending = await getActivitiesNeedingDetail(userId, limit);
  let n = 0;
  for (const r of pending) {
    if (!stravaBudgetAvailable(25)) break;
    try {
      await enrichActivity(userId, r);
      n++;
    } catch (err) {
      if (err instanceof StravaAuthError) break;
      console.warn("[strava] enrich failed", r.externalId, (err as Error).message);
      await patchActivity(userId, r.id, { detailFetched: true });
    }
  }
  return n;
}

/** Import a single activity by Strava id (webhook "create"). */
export async function importStravaActivityById(userId: string, activityId: string): Promise<Run | null> {
  const existing = await getActivityByExternal(userId, "strava", activityId);
  if (existing) return enrichActivity(userId, existing).then((r) => r ?? existing);
  const detail = await stravaGet<StravaActivity>(userId, `/activities/${activityId}`);
  const row = mapStravaActivity(detail, userId);
  if (!row) return null;
  const th = await getThresholds(userId);
  const inserted = await insertActivity({ ...row, ...loadFor(row, th) });
  if (!inserted) return null;
  return (await enrichActivity(userId, inserted)) ?? inserted;
}

export async function updateStravaActivityFromWebhook(userId: string, activityId: string, updates: Record<string, string>) {
  const existing = await getActivityByExternal(userId, "strava", activityId);
  if (!existing) return;
  const patch: Partial<RunInsert> = {};
  if (updates.title) patch.title = updates.title;
  if (updates.type || updates.sport_type) {
    const sportType = stravaSportType(updates.sport_type ?? updates.type);
    if (sportType && sportType !== existing.sportType) patch.sportType = sportType;
  }
  if (Object.keys(patch).length) await patchActivity(userId, existing.id, patch);
}

export async function deleteStravaActivityFromWebhook(userId: string, activityId: string) {
  const existing = await getActivityByExternal(userId, "strava", activityId);
  if (existing) await deleteActivity(userId, existing.id);
}

// ─── Webhook subscription management ──────────────────────────────────────────

export function webhookVerifyToken(): string {
  return process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || crypto.createHash("sha256").update(`${clientSecret()}:vista-webhook`).digest("hex").slice(0, 24);
}

/** Ensure a push subscription exists pointing at APP_URL (only possible on a public URL). */
export async function ensureStravaWebhook(): Promise<string> {
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  if (!clientId() || !clientSecret()) return "Strava not configured";
  if (!base.startsWith("https://")) return "Skipped (APP_URL is not public https — using polling)";
  const callback = `${base}/api/strava/webhook`;
  const listRes = await fetch(`${STRAVA_API_BASE}/push_subscriptions?client_id=${clientId()}&client_secret=${clientSecret()}`);
  const subs = (await listRes.json().catch(() => [])) as { id: number; callback_url: string }[];
  if (Array.isArray(subs) && subs.some((s) => s.callback_url === callback)) return "Webhook active";
  for (const s of Array.isArray(subs) ? subs : []) {
    await fetch(`${STRAVA_API_BASE}/push_subscriptions/${s.id}?client_id=${clientId()}&client_secret=${clientSecret()}`, { method: "DELETE" });
  }
  const form = new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), callback_url: callback, verify_token: webhookVerifyToken() });
  const res = await fetch(`${STRAVA_API_BASE}/push_subscriptions`, { method: "POST", body: form });
  return res.ok ? "Webhook subscribed" : `Webhook subscription failed: ${res.status} ${await res.text()}`;
}
