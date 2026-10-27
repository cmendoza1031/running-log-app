import { z } from "zod";
import {
  type ThresholdMetric,
  parsePaceString,
  parseClock,
  vdotFromPerformance,
  thresholdPaceFromVdot,
  METERS_PER_MILE,
  METERS_PER_YARD,
} from "@shared/physiology";
import { addThreshold, prefsFromProfile, todayInTz } from "../data";
import { storage } from "../storage";
import { recomputeLoads } from "./load";
import { refreshPlannedMetrics } from "../planning/service";

export const thresholdInputSchema = z.object({
  ftp: z.number().min(50).max(600).optional(),
  runThresholdPace: z.string().optional().describe('e.g. "4:15/km" or "6:50/mi"'),
  swimCss: z.string().optional().describe('e.g. "1:45/100m" or "1:36/100yd"'),
  lthrRun: z.number().min(100).max(220).optional(),
  lthrBike: z.number().min(100).max(220).optional(),
  maxHr: z.number().min(120).max(230).optional(),
  restingHr: z.number().min(30).max(100).optional(),
  weightKg: z.number().min(30).max(200).optional(),
  recentRace: z
    .object({ distanceMeters: z.number().min(1000).max(50000), time: z.string() })
    .optional()
    .describe("A recent all-out run race/time trial; sets threshold pace via VDOT"),
  cssTest: z.object({ t400: z.string(), t200: z.string() }).optional().describe("400 and 200 time trial times (m:ss)"),
});
export type ThresholdInput = z.infer<typeof thresholdInputSchema>;

export class ThresholdInputError extends Error {}

/** Validate and store athlete-provided thresholds; re-targets plan & loads. Returns what changed. */
export async function applyThresholdInput(userId: string, input: ThresholdInput, source: "manual" | "test" = "manual") {
  const profile = await storage.getProfile(userId);
  const prefs = prefsFromProfile(profile);
  const today = todayInTz(prefs.tz);
  const writes: { metric: ThresholdMetric; value: number; note?: string; source?: "manual" | "test" }[] = [];

  if (input.ftp) writes.push({ metric: "ftp", value: Math.round(input.ftp) });
  if (input.runThresholdPace) {
    const p = parsePaceString(input.runThresholdPace);
    if (!p) throw new ThresholdInputError(`Couldn't read run pace "${input.runThresholdPace}" (use m:ss/km or m:ss/mi)`);
    const unit = p.unit ?? (prefs.units === "imperial" ? "mi" : "km");
    const secPerKm = unit === "mi" ? p.sec / (METERS_PER_MILE / 1000) : p.sec;
    if (secPerKm < 150 || secPerKm > 600) throw new ThresholdInputError("Run threshold pace looks out of range");
    writes.push({ metric: "run_threshold_pace", value: Math.round(secPerKm) });
  }
  if (input.swimCss) {
    const p = parsePaceString(input.swimCss);
    if (!p) throw new ThresholdInputError(`Couldn't read swim pace "${input.swimCss}" (use m:ss/100m or m:ss/100yd)`);
    const unit = p.unit ?? (prefs.pool === "yards" ? "100yd" : "100m");
    const per100m = unit === "100yd" ? p.sec / METERS_PER_YARD : p.sec;
    if (per100m < 55 || per100m > 240) throw new ThresholdInputError("CSS looks out of range");
    writes.push({ metric: "swim_css", value: Math.round(per100m) });
  }
  if (input.cssTest) {
    const t400 = parseClock(input.cssTest.t400);
    const t200 = parseClock(input.cssTest.t200);
    if (!t400 || !t200 || t400 <= t200) throw new ThresholdInputError("CSS test needs a 400 time slower than the 200 time");
    // Test swum in the athlete's pool unit: CSS per 100 of that unit → convert to per 100 m.
    const per100 = (t400 - t200) / 2;
    const per100m = prefs.pool === "yards" ? per100 / METERS_PER_YARD : per100;
    writes.push({ metric: "swim_css", value: Math.round(per100m), note: `CSS test: 400 in ${input.cssTest.t400}, 200 in ${input.cssTest.t200}`, source: "test" });
  }
  if (input.recentRace) {
    const secs = parseClock(input.recentRace.time);
    if (!secs) throw new ThresholdInputError(`Couldn't read race time "${input.recentRace.time}"`);
    const vdot = vdotFromPerformance(input.recentRace.distanceMeters, secs);
    if (!vdot) throw new ThresholdInputError("That race result looks out of range");
    const note = `From ${(input.recentRace.distanceMeters / 1000).toFixed(1)} km in ${input.recentRace.time} (VDOT ${vdot.toFixed(1)})`;
    writes.push({ metric: "run_threshold_pace", value: Math.round(thresholdPaceFromVdot(vdot)), note, source: "test" });
    writes.push({ metric: "vo2max", value: Math.round(vdot * 10) / 10, note, source: "test" });
  }
  if (input.lthrRun) writes.push({ metric: "lthr_run", value: Math.round(input.lthrRun) });
  if (input.lthrBike) writes.push({ metric: "lthr_bike", value: Math.round(input.lthrBike) });
  if (input.maxHr) writes.push({ metric: "max_hr", value: Math.round(input.maxHr) });
  if (input.restingHr) writes.push({ metric: "resting_hr", value: Math.round(input.restingHr) });
  if (input.weightKg) writes.push({ metric: "weight_kg", value: Math.round(input.weightKg * 10) / 10 });

  for (const w of writes) {
    await addThreshold(userId, { metric: w.metric, value: w.value, source: w.source ?? source, note: w.note ?? null, effectiveDate: today });
  }
  if (writes.length) {
    await recomputeLoads(userId, prefs.tz, 42);
    await refreshPlannedMetrics(userId);
  }
  return writes;
}
