import type { Run, PlanWorkout } from "@shared/schema";
import { type Sport, type Thresholds, toSport } from "@shared/physiology";
import { computeLoad, buildPmc, addDays, formState, rampRate, type DailyLoad, type PmcPoint } from "@shared/training-load";
import { getActivitiesBetween, getPlanWorkoutsBetween, getThresholds, patchActivity, todayInTz } from "../data";

export function activitySport(r: Run): Sport | null {
  return toSport(r.sportType);
}

export function activityMovingSec(r: Run): number {
  return r.movingTimeSec ?? r.timeHours * 3600 + r.timeMinutes * 60;
}

export function activityLoad(r: Run, th: Thresholds) {
  return computeLoad(
    {
      sport: activitySport(r),
      movingTimeSec: activityMovingSec(r),
      distanceMeters: r.distanceMeters,
      elevationGainM: r.elevationGainM,
      avgHr: r.heartRateAvg,
      avgPower: r.averagePower,
      normalizedPower: r.normalizedPower,
      hasPowerMeter: r.hasPowerMeter ?? undefined,
      rpe: r.perceivedEffort,
      workoutType: r.runType,
      trainer: r.trainer,
    },
    th,
  );
}

/** Recompute TSS for activities in a window (after thresholds change or a backfill). */
export async function recomputeLoads(userId: string, tz: string | null, days = 400, onlyMissing = false): Promise<number> {
  const today = todayInTz(tz);
  const [th, acts] = await Promise.all([getThresholds(userId), getActivitiesBetween(userId, addDays(today, -days), today)]);
  let n = 0;
  for (const r of acts) {
    if (onlyMissing && r.tss != null) continue;
    const l = activityLoad(r, th);
    if (r.tss !== l.tss || r.loadSource !== l.source) {
      await patchActivity(userId, r.id, { tss: l.tss, intensityFactor: Math.round(l.intensityFactor * 100) / 100, loadSource: l.source });
      n++;
    }
  }
  return n;
}

export interface FitnessSnapshot {
  today: string;
  ctl: number;
  atl: number;
  tsb: number;
  form: ReturnType<typeof formState>;
  rampRate: number | null;
  bySport: Record<Sport, { ctl: number; atl: number }>;
  series: PmcPoint[];
}

function dailyLoads(acts: Run[], filter?: Sport): DailyLoad[] {
  return acts
    .filter((r) => !filter || activitySport(r) === filter)
    .map((r) => ({ date: r.date, tss: r.tss ?? 0 }));
}

function plannedLoads(ws: PlanWorkout[], from: string, filter?: Sport): DailyLoad[] {
  return ws
    .filter((w) => w.date > from && !w.isCompleted && w.status !== "skipped" && (!filter || w.sport === filter))
    .map((w) => ({ date: w.date, tss: w.plannedTss ?? 0, planned: true }));
}

/**
 * Fitness/Fatigue/Form. History starts 400 days back so CTL is warmed up; the returned
 * series is trimmed to `historyDays` plus an optional projection through planned workouts.
 */
export async function getFitness(userId: string, tz: string | null, opts: { historyDays?: number; projectDays?: number } = {}): Promise<FitnessSnapshot> {
  const today = todayInTz(tz);
  const start = addDays(today, -400);
  const projectEnd = addDays(today, opts.projectDays ?? 0);
  const [acts, plan] = await Promise.all([
    getActivitiesBetween(userId, start, today),
    opts.projectDays ? getPlanWorkoutsBetween(userId, addDays(today, 1), projectEnd) : Promise.resolve([] as PlanWorkout[]),
  ]);
  const series = buildPmc([...dailyLoads(acts), ...plannedLoads(plan, today)], start, projectEnd, today);
  const todayPt = series.find((p) => p.date === today)!;
  const bySport = {} as Record<Sport, { ctl: number; atl: number }>;
  for (const s of ["swim", "bike", "run"] as Sport[]) {
    const ss = buildPmc(dailyLoads(acts, s), start, today);
    const last = ss[ss.length - 1];
    bySport[s] = { ctl: last.ctl, atl: last.atl };
  }
  // Form "today" = yesterday's CTL − ATL, i.e. the tsb recorded on today's point.
  const tsb = todayPt.tsb;
  const historyStart = addDays(today, -(opts.historyDays ?? 90));
  return {
    today,
    ctl: todayPt.ctl,
    atl: todayPt.atl,
    tsb,
    form: formState(tsb, todayPt.ctl),
    rampRate: rampRate(series, today),
    bySport,
    series: series.filter((p) => p.date >= historyStart),
  };
}

