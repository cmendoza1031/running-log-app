/**
 * Fueling: carbohydrate, fluid and sodium targets for sessions and races.
 *
 * Sources: Jeukendrup 2014 (carb intake by duration, multiple transportable carbs);
 * ACSM 2016 nutrition position stand (carb loading, fluids); Podlogar & Wallis 2022
 * (90-120 g/h needs gut training); Barnes 2019 (sweat sodium ~ 900 mg/L typical).
 * Deterministic so the coach quotes numbers, not guesses.
 */
import { RACES, type RaceType, type Sport } from "./physiology";

export interface FuelingProfile {
  weightKg?: number | null;
  /** Measured sweat rate (ml/h) — weigh before/after a 1 h session. */
  sweatRateMlPerH?: number | null;
  /** Sweat sodium concentration (mg/L) from a sweat test. */
  sweatSodiumMgPerL?: number | null;
  /** Highest carb rate (g/h) the athlete has practised without GI issues. */
  carbToleranceGPerH?: number | null;
}

export type Range = [number, number];

export interface FuelingTarget {
  carbsGPerH: Range;
  fluidMlPerH: Range;
  sodiumMgPerH: Range;
  totalCarbsG: Range;
  notes: string[];
}

const DEFAULT_SODIUM_MG_PER_L = 900;
const r5 = (x: number) => Math.round(x / 5) * 5;
const rng = (lo: number, hi: number): Range => [r5(lo), r5(hi)];

/** Carb rate by duration and intensity factor (IF ≈ 0.55 easy … 0.85+ hard). */
function carbRate(durationH: number, intensity: number, tolerance: number | null | undefined): Range {
  let [lo, hi] = durationH < 0.75 ? [0, 0] : durationH < 1.25 ? [0, 30] : durationH < 2.5 ? [30, 60] : [60, 90];
  // Hard sessions burn more glycogen: push toward the upper end.
  if (intensity >= 0.8 && durationH >= 1) [lo, hi] = [Math.max(lo, 45), Math.max(hi, 75)];
  // Above 90 g/h only with proven tolerance (glucose:fructose ~1:0.8).
  if (tolerance && durationH >= 2.5) hi = Math.max(hi, Math.min(tolerance, 120));
  if (tolerance) hi = Math.min(hi, Math.max(tolerance, 30));
  lo = Math.min(lo, hi);
  return rng(lo, hi);
}

/** Fluid: replace ~60-80% of sweat losses; never drink to gain weight (hyponatraemia). */
function fluidRate(durationH: number, profile: FuelingProfile, tempC: number | null | undefined): Range {
  if (durationH < 0.75) return [0, 250];
  if (profile.sweatRateMlPerH) {
    const s = profile.sweatRateMlPerH;
    return rng(Math.max(300, s * 0.6), Math.min(1000, s * 0.8));
  }
  const t = tempC ?? 18;
  return t < 12 ? [400, 500] : t < 22 ? [500, 750] : t < 28 ? [650, 900] : [750, 1000];
}

export function sessionFueling(
  s: { durationSec: number; intensity?: number; sport?: Sport; tempC?: number | null },
  profile: FuelingProfile = {},
): FuelingTarget {
  const h = s.durationSec / 3600;
  const intensity = s.intensity ?? 0.65;
  const notes: string[] = [];
  if (s.sport === "swim") {
    return { carbsGPerH: [0, 0], fluidMlPerH: [0, 0], sodiumMgPerH: [0, 0], totalCarbsG: [0, 0], notes: ["No fuel during the swim. In races, take a gel (~25 g) 10-15 min before the start."] };
  }
  const carbs = carbRate(h, intensity, profile.carbToleranceGPerH);
  const fluid = fluidRate(h, profile, s.tempC);
  const naPerL = profile.sweatSodiumMgPerL ?? DEFAULT_SODIUM_MG_PER_L;
  const sodium: Range = h < 0.75 ? [0, 0] : h < 1.5 ? [0, r5((fluid[1] / 1000) * naPerL)] : rng((fluid[0] / 1000) * naPerL, (fluid[1] / 1000) * naPerL);
  // First ~20 min run on stored glycogen; count fuel from then.
  const fuelH = Math.max(0, h - 0.33);
  if (h < 0.75) notes.push("Under 45 min: water is enough if you ate in the last 3 h.");
  else if (h < 1.25) notes.push("Optional carbs; a sports-drink mouth rinse helps hard efforts.");
  else notes.push(`Start fueling at ~20 min, then every 15-20 min in small doses.`);
  if (carbs[1] > 60) notes.push("Above 60 g/h use a glucose:fructose (maltodextrin:fructose ~1:0.8) product.");
  if (h >= 2.5) notes.push("Long session = gut training: practise exact race products and rates.");
  if (s.sport === "run" && carbs[1] > 60) notes.push("Gut tolerance is lower running; gels + water are easier than solids.");
  if (!profile.sweatRateMlPerH && h >= 1) notes.push("Fluid is a population estimate — do a sweat-rate test (weigh nude before/after 60 min, add fluid drunk).");
  return { carbsGPerH: carbs, fluidMlPerH: fluid, sodiumMgPerH: sodium, totalCarbsG: rng(carbs[0] * fuelH, carbs[1] * fuelH), notes };
}

