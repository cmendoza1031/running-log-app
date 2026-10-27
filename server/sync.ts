/**
 * Sync pipeline: import → enrich (detail + streams) → match to plan → detect thresholds →
 * re-target plan → AI analysis. Runs from webhooks, the background poller, and app-open.
 */
import { and, eq } from "drizzle-orm";
import { db, storage } from "./storage";
import { fitnessIntegrations, type Run } from "@shared/schema";
import {
  importNewStravaActivities,
  enrichActivity,
  enrichBacklog,
  importStravaActivityById,
  stravaBudgetAvailable,
  StravaAuthError,
} from "./integrations/strava";
import { matchActivityToPlan, refreshPlannedMetrics } from "./planning/service";
import { runThresholdDetection } from "./analytics/thresholds";
import { recomputeLoads } from "./analytics/load";
import { analyzeActivity } from "./coach/analysis";
import { todayInTz, getActivity } from "./data";
import { addDays } from "@shared/training-load";

const running = new Map<string, Promise<SyncResult>>();

export interface SyncResult {
  imported: number;
  enriched: number;
  analyzed: number;
  thresholdChanges: { metric: string; value: number; status: string }[];
  error?: string;
}

/** Recent activities worth an AI note: last 3 days, at most 5 per sync (avoids a year of backfill notes). */
function shouldAnalyze(r: Run, today: string): boolean {
  return r.date >= addDays(today, -3) && !r.analysis;
}

async function afterNewActivities(userId: string, tz: string | null, fresh: Run[], result: SyncResult) {
  for (const r of fresh) await matchActivityToPlan(userId, r);
  const written = await runThresholdDetection(userId, tz);
  result.thresholdChanges = written.map((w) => ({ metric: w.metric, value: w.value, status: w.status }));
  if (written.some((w) => w.status === "active")) {
    await recomputeLoads(userId, tz, 60);
    await refreshPlannedMetrics(userId);
  }
  const today = todayInTz(tz);
  const toAnalyze = fresh.filter((r) => shouldAnalyze(r, today)).slice(0, 5);
  for (const r of toAnalyze) {
    const latest = await getActivity(userId, r.id);
    if (latest && (await analyzeActivity(userId, latest.id))) result.analyzed++;
  }
}

export async function syncUser(userId: string, opts: { backlog?: number } = {}): Promise<SyncResult> {
  const inflight = running.get(userId);
  if (inflight) return inflight;
  const p = (async (): Promise<SyncResult> => {
    const result: SyncResult = { imported: 0, enriched: 0, analyzed: 0, thresholdChanges: [] };
    const profile = await storage.getProfile(userId);
    const tz = profile?.timezone ?? null;
    try {
      const { created } = await importNewStravaActivities(userId);
      result.imported = created.length;
      // Enrich the newest first so today's workout gets laps/zones before analysis.
      const newest = [...created].sort((a, b) => b.date.localeCompare(a.date));
      const enrichedFresh: Run[] = [];
      for (const r of newest.slice(0, 12)) {
        if (!stravaBudgetAvailable(15)) break;
        const e = await enrichActivity(userId, r).catch((err) => {
          if (err instanceof StravaAuthError) throw err;
          return undefined;
        });
        if (e) {
          enrichedFresh.push(e);
          result.enriched++;
        }
      }
      const enrichedIds = new Set(enrichedFresh.map((r) => r.id));
      await afterNewActivities(userId, tz, [...enrichedFresh, ...created.filter((r) => !enrichedIds.has(r.id))], result);
      if (opts.backlog) result.enriched += await enrichBacklog(userId, opts.backlog);
      if (created.length > 20) {
        // Large backfill: thresholds may have been established just now — recompute all loads.
        await recomputeLoads(userId, tz, 400);
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      if (err instanceof StravaAuthError) {
        console.warn("[sync] auth error for", userId, result.error);
      } else {
        console.error("[sync] failed for", userId, err);
      }
    }
    return result;
  })();
  running.set(userId, p);
  try {
    return await p;
  } finally {
    running.delete(userId);
  }
}

/** Webhook "create": import one activity, then run the post-processing pipeline. */
export async function handleNewStravaActivity(userId: string, stravaActivityId: string) {
  const profile = await storage.getProfile(userId);
  const tz = profile?.timezone ?? null;
  const run = await importStravaActivityById(userId, stravaActivityId);
  if (!run) return;
  const result: SyncResult = { imported: 1, enriched: 1, analyzed: 0, thresholdChanges: [] };
  await afterNewActivities(userId, tz, [run], result);
  await storage.upsertIntegration(userId, "strava", { lastSyncedAt: new Date() });
}

export async function findUserByStravaAthlete(athleteId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(fitnessIntegrations)
    .where(and(eq(fitnessIntegrations.provider, "strava"), eq(fitnessIntegrations.athleteId, athleteId), eq(fitnessIntegrations.isActive, true)))
    .limit(1);
  return row?.userId ?? null;
}

// ─── Background poller (safety net when webhooks are unavailable) ─────────────

export function startSyncScheduler() {
  const webhooks = (process.env.APP_URL ?? "").startsWith("https://");
  const intervalMs = (webhooks ? 60 : 15) * 60 * 1000;
  const tick = async () => {
    try {
      const rows = await db.select().from(fitnessIntegrations).where(and(eq(fitnessIntegrations.provider, "strava"), eq(fitnessIntegrations.isActive, true)));
      for (const row of rows) {
        if (!stravaBudgetAvailable(40)) break;
        const last = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;
        if (Date.now() - last < intervalMs * 0.8) continue;
        await syncUser(row.userId, { backlog: 10 });
      }
    } catch (err) {
      console.error("[sync] scheduler tick failed", err);
    }
  };
  setTimeout(tick, 30_000);
  return setInterval(tick, intervalMs);
}