// ─── Weekly volume ────────────────────────────────────────────────────────────

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export interface WeekVolume {
  week: string; // Monday
  sports: Record<Sport | "other", { sec: number; meters: number; tss: number; count: number }>;
  totalSec: number;
  totalTss: number;
  planned: { sec: number; tss: number; count: number; completed: number };
}

function emptySports() {
  return {
    swim: { sec: 0, meters: 0, tss: 0, count: 0 },
    bike: { sec: 0, meters: 0, tss: 0, count: 0 },
    run: { sec: 0, meters: 0, tss: 0, count: 0 },
    other: { sec: 0, meters: 0, tss: 0, count: 0 },
  };
}

export function weeklyVolume(acts: Run[], plan: PlanWorkout[], weeks: string[]): WeekVolume[] {
  const map = new Map<string, WeekVolume>();
  for (const w of weeks) map.set(w, { week: w, sports: emptySports(), totalSec: 0, totalTss: 0, planned: { sec: 0, tss: 0, count: 0, completed: 0 } });
  for (const r of acts) {
    const wv = map.get(weekStart(r.date));
    if (!wv) continue;
    const s = activitySport(r) ?? "other";
    const sec = activityMovingSec(r);
    wv.sports[s].sec += sec;
    wv.sports[s].meters += r.distanceMeters ?? 0;
    wv.sports[s].tss += r.tss ?? 0;
    wv.sports[s].count++;
    wv.totalSec += sec;
    wv.totalTss += r.tss ?? 0;
  }
  for (const p of plan) {
    const wv = map.get(weekStart(p.date));
    if (!wv || p.status === "skipped") continue;
    wv.planned.sec += p.plannedDurationSec ?? 0;
    wv.planned.tss += p.plannedTss ?? 0;
    wv.planned.count++;
    if (p.isCompleted) wv.planned.completed++;
  }
  return weeks.map((w) => map.get(w)!);
}

// ─── Intensity distribution ───────────────────────────────────────────────────

export interface IntensityDistribution {
  sport: Sport | "all";
  low: number; // fraction of time at low intensity (Z1–2)
  moderate: number; // "grey zone" (Z3)
  high: number; // Z4+
  totalSec: number;
  source: "zones" | "estimate";
}

/**
 * Time-weighted distribution. Uses HR/power/pace zone seconds from streams when present,
 * otherwise classifies whole activities by intensity factor.
 */
export function intensityDistribution(acts: Run[], sport: Sport | "all"): IntensityDistribution {
  let low = 0;
  let mod = 0;
  let high = 0;
  let usedZones = 0;
  for (const r of acts) {
    const s = activitySport(r);
    if (!s || (sport !== "all" && s !== sport)) continue;
    const z = (s === "bike" ? r.powerZoneSec : null) ?? r.hrZoneSec ?? r.paceZoneSec;
    if (z && z.length >= 5) {
      usedZones++;
      low += z[0] + z[1];
      mod += z[2];
      high += z.slice(3).reduce((a, b) => a + b, 0);
      continue;
    }
    const sec = activityMovingSec(r);
    const IF = r.intensityFactor ?? 0.7;
    if (IF < 0.8) low += sec;
    else if (IF < 0.92) mod += sec;
    else high += sec;
  }
  const total = low + mod + high;
  return {
    sport,
    low: total ? low / total : 0,
    moderate: total ? mod / total : 0,
    high: total ? high / total : 0,
    totalSec: total,
    source: usedZones > 0 ? "zones" : "estimate",
  };
}
