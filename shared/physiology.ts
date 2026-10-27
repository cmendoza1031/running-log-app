/**
 * Training physiology: units, formatting, VDOT (Daniels), training zones, race prediction.
 *
 * Canonical units everywhere in the backend:
 *   distance  → meters
 *   duration  → seconds
 *   run pace  → seconds per km
 *   swim pace → seconds per 100 m
 *   power     → watts
 * Conversion to the athlete's display units happens only at the edges (UI, prompts, exports).
 */

export type Sport = "swim" | "bike" | "run";
export type UnitSystem = "imperial" | "metric";
export type PoolUnit = "meters" | "yards";

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_YARD = 0.9144;

// ─── Legacy sport name mapping ────────────────────────────────────────────────

/** DB rows use "running" | "cycling" | "swimming" | "triathlon"; analytics use short names. */
export function toSport(sportType: string | null | undefined): Sport | null {
  switch (sportType) {
    case "running":
    case "run":
      return "run";
    case "cycling":
    case "bike":
      return "bike";
    case "swimming":
    case "swim":
      return "swim";
    default:
      return null;
  }
}

export function toSportType(sport: Sport): "running" | "cycling" | "swimming" {
  return sport === "run" ? "running" : sport === "bike" ? "cycling" : "swimming";
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatClock(totalSec: number, opts: { forceHours?: boolean } = {}): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "--:--";
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0 || opts.forceHours) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "1h 25m", "45m", "50s" */
export function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "0m";
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  if (h === 0 && m === 0) return `${Math.round(totalSec)}s`;
  if (h === 0) return `${m}m`;
  if (m === 60) return `${h + 1}h`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function runPaceUnit(units: UnitSystem): string {
  return units === "imperial" ? "/mi" : "/km";
}

/** sec/km → display seconds per athlete unit (km or mile). */
export function runPaceToDisplaySec(secPerKm: number, units: UnitSystem): number {
  return units === "imperial" ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm;
}

export function displaySecToRunPace(sec: number, units: UnitSystem): number {
  return units === "imperial" ? sec / (METERS_PER_MILE / 1000) : sec;
}

export function formatRunPace(secPerKm: number | null | undefined, units: UnitSystem, withUnit = true): string {
  if (!secPerKm || !Number.isFinite(secPerKm)) return "--";
  const s = runPaceToDisplaySec(secPerKm, units);
  return `${formatClock(s)}${withUnit ? runPaceUnit(units) : ""}`;
}

export function swimPaceUnit(pool: PoolUnit): string {
  return pool === "yards" ? "/100yd" : "/100m";
}

export function swimPaceToDisplaySec(secPer100m: number, pool: PoolUnit): number {
  return pool === "yards" ? secPer100m * METERS_PER_YARD : secPer100m;
}

export function displaySecToSwimPace(sec: number, pool: PoolUnit): number {
  return pool === "yards" ? sec / METERS_PER_YARD : sec;
}

export function formatSwimPace(secPer100m: number | null | undefined, pool: PoolUnit, withUnit = true): string {
  if (!secPer100m || !Number.isFinite(secPer100m)) return "--";
  return `${formatClock(swimPaceToDisplaySec(secPer100m, pool))}${withUnit ? swimPaceUnit(pool) : ""}`;
}

export function formatDistance(meters: number | null | undefined, sport: Sport | null, units: UnitSystem, pool: PoolUnit = "meters"): string {
  if (meters == null || !Number.isFinite(meters)) return "--";
  if (sport === "swim") {
    if (pool === "yards") return `${Math.round(meters / METERS_PER_YARD).toLocaleString()} yd`;
    return `${Math.round(meters).toLocaleString()} m`;
  }
  if (units === "imperial") {
    const mi = meters / METERS_PER_MILE;
    return `${mi >= 100 ? mi.toFixed(0) : mi.toFixed(mi < 10 ? 2 : 1)} mi`;
  }
  const km = meters / 1000;
  return `${km >= 100 ? km.toFixed(0) : km.toFixed(km < 10 ? 2 : 1)} km`;
}

