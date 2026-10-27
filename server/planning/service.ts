import type { PlanWorkout, Run, TrainingDay } from "@shared/schema";
import {
  type RaceType,
  type Sport,
  RACES,
  defaultThresholds,
  effectiveLthr,
  toSport,
  toSportType,
  type Thresholds,
} from "@shared/physiology";
import {
  parseWorkout,
  summarizeWorkout,
  isValidStructure,
  type WorkoutStructure,
  type WorkoutNode,
} from "@shared/workout-structure";
import { addDays } from "@shared/training-load";
import { storage } from "../storage";
import {
  getActivePlan,
  getActivitiesBetween,
  getPlanWorkoutsBetween,
  getThresholds,
  insertPlanWorkouts,
  patchActivity,
  patchPlanWorkout,
  deleteFuturePlannedWorkouts,
  prefsFromProfile,
  todayInTz,
  type PlanWorkoutInsert,
} from "../data";
import { generatePlan, type GeneratedPlan } from "./generator";
import { db } from "../storage";
import { trainingPlans } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { activityMovingSec } from "../analytics/load";

const LEGACY_TYPE: Record<string, Record<string, string>> = {
  run: { easy: "easy", recovery: "recovery", long: "long", quality: "threshold", brick: "brick", race: "race" },
  bike: { easy: "easy_ride", endurance: "easy_ride", recovery: "recovery_ride", long: "long_ride", quality: "interval_ride", race: "race_ride" },
  swim: { technique: "drill", endurance: "easy_swim", quality: "threshold_swim", easy: "easy_swim", race: "race_swim" },
};

/** Thresholds used to size workouts — falls back to level-based defaults for missing values. */
export async function planningThresholds(userId: string, level: string | null | undefined): Promise<Thresholds> {
  const th = await getThresholds(userId);
  const d = defaultThresholds(level);
  return { ...th, ftp: th.ftp ?? d.ftp, runThresholdPace: th.runThresholdPace ?? d.runThresholdPace, swimCss: th.swimCss ?? d.swimCss };
}

export function workoutMetrics(structure: WorkoutStructure, th: Thresholds) {
  const s = summarizeWorkout(structure, th);
  return { plannedTss: s.tss, plannedDurationSec: Math.round(s.seconds), plannedDistanceM: Math.round(s.meters) };
}

export interface CreatePlanOptions {
  race?: RaceType | null;
  raceDate?: string | null;
  raceName?: string | null;
  startDate?: string | null;
  weeklyHours?: number | null;
  limiter?: Sport | null;
  title?: string | null;
}

