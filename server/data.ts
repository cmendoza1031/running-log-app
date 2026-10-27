/**
 * Data access for the training platform (thresholds, activities, structured plans, coach threads).
 * Complements server/storage.ts, which keeps the original CRUD surface.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "./storage";
import {
  runs,
  profiles,
  planWorkouts,
  trainingPlans,
  athleteThresholds,
  coachThreads,
  coachMessages,
  healthLogs,
  fitnessIntegrations,
  chatMessages,
  coachMemory,
  dailyWellness,
  aiUsage,
  type CoachMemoryCategory,
  type Run,
  type PlanWorkout,
  type AthleteThreshold,
  type Profile,
} from "@shared/schema";
import {
  THRESHOLD_METRICS,
  thresholdsFromMap,
  type ThresholdMetric,
  type Thresholds,
  type UnitSystem,
  type PoolUnit,
} from "@shared/physiology";

export type RunInsert = typeof runs.$inferInsert;
export type PlanWorkoutInsert = typeof planWorkouts.$inferInsert;

// ─── Dates ────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for "now" in the given IANA timezone (falls back to UTC). */
export function todayInTz(tz?: string | null, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export interface AthletePrefs {
  units: UnitSystem;
  pool: PoolUnit;
  tz: string | null;
}

export function prefsFromProfile(p: Profile | null | undefined): AthletePrefs {
  return {
    units: p?.unitSystem === "metric" ? "metric" : "imperial",
    pool: p?.poolUnit === "meters" ? "meters" : "yards",
    tz: p?.timezone ?? null,
  };
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export interface ThresholdState {
  values: Thresholds;
  /** Latest active row per metric (for source/date display). */
  current: Partial<Record<ThresholdMetric, AthleteThreshold>>;
  /** Pending auto-detected suggestions. */
  suggestions: AthleteThreshold[];
}

export async function getThresholdRows(userId: string): Promise<AthleteThreshold[]> {
  return db
    .select()
    .from(athleteThresholds)
    .where(eq(athleteThresholds.userId, userId))
    .orderBy(desc(athleteThresholds.effectiveDate), desc(athleteThresholds.createdAt));
}

export async function getThresholdState(userId: string): Promise<ThresholdState> {
  const rows = await getThresholdRows(userId);
  const current: Partial<Record<ThresholdMetric, AthleteThreshold>> = {};
  for (const r of rows) {
    if (r.status !== "active") continue;
    const m = r.metric as ThresholdMetric;
    if (!current[m]) current[m] = r;
  }
  const map: Partial<Record<ThresholdMetric, number>> = {};
  for (const m of THRESHOLD_METRICS) if (current[m]) map[m] = current[m]!.value;
  const suggestions = rows.filter((r) => r.status === "suggested");
  return { values: thresholdsFromMap(map), current, suggestions };
}

export async function getThresholds(userId: string): Promise<Thresholds> {
  return (await getThresholdState(userId)).values;
}

export async function addThreshold(
  userId: string,
  row: {
    metric: ThresholdMetric;
    value: number;
    source: "manual" | "auto" | "test" | "default";
    status?: "active" | "suggested";
    note?: string | null;
    activityId?: string | null;
    effectiveDate: string;
  },
): Promise<AthleteThreshold> {
  if (row.status !== "suggested") {
    // A new active value supersedes any pending suggestion for that metric.
    await db
      .update(athleteThresholds)
      .set({ status: "dismissed" })
      .where(and(eq(athleteThresholds.userId, userId), eq(athleteThresholds.metric, row.metric), eq(athleteThresholds.status, "suggested")));
  }
  const [inserted] = await db
    .insert(athleteThresholds)
    .values({
      userId,
      metric: row.metric,
      value: row.value,
      source: row.source,
      status: row.status ?? "active",
      note: row.note ?? null,
      activityId: row.activityId ?? null,
      effectiveDate: row.effectiveDate,
    })
    .returning();
  return inserted;
}

export async function setThresholdStatus(userId: string, id: string, status: "active" | "dismissed"): Promise<AthleteThreshold | undefined> {
  const [row] = await db
    .update(athleteThresholds)
    .set({ status })
    .where(and(eq(athleteThresholds.userId, userId), eq(athleteThresholds.id, id)))
    .returning();
  return row;
}

// ─── Activities ───────────────────────────────────────────────────────────────

export async function getActivitiesBetween(userId: string, start: string, end: string): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.userId, userId), gte(runs.date, start), lte(runs.date, end)))
    .orderBy(desc(runs.date), desc(runs.startTime));
}

export async function getActivity(userId: string, id: string): Promise<Run | undefined> {
  const [r] = await db.select().from(runs).where(and(eq(runs.userId, userId), eq(runs.id, id))).limit(1);
  return r;
}

export async function getActivityByExternal(userId: string, source: string, externalId: string): Promise<Run | undefined> {
  const [r] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.externalSource, source), eq(runs.externalId, externalId)))
    .limit(1);
  return r;
}