export function formatSpeed(mps: number | null | undefined, units: UnitSystem): string {
  if (!mps) return "--";
  return units === "imperial" ? `${(mps * 2.236936).toFixed(1)} mph` : `${(mps * 3.6).toFixed(1)} km/h`;
}

/** Parse "4:30", "4:30/km", "7:15/mi", "1:45/100m", "1:40/100yd" → seconds + unit hint. */
export function parsePaceString(raw: string): { sec: number; unit: "km" | "mi" | "100m" | "100yd" | null } | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})(?:\s*\/\s*(km|mi|mile|100m|100y|100yd|100yds))?$/);
  if (!m) return null;
  const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const u = m[3];
  const unit = !u ? null : u === "km" ? "km" : u.startsWith("mi") ? "mi" : u === "100m" ? "100m" : "100yd";
  return { sec, unit };
}

/** Parse "1:23:45", "23:45", "45" (minutes) → seconds. */
export function parseClock(raw: string): number | null {
  const parts = raw.trim().split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length === 1) return n[0] * 60;
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  return null;
}

// ─── Daniels VDOT ─────────────────────────────────────────────────────────────

/** Oxygen cost (ml/kg/min) of running at v meters/min (Daniels & Gilbert). */
export function vo2AtVelocity(vMetersPerMin: number): number {
  return -4.6 + 0.182258 * vMetersPerMin + 0.000104 * vMetersPerMin * vMetersPerMin;
}

/** Fraction of VO2max sustainable for t minutes (Daniels & Gilbert). */
export function fractionVo2maxForDuration(tMin: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}

/** VDOT from a maximal effort over `meters` in `seconds`. */
function rawVdot(meters: number, seconds: number): number {
  const tMin = seconds / 60;
  return vo2AtVelocity(meters / tMin) / fractionVo2maxForDuration(tMin);
}

export function vdotFromPerformance(meters: number, seconds: number): number | null {
  if (meters < 800 || seconds < 120) return null;
  const vdot = rawVdot(meters, seconds);
  return Number.isFinite(vdot) && vdot > 15 && vdot < 90 ? vdot : null;
}

