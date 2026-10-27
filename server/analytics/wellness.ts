/**
 * Recovery status from Apple Health data (HRV, resting HR, sleep).
 *
 * HRV method (Plews / Altini): work in ln(HRV); baseline = 60-day mean and SD of daily values;
 * normal range = mean ± 0.75 SD. The 7-day rolling mean below that range = suppressed
 * (accumulated fatigue, illness, stress). Two straight days below mean − 1 SD = acute dip.
 * Apple Watch HRV is SDNN, not rMSSD — fine for trend use, not comparable to chest-strap values.
 */
import type { DailyWellness } from "@shared/schema";
import { addDays } from "@shared/training-load";
import { getWellnessBetween } from "../data";

export type HrvStatus = "suppressed" | "acute_dip" | "normal" | "elevated" | "insufficient_data";

export interface WellnessSnapshot {
  hrvStatus: HrvStatus;
  hrv7dMs: number | null;
  hrvBaselineMs: number | null;
  hrvNormalLowMs: number | null;
  hrvNormalHighMs: number | null;
  rhr7d: number | null;
  rhrBaseline: number | null;
  /** Resting HR 7-day mean is ≥ 5 bpm above the 60-day mean. */
  rhrElevated: boolean;
  sleep7dMin: number | null;
  lastNight: { date: string; hrvMs: number | null; restingHr: number | null; sleepMin: number | null } | null;
  /** True when HRV or resting HR says the athlete is under-recovered. */
  fatigueSignal: boolean;
}

const MIN_BASELINE_DAYS = 14;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}
const round = (x: number | null, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function computeWellness(rows: DailyWellness[], today: string): WellnessSnapshot {
  const since7 = addDays(today, -6);
  const hrvRows = rows.filter((r) => r.hrvMs != null && r.hrvMs > 0);
  const lnAll = hrvRows.map((r) => Math.log(r.hrvMs!));
  const ln7 = hrvRows.filter((r) => r.date >= since7).map((r) => Math.log(r.hrvMs!));

  let hrvStatus: HrvStatus = "insufficient_data";
  let base: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  if (lnAll.length >= MIN_BASELINE_DAYS && ln7.length >= 3) {
    const m = mean(lnAll);
    const s = sd(lnAll);
    base = m;
    low = m - 0.75 * s;
    high = m + 0.75 * s;
    const m7 = mean(ln7);
    const last2 = hrvRows.slice(-2);
    const acute = last2.length === 2 && last2.every((r) => r.date >= addDays(today, -2) && Math.log(r.hrvMs!) < m - s);
    hrvStatus = m7 < low ? "suppressed" : acute ? "acute_dip" : m7 > high ? "elevated" : "normal";
  }

  const rhrAll = rows.filter((r) => r.restingHr != null).map((r) => r.restingHr!);
  const rhr7 = rows.filter((r) => r.restingHr != null && r.date >= since7).map((r) => r.restingHr!);
  const rhrBaseline = rhrAll.length >= MIN_BASELINE_DAYS ? mean(rhrAll) : null;
  const rhr7d = rhr7.length >= 3 ? mean(rhr7) : null;
  const rhrElevated = rhrBaseline != null && rhr7d != null && rhr7d - rhrBaseline >= 5;

  const sleep7 = rows.filter((r) => r.sleepMin != null && r.date >= since7).map((r) => r.sleepMin!);
  const last = rows[rows.length - 1];

  return {
    hrvStatus,
    hrv7dMs: ln7.length ? round(Math.exp(mean(ln7))) : null,
    hrvBaselineMs: base == null ? null : round(Math.exp(base)),
    hrvNormalLowMs: low == null ? null : round(Math.exp(low)),
    hrvNormalHighMs: high == null ? null : round(Math.exp(high)),
    rhr7d: round(rhr7d),
    rhrBaseline: round(rhrBaseline),
    rhrElevated,
    sleep7dMin: sleep7.length ? round(mean(sleep7)) : null,
    lastNight: last && last.date >= addDays(today, -1) ? { date: last.date, hrvMs: round(last.hrvMs), restingHr: last.restingHr, sleepMin: last.sleepMin } : null,
    fatigueSignal: hrvStatus === "suppressed" || hrvStatus === "acute_dip" || rhrElevated,
  };
}

export async function getWellness(userId: string, today: string): Promise<WellnessSnapshot | null> {
  const rows = await getWellnessBetween(userId, addDays(today, -60), today);
  if (!rows.length) return null;
  return computeWellness(rows, today);
}

const hm = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;

/** One line for the coach / analysis prompts. */
export function wellnessText(w: WellnessSnapshot | null): string {
  if (!w) return "WELLNESS: no Apple Health data";
  const parts: string[] = [];
  if (w.hrvStatus === "insufficient_data") parts.push(`HRV building baseline${w.hrv7dMs ? ` (7d ${w.hrv7dMs} ms)` : ""}`);
  else parts.push(`HRV ${w.hrvStatus.toUpperCase()} — 7d ${w.hrv7dMs} ms vs normal ${w.hrvNormalLowMs}-${w.hrvNormalHighMs} ms`);
  if (w.rhr7d != null) parts.push(`resting HR 7d ${w.rhr7d}${w.rhrBaseline != null ? ` (baseline ${w.rhrBaseline}${w.rhrElevated ? ", ELEVATED" : ""})` : ""}`);
  if (w.sleep7dMin != null) parts.push(`sleep 7d avg ${hm(w.sleep7dMin)}`);
  if (w.lastNight) {
    const ln = w.lastNight;
    const bits = [ln.hrvMs != null ? `HRV ${ln.hrvMs}` : null, ln.restingHr != null ? `RHR ${ln.restingHr}` : null, ln.sleepMin != null ? `sleep ${hm(ln.sleepMin)}` : null].filter(Boolean);
    if (bits.length) parts.push(`last night (${ln.date}): ${bits.join(", ")}`);
  }
  return `WELLNESS (Apple Health): ${parts.join("; ")}`;
}