export async function insertActivity(row: RunInsert): Promise<Run | null> {
  const res = await db.insert(runs).values(row).onConflictDoNothing().returning();
  return res[0] ?? null;
}

export async function patchActivity(userId: string, id: string, patch: Partial<RunInsert>): Promise<Run | undefined> {
  const [r] = await db
    .update(runs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(runs.userId, userId), eq(runs.id, id)))
    .returning();
  return r;
}

export async function deleteActivity(userId: string, id: string): Promise<void> {
  await db.update(planWorkouts).set({ isCompleted: false, completedRunId: null, status: "planned" }).where(and(eq(planWorkouts.userId, userId), eq(planWorkouts.completedRunId, id)));
  await db.delete(runs).where(and(eq(runs.userId, userId), eq(runs.id, id)));
}

/** Activities that still need provider detail/streams, newest first. */
export async function getActivitiesNeedingDetail(userId: string, limit: number): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.externalSource, "strava"), eq(runs.detailFetched, false)))
    .orderBy(desc(runs.date))
    .limit(limit);
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function getActivePlan(userId: string) {
  const [p] = await db
    .select()
    .from(trainingPlans)
    .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.isActive, true)))
    .orderBy(desc(trainingPlans.createdAt))
    .limit(1);
  return p;
}

export async function getPlanWorkoutsBetween(userId: string, start: string, end: string): Promise<PlanWorkout[]> {
  return db
    .select()
    .from(planWorkouts)
    .where(and(eq(planWorkouts.userId, userId), gte(planWorkouts.date, start), lte(planWorkouts.date, end)))
    .orderBy(asc(planWorkouts.date), asc(planWorkouts.sortOrder));
}

export async function getPlanWorkout(userId: string, id: string): Promise<PlanWorkout | undefined> {
  const [w] = await db.select().from(planWorkouts).where(and(eq(planWorkouts.userId, userId), eq(planWorkouts.id, id))).limit(1);
  return w;
}

export async function insertPlanWorkouts(rows: PlanWorkoutInsert[]): Promise<PlanWorkout[]> {
  if (!rows.length) return [];
  const out: PlanWorkout[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    out.push(...(await db.insert(planWorkouts).values(rows.slice(i, i + 200)).returning()));
  }
  return out;
}

/** Set planned metrics for many workouts in one statement (a plan can hold 300+ future sessions). */
export async function bulkSetPlannedMetrics(
  userId: string,
  rows: { id: string; plannedTss: number; plannedDurationSec: number; plannedDistanceM: number }[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const values = sql.join(
      rows
        .slice(i, i + 500)
        .map((r) => sql`(${r.id}::uuid, ${r.plannedTss}::double precision, ${r.plannedDurationSec}::integer, ${r.plannedDistanceM}::double precision)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE plan_workouts AS w
      SET planned_tss = v.tss, planned_duration_sec = v.dur, planned_distance_m = v.dist, updated_at = now()
      FROM (VALUES ${values}) AS v(id, tss, dur, dist)
      WHERE w.id = v.id AND w.user_id = ${userId}::uuid`);
  }
}

export async function patchPlanWorkout(userId: string, id: string, patch: Partial<PlanWorkoutInsert>): Promise<PlanWorkout | undefined> {
  const [w] = await db
    .update(planWorkouts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(planWorkouts.userId, userId), eq(planWorkouts.id, id)))
    .returning();
  return w;
}

export async function deletePlanWorkouts(userId: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const res = await db.delete(planWorkouts).where(and(eq(planWorkouts.userId, userId), inArray(planWorkouts.id, ids))).returning();
  return res.length;
}

/** Remove not-yet-done workouts on/after `from` (used when regenerating a plan). */
export async function deleteFuturePlannedWorkouts(userId: string, from: string): Promise<void> {
  await db
    .delete(planWorkouts)
    .where(and(eq(planWorkouts.userId, userId), gte(planWorkouts.date, from), eq(planWorkouts.isCompleted, false)));
}

// ─── Coach threads ────────────────────────────────────────────────────────────

export async function getOrCreateLatestThread(userId: string) {
  const [t] = await db.select().from(coachThreads).where(eq(coachThreads.userId, userId)).orderBy(desc(coachThreads.updatedAt)).limit(1);
  if (t) return t;
  const [created] = await db.insert(coachThreads).values({ userId }).returning();
  return created;
}

export async function createThread(userId: string, title?: string) {
  const [created] = await db.insert(coachThreads).values({ userId, title: title ?? null }).returning();
  return created;
}

export async function getThread(userId: string, id: string) {
  const [t] = await db.select().from(coachThreads).where(and(eq(coachThreads.userId, userId), eq(coachThreads.id, id))).limit(1);
  return t;
}

