/**
 * Training load: per-activity Training Stress Score and the Performance Management Chart
 * (Fitness = CTL, Fatigue = ATL, Form = TSB).
 *
 *   Bike with power → TSS  = h · IF² · 100, IF = NP / FTP
 *   Run with pace   → rTSS = h · IF² · 100, IF = grade-adjusted speed / threshold speed
 *   Swim with pace  → sTSS = h · IF³ · 100, IF = speed / CSS speed
 *   Any sport + HR  → hrTSS via heart-rate reserve relative to LTHR
 *   Fallback        → RPE or workout-type intensity estimate
 */

import { type Sport, type Thresholds, effectiveLthr } from "./physiology";

export interface LoadInput {
  sport: Sport | null;
  movingTimeSec: number;
  distanceMeters?: number | null;
  elevationGainM?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  normalizedPower?: number | null;
  hasPowerMeter?: boolean;
  rpe?: number | null;
  workoutType?: string | null;
  trainer?: boolean | null;
}

export type LoadSource = "power" | "pace" | "hr" | "rpe" | "estimate";

export interface LoadResult {
  tss: number;
  intensityFactor: number;
  source: LoadSource;
}

const RPE_IF = [0, 0.5, 0.55, 0.62, 0.68, 0.74, 0.8, 0.86, 0.93, 1.0, 1.08];

const TYPE_IF: Record<string, number> = {
  recovery: 0.6,
  easy: 0.7,
  long: 0.72,
  tempo: 0.85,
  threshold: 0.92,
  interval: 0.9,
  fartlek: 0.82,
  race: 0.95,
  trail: 0.72,
  recovery_ride: 0.55,
  easy_ride: 0.65,
  long_ride: 0.68,
  tempo_ride: 0.8,
  sweet_spot: 0.85,
  interval_ride: 0.85,
  hill_ride: 0.8,
  race_ride: 0.9,
  easy_swim: 0.75,
  drill: 0.65,
  threshold_swim: 0.92,
  interval_swim: 0.9,
  open_water_swim: 0.85,
  race_swim: 0.95,
  css_test: 0.95,
  brick: 0.8,
};

/** Equivalent flat speed for a run: each meter climbed costs ~6 m of flat running, net of descents. */
export function gradeAdjustedSpeed(distanceM: number, movingSec: number, elevationGainM: number | null | undefined): number {
  if (movingSec <= 0) return 0;
  const gain = Math.max(0, elevationGainM ?? 0);
  // Cap the adjustment so bad elevation data can't produce absurd speeds.
  const extra = Math.min(gain * 6, distanceM * 0.35);
  return (distanceM + extra) / movingSec;
}

function clampIf(x: number): number {
  return Math.max(0.3, Math.min(1.35, x));
}

export function computeLoad(a: LoadInput, th: Thresholds): LoadResult {
  const hours = a.movingTimeSec / 3600;
  if (hours <= 0) return { tss: 0, intensityFactor: 0, source: "estimate" };
  const tss = (IF: number, exp = 2) => Math.round(hours * Math.pow(IF, exp) * 100);

  if (a.sport === "bike" && th.ftp && (a.normalizedPower || a.avgPower) && a.hasPowerMeter !== false) {
    const np = a.normalizedPower ?? (a.avgPower! * 1.05);
    const IF = clampIf(np / th.ftp);
    return { tss: tss(IF), intensityFactor: IF, source: "power" };
  }
  if (a.sport === "run" && th.runThresholdPace && a.distanceMeters && a.distanceMeters > 200 && !a.trainer) {
    const v = gradeAdjustedSpeed(a.distanceMeters, a.movingTimeSec, a.elevationGainM);
    const IF = clampIf(v / (1000 / th.runThresholdPace));
    return { tss: tss(IF), intensityFactor: IF, source: "pace" };
  }
  if (a.sport === "swim" && th.swimCss && a.distanceMeters && a.distanceMeters > 50) {
    const v = a.distanceMeters / a.movingTimeSec;
    const IF = clampIf(v / (100 / th.swimCss));
    return { tss: tss(IF, 3), intensityFactor: IF, source: "pace" };
  }
  const lthr = a.sport ? effectiveLthr(th, a.sport) : th.lthrRun ?? null;
  if (a.avgHr && lthr) {
    const rest = th.restingHr ?? 55;
    const IF = clampIf(((a.avgHr - rest) / (lthr - rest)) * 0.98);
    return { tss: tss(IF), intensityFactor: IF, source: "hr" };
  }
  if (a.rpe && a.rpe >= 1 && a.rpe <= 10) {
    const IF = RPE_IF[a.rpe];
    return { tss: tss(IF), intensityFactor: IF, source: "rpe" };
  }
  const IF = TYPE_IF[a.workoutType ?? ""] ?? (a.sport === "swim" ? 0.75 : 0.7);
  return { tss: tss(IF, a.sport === "swim" ? 3 : 2), intensityFactor: IF, source: "estimate" };
}