export interface RaceFuelingPlan {
  carbLoad: { days: number; gPerKgPerDay: Range; gPerDay: Range | null } | null;
  breakfast: { hoursBefore: Range; carbsG: Range | null; note: string };
  legs: { leg: "swim" | "bike" | "run"; durationSec: number; target: FuelingTarget }[];
  totalCarbsG: Range;
  notes: string[];
}

/**
 * Race-day plan. For triathlon the bike carries most of the fuel: the gut absorbs best there and
 * run-leg intake falls as GI tolerance drops.
 */
export function raceFueling(
  race: RaceType,
  legSec: { swim?: number; bike?: number; run?: number },
  profile: FuelingProfile = {},
  tempC?: number | null,
): RaceFuelingPlan {
  const total = (legSec.swim ?? 0) + (legSec.bike ?? 0) + (legSec.run ?? 0);
  const kg = profile.weightKg ?? null;
  const long = total >= 90 * 60;
  const carbLoad = long
    ? { days: total >= 4 * 3600 ? 2 : 1, gPerKgPerDay: [8, 10] as Range, gPerDay: kg ? rng(8 * kg, 10 * kg) : null }
    : null;
  const breakfast = {
    hoursBefore: [3, 4] as Range,
    carbsG: kg ? rng((long ? 2 : 1) * kg, (long ? 3 : 2) * kg) : null,
    note: "Familiar low-fibre, low-fat carbs (white rice, bagel, banana, sports drink). Nothing new on race day.",
  };
  const legs: RaceFuelingPlan["legs"] = [];
  const isTri = RACES[race]?.sports.length === 3;
  if (isTri && legSec.swim) legs.push({ leg: "swim", durationSec: legSec.swim, target: sessionFueling({ durationSec: legSec.swim, sport: "swim" }, profile) });
  if (legSec.bike) {
    // Whole-race duration drives the rate; the bike front-loads it.
    const t = sessionFueling({ durationSec: Math.max(legSec.bike, total), intensity: 0.75, sport: "bike", tempC }, profile);
    const bh = legSec.bike / 3600;
    t.totalCarbsG = rng(t.carbsGPerH[0] * bh, t.carbsGPerH[1] * bh);
    if (isTri) t.notes = ["Bike is your main fueling window: hit the top of your practised range here.", ...t.notes.filter((n) => !n.startsWith("Start fueling"))];
    legs.push({ leg: "bike", durationSec: legSec.bike, target: t });
  }
  if (legSec.run) {
    const t = sessionFueling({ durationSec: isTri ? Math.max(legSec.run, total) : legSec.run, intensity: 0.75, sport: "run", tempC }, profile);
    if (isTri && t.carbsGPerH[1] > 0) {
      t.carbsGPerH = rng(Math.max(30, t.carbsGPerH[0] - 15), Math.max(45, t.carbsGPerH[1] - 15));
      t.notes = ["Take something at every aid station; switch to cola/broth late if gels stop working.", ...t.notes.filter((n) => !n.startsWith("Start fueling"))];
    }
    const rh = legSec.run / 3600;
    t.totalCarbsG = rng(t.carbsGPerH[0] * rh, t.carbsGPerH[1] * rh);
    legs.push({ leg: "run", durationSec: legSec.run, target: t });
  }
  const totalCarbsG: Range = legs.reduce<Range>((a, l) => [a[0] + l.target.totalCarbsG[0], a[1] + l.target.totalCarbsG[1]], [0, 0]);
  const notes = [
    "Rehearse this exact plan on 2-3 long bricks before race day.",
    "Weigh yourself before and after long sessions: losing > 2-3% body weight = drink more; gaining weight = drink less.",
  ];
  return { carbLoad, breakfast, legs, totalCarbsG, notes };
}

export function formatRange([lo, hi]: Range, unit: string): string {
  return (lo === hi ? `${lo} ${unit}` : `${lo}–${hi} ${unit}`).trim();
}

/** Compact one-line summary for UI and coach. */
export function fuelingLine(t: FuelingTarget): string {
  if (t.carbsGPerH[1] === 0 && t.fluidMlPerH[1] === 0) return "No in-session fuel needed";
  const parts = [`${formatRange(t.carbsGPerH, "g carbs/h")}`, `${formatRange(t.fluidMlPerH, "ml/h")} fluid`];
  if (t.sodiumMgPerH[1] > 0) parts.push(`${formatRange(t.sodiumMgPerH, "mg/h")} sodium`);
  if (t.totalCarbsG[1] > 0) parts.push(`≈ ${formatRange(t.totalCarbsG, "g")} total carbs`);
  return parts.join(" · ");
}

/** Intensity factor from planned TSS and duration (TSS = h × IF² × 100). */
export function intensityFromTss(tss: number | null | undefined, durationSec: number): number | undefined {
  if (!tss || !durationSec) return undefined;
  return Math.sqrt(tss / ((durationSec / 3600) * 100));
}