export async function createPlanForUser(userId: string, opts: CreatePlanOptions) {
  const profile = await storage.getProfile(userId);
  const prefs = prefsFromProfile(profile);
  const today = todayInTz(prefs.tz);
  const race: RaceType = (opts.race ?? (profile?.goalRaceType as RaceType | null) ?? "general") as RaceType;
  const raceDate = opts.raceDate ?? profile?.targetRaceDate ?? null;
  const startDate = opts.startDate && opts.startDate >= today ? opts.startDate : today;
  const level = profile?.fitnessLevel ?? "intermediate";
  const th = await planningThresholds(userId, level);

  // Current volume: average of the last 4 weeks of actual training.
  const recent = await getActivitiesBetween(userId, addDays(today, -28), today);
  const recentHours = recent.reduce((a, r) => a + activityMovingSec(r), 0) / 3600 / 4;
  const weeklyHours = opts.weeklyHours ?? (profile?.weeklyHoursGoal ? Number(profile.weeklyHoursGoal) : 8);

  const sportsPref = ((profile?.sports as string[] | null) ?? []).flatMap((s) => (s === "triathlon" ? ["swim", "bike", "run"] : [toSport(s)])).filter(Boolean) as Sport[];

  const generated: GeneratedPlan = generatePlan({
    race,
    raceDate: race === "general" ? null : raceDate,
    startDate,
    weeklyHours,
    currentWeeklyHours: recent.length >= 4 ? recentHours : null,
    level,
    schedule: ((profile?.weeklySchedule as TrainingDay[] | null) ?? []).filter((d) => d.maxMinutes > 0),
    limiter: (opts.limiter ?? (profile?.limiter as Sport | null)) || null,
    sports: sportsPref.length ? Array.from(new Set(sportsPref)) : ["run"],
    pool: prefs.pool,
    easyByHr: !!effectiveLthr(th, "run"),
    swimCss: prefs.pool === "yards" ? (th.swimCss ?? 110) * 0.9144 : th.swimCss ?? 110,
  });

  // Replace the active plan; completed history stays.
  await db.update(trainingPlans).set({ isActive: false, updatedAt: new Date() }).where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.isActive, true)));
  await deleteFuturePlannedWorkouts(userId, startDate);

  const def = RACES[race];
  const title =
    opts.title ??
    (race === "general" ? "Base & Build — 12 weeks" : opts.raceName ?? (profile?.targetRace && profile.targetRace !== def.label ? profile.targetRace : `${def.label} plan`));
  const [plan] = await db
    .insert(trainingPlans)
    .values({
      userId,
      title,
      description: `${generated.weeks.length}-week periodized plan`,
      goal: race === "general" ? "Build aerobic fitness and threshold" : `${def.label}${raceDate ? ` on ${raceDate}` : ""}`,
      startDate,
      endDate: generated.endDate,
      raceDate: race === "general" ? null : raceDate,
      raceName: opts.raceName ?? profile?.targetRace ?? null,
      raceDistance: def.label,
      isActive: true,
      createdByAgent: true,
      planData: {
        race,
        weeklyHours,
        phases: generated.phases,
        split: generated.split,
        weeks: generated.weeks.map((w) => ({ index: w.index, start: w.start, phase: w.phase, targetHours: w.targetHours })),
      },
    })
    .returning();

  const rows: PlanWorkoutInsert[] = [];
  for (const w of generated.weeks) {
    for (const s of w.sessions) {
      const structure = parseWorkout(s.dsl, s.sport);
      rows.push({
        planId: plan.id,
        userId,
        date: s.date,
        sport: s.sport,
        workoutType: LEGACY_TYPE[s.sport]?.[s.kind] ?? "other",
        title: s.title,
        description: s.description,
        structure,
        ...workoutMetrics(structure, th),
        targetDurationMinutes: null,
        phase: w.phase,
        weekNumber: w.index + 1,
        isKey: s.isKey,
        status: "planned",
        sortOrder: s.order,
        isCompleted: false,
      });
    }
  }
  await insertPlanWorkouts(rows);
  // Link any activity already done today to today's plan.
  const todays = await getActivitiesBetween(userId, startDate, today);
  for (const r of todays) await matchActivityToPlan(userId, r);

  if (race !== "general" && raceDate) {
    await storage.upsertProfile(userId, { goalRaceType: race, targetRaceDate: raceDate } as never);
  }
  return { plan, generated, workoutCount: rows.length };
}

/** Recompute planned duration/distance/TSS for future workouts after thresholds change. */
export async function refreshPlannedMetrics(userId: string): Promise<number> {
  const profile = await storage.getProfile(userId);
  const today = todayInTz(profile?.timezone);
  const th = await planningThresholds(userId, profile?.fitnessLevel);
  const ws = await getPlanWorkoutsBetween(userId, today, addDays(today, 400));
  let n = 0;
  for (const w of ws) {
    if (w.isCompleted || !isValidStructure(w.structure)) continue;
    await patchPlanWorkout(userId, w.id, workoutMetrics(w.structure as WorkoutStructure, th));
    n++;
  }
  return n;
}

// ─── Matching activities to planned sessions ─────────────────────────────────

export async function matchActivityToPlan(userId: string, run: Run): Promise<PlanWorkout | null> {
  if (run.planWorkoutId) return null;
  const sport = toSport(run.sportType);
  if (!sport) return null;
  const candidates = (await getPlanWorkoutsBetween(userId, run.date, run.date)).filter(
    (w) => !w.isCompleted && w.status !== "skipped" && (w.sport ?? toSport(sportOfLegacy(w.workoutType))) === sport,
  );
  if (!candidates.length) return null;
  const secs = activityMovingSec(run);
  const best = candidates.sort(
    (a, b) => Math.abs((a.plannedDurationSec ?? secs) - secs) - Math.abs((b.plannedDurationSec ?? secs) - secs),
  )[0];
  await patchPlanWorkout(userId, best.id, { isCompleted: true, completedRunId: run.id, status: "completed" });
  await patchActivity(userId, run.id, { planWorkoutId: best.id });
  return best;
}

function sportOfLegacy(workoutType: string): string {
  if (/ride|sweet_spot/.test(workoutType)) return "cycling";
  if (/swim|drill|css/.test(workoutType)) return "swimming";
  return "running";
}

// ─── Adaptation ───────────────────────────────────────────────────────────────