// ─── Performance Management Chart ─────────────────────────────────────────────

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

export interface DailyLoad {
  date: string; // YYYY-MM-DD
  tss: number;
  bySport?: Partial<Record<Sport, number>>;
  planned?: boolean;
}

export interface PmcPoint {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  /** Form going INTO this day (yesterday's CTL − ATL) — the conventional TSB. */
  tsb: number;
  projected?: boolean;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86_400_000);
}

/**
 * Build a continuous PMC series from `start` to `end` inclusive.
 * `loads` may include future planned days (marked planned) for projection.
 */
export function buildPmc(loads: DailyLoad[], start: string, end: string, today?: string, seed = { ctl: 0, atl: 0 }): PmcPoint[] {
  const byDate = new Map<string, { tss: number; planned: boolean }>();
  for (const l of loads) {
    const cur = byDate.get(l.date);
    byDate.set(l.date, { tss: (cur?.tss ?? 0) + l.tss, planned: (cur?.planned ?? false) || !!l.planned });
  }
  const out: PmcPoint[] = [];
  let ctl = seed.ctl;
  let atl = seed.atl;
  const n = daysBetween(start, end);
  for (let i = 0; i <= n; i++) {
    const date = addDays(start, i);
    const entry = byDate.get(date);
    const tss = entry?.tss ?? 0;
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / CTL_DAYS;
    atl = atl + (tss - atl) / ATL_DAYS;
    out.push({
      date,
      tss,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      projected: today ? date > today : false,
    });
  }
  return out;
}

export type FormState = "fresh" | "neutral" | "productive" | "overreaching" | "detraining";

/** Interpretation of TSB, scaled a little by fitness so low-CTL athletes aren't mislabeled. */
export function formState(tsb: number, ctl: number): { state: FormState; label: string; advice: string } {
  const scale = Math.max(1, ctl / 60);
  const t = tsb / scale;
  if (t > 25) return { state: "detraining", label: "Very fresh", advice: "Fitness is slipping — fine for a taper or break, otherwise add load." };
  if (t > 5) return { state: "fresh", label: "Fresh", advice: "Ready to race or hit a key session hard." };
  if (t > -10) return { state: "neutral", label: "Balanced", advice: "Maintaining — normal training is fine." };
  if (t > -30) return { state: "productive", label: "Building", advice: "Productive training stress. Keep easy days truly easy." };
  return { state: "overreaching", label: "Overreaching", advice: "High fatigue — prioritize sleep and consider an easier day." };
}

/** Ramp rate = CTL change over the last 7 days. >8/week is aggressive for most athletes. */
export function rampRate(series: PmcPoint[], today: string): number | null {
  const idx = series.findIndex((p) => p.date === today);
  if (idx < 7) return null;
  return Math.round((series[idx].ctl - series[idx - 7].ctl) * 10) / 10;
}