/** Velocity (m/min) at which the VO2 cost equals `vo2` — inverse of vo2AtVelocity. */
export function velocityAtVo2(vo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** Daniels training paces (sec/km) from VDOT. */
export function danielsPaces(vdot: number) {
  const pace = (pct: number) => 1000 / (velocityAtVo2(vdot * pct) / 60);
  return {
    easySlow: pace(0.62),
    easyFast: pace(0.74),
    marathon: predictRaceSeconds(vdot, 42195) / 42.195,
    threshold: pace(0.88),
    interval: pace(0.975),
    repetition: pace(1.07),
  };
}

/** Predicted race time (seconds) for `meters` given VDOT, via bisection. */
export function predictRaceSeconds(vdot: number, meters: number): number {
  let lo = 60;
  let hi = 60 * 60 * 12;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (rawVdot(meters, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Threshold pace (sec/km) implied by a VDOT. */
export function thresholdPaceFromVdot(vdot: number): number {
  return danielsPaces(vdot).threshold;
}

/** Inverse: VDOT implied by a threshold pace (sec/km). */
export function vdotFromThresholdPace(secPerKm: number): number {
  const vMetersPerMin = 1000 / (secPerKm / 60);
  return vo2AtVelocity(vMetersPerMin) / 0.88;
}

// ─── Zones ────────────────────────────────────────────────────────────────────

export interface ZoneBand {
  zone: number;
  name: string;
  /** Lower bound of the zone in the metric's native unit (null = open-ended). */
  low: number | null;
  high: number | null;
  /** Human-readable range in the athlete's display units. */
  label: string;
  /** Intensity factor at the zone midpoint (fraction of threshold). */
  if: number;
}

export const ZONE_COLORS = ["#8E8E93", "#0A84FF", "#30D158", "#FF9F0A", "#FF453A", "#BF5AF2", "#FF2D55"];

/** Coggan power zones as fraction of FTP. */
export const POWER_ZONE_DEFS = [
  { name: "Active Recovery", low: 0, high: 0.55 },
  { name: "Endurance", low: 0.56, high: 0.75 },
  { name: "Tempo", low: 0.76, high: 0.9 },
  { name: "Threshold", low: 0.91, high: 1.05 },
  { name: "VO2max", low: 1.06, high: 1.2 },
  { name: "Anaerobic", low: 1.21, high: 1.5 },
  { name: "Neuromuscular", low: 1.51, high: null as number | null },
];

/** Run pace zones as fraction of threshold SPEED (Friel, condensed to 5). */
export const RUN_PACE_ZONE_DEFS = [
  { name: "Recovery", low: 0, high: 0.78 },
  { name: "Endurance", low: 0.78, high: 0.88 },
  { name: "Tempo", low: 0.88, high: 0.95 },
  { name: "Threshold", low: 0.95, high: 1.02 },
  { name: "VO2max", low: 1.02, high: null as number | null },
];

/** Swim zones as fraction of CSS speed. */
export const SWIM_ZONE_DEFS = [
  { name: "Recovery", low: 0, high: 0.88 },
  { name: "Endurance", low: 0.88, high: 0.94 },
  { name: "Tempo", low: 0.94, high: 0.98 },
  { name: "Threshold", low: 0.98, high: 1.02 },
  { name: "VO2max", low: 1.02, high: null as number | null },
];

/** Friel heart-rate zones as fraction of LTHR, per sport. */
export const HR_ZONE_DEFS: Record<"run" | "bike", { name: string; low: number; high: number | null }[]> = {
  run: [
    { name: "Recovery", low: 0, high: 0.85 },
    { name: "Aerobic", low: 0.85, high: 0.89 },
    { name: "Tempo", low: 0.89, high: 0.94 },
    { name: "Threshold", low: 0.94, high: 1.0 },
    { name: "VO2max", low: 1.0, high: null },
  ],
  bike: [
    { name: "Recovery", low: 0, high: 0.81 },
    { name: "Aerobic", low: 0.81, high: 0.89 },
    { name: "Tempo", low: 0.89, high: 0.94 },
    { name: "Threshold", low: 0.94, high: 1.0 },
    { name: "VO2max", low: 1.0, high: null },
  ],
};

function midIf(low: number, high: number | null): number {
  if (high == null) return low + 0.08;
  if (low === 0) return high - 0.1;
  return (low + high) / 2;
}

export function powerZones(ftp: number): ZoneBand[] {
  return POWER_ZONE_DEFS.map((z, i) => {
    const lo = Math.round(z.low * ftp);
    const hi = z.high == null ? null : Math.round(z.high * ftp);
    return {
      zone: i + 1,
      name: z.name,
      low: i === 0 ? null : lo,
      high: hi,
      label: i === 0 ? `< ${hi} W` : hi == null ? `> ${lo} W` : `${lo}–${hi} W`,
      if: midIf(z.low, z.high),
    };
  });
}

/** Pace zones — low/high are in sec/km (low = slower bound). */
export function runPaceZones(thresholdSecPerKm: number, units: UnitSystem): ZoneBand[] {
  return RUN_PACE_ZONE_DEFS.map((z, i) => {
    const slow = z.low === 0 ? null : thresholdSecPerKm / z.low;
    const fast = z.high == null ? null : thresholdSecPerKm / z.high;
    const f = (s: number) => formatRunPace(s, units, false);
    const label =
      slow == null ? `slower than ${f(fast!)}` : fast == null ? `faster than ${f(slow)}` : `${f(slow)}–${f(fast)}`;
    return { zone: i + 1, name: z.name, low: slow, high: fast, label: `${label}${runPaceUnit(units)}`, if: midIf(z.low, z.high) };
  });
}

export function swimZones(cssSecPer100m: number, pool: PoolUnit): ZoneBand[] {
  return SWIM_ZONE_DEFS.map((z, i) => {
    const slow = z.low === 0 ? null : cssSecPer100m / z.low;
    const fast = z.high == null ? null : cssSecPer100m / z.high;
    const f = (s: number) => formatSwimPace(s, pool, false);
    const label =
      slow == null ? `slower than ${f(fast!)}` : fast == null ? `faster than ${f(slow)}` : `${f(slow)}–${f(fast)}`;
    return { zone: i + 1, name: z.name, low: slow, high: fast, label: `${label}${swimPaceUnit(pool)}`, if: midIf(z.low, z.high) };
  });
}

export function hrZones(lthr: number, sport: "run" | "bike"): ZoneBand[] {
  return HR_ZONE_DEFS[sport].map((z, i) => {
    const lo = Math.round(z.low * lthr);
    const hi = z.high == null ? null : Math.round(z.high * lthr) - (z.high === 1 ? 0 : 1);
    return {
      zone: i + 1,
      name: z.name,
      low: i === 0 ? null : lo,
      high: hi,
      label: i === 0 ? `< ${Math.round(z.high! * lthr)} bpm` : hi == null ? `> ${lo} bpm` : `${lo}–${hi} bpm`,
      if: midIf(z.low, z.high),
    };
  });
}

// ─── Athlete thresholds ───────────────────────────────────────────────────────

export const THRESHOLD_METRICS = [
  "ftp",
  "run_threshold_pace",
  "swim_css",
  "lthr_run",
  "lthr_bike",
  "max_hr",
  "resting_hr",
  "weight_kg",
  "vo2max",
] as const;
export type ThresholdMetric = (typeof THRESHOLD_METRICS)[number];

export const THRESHOLD_LABELS: Record<ThresholdMetric, string> = {
  ftp: "FTP",
  run_threshold_pace: "Threshold pace",
  swim_css: "CSS",
  lthr_run: "Run LTHR",
  lthr_bike: "Bike LTHR",
  max_hr: "Max HR",
  resting_hr: "Resting HR",
  weight_kg: "Weight",
  vo2max: "VO2max",
};

/** Current values the planner / analytics need. Every field may be missing for a new athlete. */
export interface Thresholds {
  ftp?: number | null;
  runThresholdPace?: number | null; // sec/km
  swimCss?: number | null; // sec/100m
  lthrRun?: number | null;
  lthrBike?: number | null;
  maxHr?: number | null;
  restingHr?: number | null;
  weightKg?: number | null;
  vo2max?: number | null;
}

export function thresholdsFromMap(values: Partial<Record<ThresholdMetric, number | null>>): Thresholds {
  return {
    ftp: values.ftp ?? null,
    runThresholdPace: values.run_threshold_pace ?? null,
    swimCss: values.swim_css ?? null,
    lthrRun: values.lthr_run ?? null,
    lthrBike: values.lthr_bike ?? null,
    maxHr: values.max_hr ?? null,
    restingHr: values.resting_hr ?? null,
    weightKg: values.weight_kg ?? null,
    vo2max: values.vo2max ?? null,
  };
}

/** Best-available LTHR for a sport, falling back through related values. */
export function effectiveLthr(t: Thresholds, sport: Sport): number | null {
  if (sport === "bike") return t.lthrBike ?? (t.lthrRun ? t.lthrRun - 5 : t.maxHr ? Math.round(t.maxHr * 0.86) : null);
  return t.lthrRun ?? (t.lthrBike ? t.lthrBike + 5 : t.maxHr ? Math.round(t.maxHr * 0.89) : null);
}

/**
 * Sensible defaults when an athlete has told us nothing — used only so plans render
 * targets; the UI flags these as estimates.
 */
export function defaultThresholds(level: string | null | undefined): Required<Pick<Thresholds, "ftp" | "runThresholdPace" | "swimCss">> {
  switch (level) {
    case "beginner":
      return { ftp: 150, runThresholdPace: 360, swimCss: 135 };
    case "advanced":
      return { ftp: 260, runThresholdPace: 250, swimCss: 95 };
    case "elite":
      return { ftp: 320, runThresholdPace: 215, swimCss: 80 };
    default:
      return { ftp: 200, runThresholdPace: 300, swimCss: 110 };
  }
}

// ─── Race definitions ─────────────────────────────────────────────────────────

export type RaceType =
  | "run_5k"
  | "run_10k"
  | "run_half"
  | "run_marathon"
  | "tri_sprint"
  | "tri_olympic"
  | "tri_703"
  | "tri_full"
  | "bike_event"
  | "swim_event"
  | "general";

export interface RaceDef {
  label: string;
  short: string;
  sports: Sport[];
  swimM?: number;
  bikeM?: number;
  runM?: number;
  /** Taper length in days. */
  taperDays: number;
}

export const RACES: Record<RaceType, RaceDef> = {
  run_5k: { label: "5K", short: "5K", sports: ["run"], runM: 5000, taperDays: 7 },
  run_10k: { label: "10K", short: "10K", sports: ["run"], runM: 10000, taperDays: 9 },
  run_half: { label: "Half Marathon", short: "Half", sports: ["run"], runM: 21097.5, taperDays: 12 },
  run_marathon: { label: "Marathon", short: "Marathon", sports: ["run"], runM: 42195, taperDays: 19 },
  tri_sprint: { label: "Sprint Triathlon", short: "Sprint", sports: ["swim", "bike", "run"], swimM: 750, bikeM: 20000, runM: 5000, taperDays: 7 },
  tri_olympic: { label: "Olympic Triathlon", short: "Olympic", sports: ["swim", "bike", "run"], swimM: 1500, bikeM: 40000, runM: 10000, taperDays: 10 },
  tri_703: { label: "Ironman 70.3", short: "70.3", sports: ["swim", "bike", "run"], swimM: 1900, bikeM: 90000, runM: 21097.5, taperDays: 12 },
  tri_full: { label: "Ironman", short: "Ironman", sports: ["swim", "bike", "run"], swimM: 3800, bikeM: 180000, runM: 42195, taperDays: 19 },
  bike_event: { label: "Cycling event", short: "Ride", sports: ["bike"], taperDays: 7 },
  swim_event: { label: "Swim event", short: "Swim", sports: ["swim"], taperDays: 7 },
  general: { label: "General fitness", short: "Fitness", sports: ["swim", "bike", "run"], taperDays: 0 },
};

/** Map legacy onboarding preset keys to planner race types. */
export function raceTypeFromPreset(key: string | null | undefined): RaceType | null {
  const map: Record<string, RaceType> = {
    run_5k: "run_5k",
    run_mile: "run_5k",
    run_10k: "run_10k",
    run_10mi: "run_half",
    run_half: "run_half",
    run_marathon: "run_marathon",
    run_ultra: "run_marathon",
    tri_sprint: "tri_sprint",
    tri_olympic: "tri_olympic",
    tri_703: "tri_703",
    tri_full: "tri_full",
    tri_aquabike: "tri_703",
    tri_duathlon: "tri_olympic",
    bike_crit: "bike_event",
    bike_tt: "bike_event",
    bike_granfondo: "bike_event",
    bike_century: "bike_event",
    bike_metric_century: "bike_event",
    bike_road_race: "bike_event",
    swim_pool_sprint: "swim_event",
    swim_pool_mid: "swim_event",
    swim_ow_short: "swim_event",
    swim_ow_long: "swim_event",
    swim_masters: "swim_event",
  };
  return key ? map[key] ?? null : null;
}

// ─── Race pacing (deterministic targets for race day) ────────────────────────

export interface RacePacing {
  swim?: { paceSec: number; timeSec: number; note: string };
  bike?: { powerLow: number; powerHigh: number; if: [number, number]; timeSec: number | null; note: string };
  run?: { paceSec: number; timeSec: number; note: string };
  totalSec?: number;
}

/** Race-day intensity for each leg. IF bands follow long-standing practice (e.g. IM bike 0.68–0.78 IF). */
const TRI_BIKE_IF: Partial<Record<RaceType, [number, number]>> = {
  tri_sprint: [0.9, 0.97],
  tri_olympic: [0.85, 0.92],
  tri_703: [0.76, 0.83],
  tri_full: [0.68, 0.76],
};

/** How much slower than open-race pace the run is after the bike. */
const TRI_RUN_FADE: Partial<Record<RaceType, number>> = {
  tri_sprint: 1.04,
  tri_olympic: 1.05,
  tri_703: 1.08,
  tri_full: 1.14,
};

/** Rough bike speed (m/s) at a given power on flat-ish course, via simple aero model. */
export function bikeSpeedAtPower(watts: number, systemMassKg = 85, cda = 0.3): number {
  const rho = 1.2;
  const crr = 0.005;
  const g = 9.81;
  let v = 8;
  for (let i = 0; i < 40; i++) {
    const p = 0.5 * rho * cda * v ** 3 + crr * systemMassKg * g * v;
    const dp = 1.5 * rho * cda * v ** 2 + crr * systemMassKg * g;
    v -= (p / 0.975 - watts) / (dp / 0.975);
  }
  return Math.max(v, 3);
}

export function racePacing(race: RaceType, t: Thresholds, level: string | null | undefined): RacePacing | null {
  const def = RACES[race];
  if (!def || race === "general") return null;
  const out: RacePacing = {};
  const lvlAdj = level === "beginner" ? -0.02 : level === "elite" ? 0.02 : 0;

  if (def.swimM && t.swimCss) {
    const factor = race === "tri_full" ? 1.08 : race === "tri_703" ? 1.05 : 1.02;
    const pace = t.swimCss * factor;
    out.swim = {
      paceSec: pace,
      timeSec: (def.swimM / 100) * pace,
      note: "Settle into a strong, sustainable rhythm — you should exit feeling like you held back.",
    };
  }
  if (def.bikeM && t.ftp) {
    const band = TRI_BIKE_IF[race] ?? [0.7, 0.8];
    const lo = band[0] + lvlAdj;
    const hi = band[1] + lvlAdj;
    const mid = ((lo + hi) / 2) * t.ftp;
    const speed = bikeSpeedAtPower(mid, (t.weightKg ?? 75) + 10);
    out.bike = {
      powerLow: Math.round(lo * t.ftp),
      powerHigh: Math.round(hi * t.ftp),
      if: [lo, hi],
      timeSec: def.bikeM / speed,
      note: "Cap surges on climbs at ~Z4; keep NP inside the band so the run stays on.",
    };
  }
  if (def.runM && t.runThresholdPace) {
    const vdot = vdotFromThresholdPace(t.runThresholdPace);
    const open = predictRaceSeconds(vdot, def.runM) / (def.runM / 1000);
    const fade = def.sports.length > 1 ? TRI_RUN_FADE[race] ?? 1 : 1;
    const pace = open * fade;
    out.run = {
      paceSec: pace,
      timeSec: pace * (def.runM / 1000),
      note:
        def.sports.length > 1
          ? "First 2–3 km deliberately easy while the legs switch over, then lock in."
          : "Even pacing — first half no faster than target.",
    };
  }
  if (def.sports.length > 1) {
    const transitions = race === "tri_full" ? 600 : race === "tri_703" ? 360 : 240;
    const total = (out.swim?.timeSec ?? 0) + (out.bike?.timeSec ?? 0) + (out.run?.timeSec ?? 0);
    if (out.swim && out.bike && out.run) out.totalSec = total + transitions;
  } else if (out.run) {
    out.totalSec = out.run.timeSec;
  }
  return out;
}