/** Scale a structure's volume by `factor` (repeat counts and step lengths). */
export function scaleStructure(ws: WorkoutStructure, factor: number): WorkoutStructure {
  const scaleStep = <T extends WorkoutNode>(n: T): T => {
    if (n.kind === "repeat") return { ...n, count: Math.max(1, Math.round(n.count * factor)) };
    if (n.intent === "rest" || n.intent === "recovery") return n;
    const d = n.duration;
    if (d.type === "time") return { ...n, duration: { type: "time", sec: Math.max(300, Math.round((d.sec * factor) / 60) * 60) } };
    if (d.type === "distance") return { ...n, duration: { type: "distance", m: Math.max(100, Math.round((d.m * factor) / 50) * 50) } };
    return n;
  };
  return { ...ws, nodes: ws.nodes.map(scaleStep) };
}

function easyVersion(w: PlanWorkout, minutes: number): WorkoutStructure {
  const sport = (w.sport ?? "run") as Sport;
  const dsl =
    sport === "swim"
      ? `${Math.max(800, Math.round((minutes * 60) / 125) * 100)}m Z2 "easy aerobic, focus on form"`
      : `${Math.max(20, Math.round(minutes / 5) * 5)}min ${sport === "run" ? "Z1-Z2 HR" : "Z1-Z2"} "easy — recovery focus"`;
  return parseWorkout(dsl, sport);
}

export type AdaptAction = "ease_next_days" | "add_recovery_day";

/**
 * Deterministic plan adaptation used by the workout-analysis suggestions and the coach:
 *  - ease_next_days: next 3 days — key sessions become easy aerobic at 80% duration, others −20%.
 *  - add_recovery_day: tomorrow becomes a rest day (sessions marked skipped) and the day after is eased.
 */
export async function adaptUpcoming(userId: string, action: AdaptAction): Promise<{ changed: number; summary: string }> {
  const profile = await storage.getProfile(userId);
  const today = todayInTz(profile?.timezone);
  const th = await planningThresholds(userId, profile?.fitnessLevel);
  const start = addDays(today, 1);
  const ws = (await getPlanWorkoutsBetween(userId, start, addDays(start, 2))).filter((w) => !w.isCompleted && w.status !== "skipped");
  let changed = 0;
  for (const w of ws) {
    if (!isValidStructure(w.structure)) continue;
    const structure = w.structure as WorkoutStructure;
    if (action === "add_recovery_day" && w.date === start) {
      await patchPlanWorkout(userId, w.id, { status: "skipped", notes: "Converted to rest day — recovery prioritized." });
      changed++;
      continue;
    }
    if (action === "add_recovery_day" && w.date !== addDays(start, 1)) continue;
    const minutes = ((w.plannedDurationSec ?? 3600) / 60) * 0.8;
    const next = w.isKey ? easyVersion(w, minutes) : scaleStructure(structure, 0.8);
    await patchPlanWorkout(userId, w.id, {
      structure: next,
      ...workoutMetrics(next, th),
      title: w.isKey ? `${w.sport === "swim" ? "Easy Swim" : w.sport === "bike" ? "Easy Ride" : "Easy Run"} (eased)` : w.title,
      isKey: false,
      notes: `Adjusted by coach: ${action === "ease_next_days" ? "eased for recovery" : "recovery day inserted"}. Original: ${w.title}`,
    });
    changed++;
  }
  const summary =
    action === "ease_next_days"
      ? `Eased the next 3 days (${changed} sessions): key sessions swapped for easy aerobic work, volume −20%.`
      : `Tomorrow is now a rest day and the following day is eased (${changed} sessions changed).`;
  return { changed, summary };
}

/** Build a single workout from DSL for coach/manual edits. */
export async function buildWorkoutFromDsl(userId: string, sport: Sport, dsl: string) {
  const profile = await storage.getProfile(userId);
  const th = await planningThresholds(userId, profile?.fitnessLevel);
  const structure = parseWorkout(dsl, sport);
  return { structure, metrics: workoutMetrics(structure, th) };
}

export async function ensureActivePlan(userId: string) {
  const plan = await getActivePlan(userId);
  if (plan) return plan;
  const profile = await storage.getProfile(userId);
  const [created] = await db
    .insert(trainingPlans)
    .values({
      userId,
      title: "My Training",
      startDate: todayInTz(profile?.timezone),
      endDate: addDays(todayInTz(profile?.timezone), 365),
      isActive: true,
      createdByAgent: false,
    })
    .returning();
  return created;
}

export { toSportType };