export async function listThreads(userId: string) {
  return db.select().from(coachThreads).where(eq(coachThreads.userId, userId)).orderBy(desc(coachThreads.updatedAt)).limit(30);
}

export async function getThreadMessages(threadId: string) {
  return db.select().from(coachMessages).where(eq(coachMessages.threadId, threadId)).orderBy(asc(coachMessages.createdAt));
}

export async function appendThreadMessage(row: typeof coachMessages.$inferInsert) {
  const [m] = await db.insert(coachMessages).values(row).returning();
  await db.update(coachThreads).set({ updatedAt: new Date() }).where(eq(coachThreads.id, row.threadId));
  return m;
}

export async function renameThread(threadId: string, title: string) {
  await db.update(coachThreads).set({ title }).where(eq(coachThreads.id, threadId));
}

// ─── Coach memory ─────────────────────────────────────────────────────────────

export async function listMemories(userId: string) {
  return db
    .select()
    .from(coachMemory)
    .where(and(eq(coachMemory.userId, userId), eq(coachMemory.archived, false)))
    .orderBy(asc(coachMemory.category), asc(coachMemory.createdAt));
}

/** Insert a note, or replace an existing note's text when `id` is given. */
export async function saveMemory(userId: string, m: { id?: string; category: CoachMemoryCategory; note: string }) {
  if (m.id) {
    const [row] = await db
      .update(coachMemory)
      .set({ category: m.category, note: m.note, updatedAt: new Date() })
      .where(and(eq(coachMemory.userId, userId), eq(coachMemory.id, m.id)))
      .returning();
    return row;
  }
  const [row] = await db.insert(coachMemory).values({ userId, category: m.category, note: m.note }).returning();
  return row;
}

export async function archiveMemory(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(coachMemory)
    .set({ archived: true, updatedAt: new Date() })
    .where(and(eq(coachMemory.userId, userId), eq(coachMemory.id, id)))
    .returning({ id: coachMemory.id });
  return rows.length > 0;
}

// ─── Daily wellness ───────────────────────────────────────────────────────────

export type WellnessInput = { date: string; hrvMs?: number | null; restingHr?: number | null; sleepMin?: number | null };

export async function upsertWellness(userId: string, days: WellnessInput[]): Promise<number> {
  if (!days.length) return 0;
  await db
    .insert(dailyWellness)
    .values(days.map((d) => ({ userId, date: d.date, hrvMs: d.hrvMs ?? null, restingHr: d.restingHr ?? null, sleepMin: d.sleepMin ?? null })))
    .onConflictDoUpdate({
      target: [dailyWellness.userId, dailyWellness.date],
      set: {
        hrvMs: sql`excluded.hrv_ms`,
        restingHr: sql`excluded.resting_hr`,
        sleepMin: sql`excluded.sleep_min`,
        updatedAt: new Date(),
      },
    });
  return days.length;
}

export async function getWellnessBetween(userId: string, from: string, to: string) {
  return db
    .select()
    .from(dailyWellness)
    .where(and(eq(dailyWellness.userId, userId), gte(dailyWellness.date, from), lte(dailyWellness.date, to)))
    .orderBy(asc(dailyWellness.date));
}

// ─── Account deletion ─────────────────────────────────────────────────────────

export async function deleteAllUserData(userId: string): Promise<void> {
  await db.delete(coachMessages).where(eq(coachMessages.userId, userId));
  await db.delete(coachThreads).where(eq(coachThreads.userId, userId));
  await db.delete(coachMemory).where(eq(coachMemory.userId, userId));
  await db.delete(aiUsage).where(eq(aiUsage.userId, userId));
  await db.delete(dailyWellness).where(eq(dailyWellness.userId, userId));
  await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  await db.delete(athleteThresholds).where(eq(athleteThresholds.userId, userId));
  await db.delete(planWorkouts).where(eq(planWorkouts.userId, userId));
  await db.delete(trainingPlans).where(eq(trainingPlans.userId, userId));
  await db.delete(runs).where(eq(runs.userId, userId));
  await db.delete(healthLogs).where(eq(healthLogs.userId, userId));
  await db.delete(fitnessIntegrations).where(eq(fitnessIntegrations.userId, userId));
  await db.delete(profiles).where(eq(profiles.id, userId));
  // LangGraph checkpoints from the previous coach implementation, if present.
  const exists = await db.execute(sql`SELECT to_regclass('public.checkpoints') IS NOT NULL AS present`);
  if ((exists.rows[0] as { present?: boolean } | undefined)?.present) {
    const prefix = `${userId}:%`;
    await db.execute(sql`DELETE FROM checkpoint_writes WHERE thread_id LIKE ${prefix}`);
    await db.execute(sql`DELETE FROM checkpoint_blobs WHERE thread_id LIKE ${prefix}`);
    await db.execute(sql`DELETE FROM checkpoints WHERE thread_id LIKE ${prefix}`);
  }
}
