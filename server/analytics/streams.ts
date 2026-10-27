/**
 * Derive coaching metrics from activity time-series (Strava streams).
 */
import {
  type Sport,
  type Thresholds,
  POWER_ZONE_DEFS,
  RUN_PACE_ZONE_DEFS,
  SWIM_ZONE_DEFS,
  HR_ZONE_DEFS,
  effectiveLthr,
} from "@shared/physiology";

export interface Streams {
  time?: number[];
  heartrate?: number[];
  watts?: number[];
  velocity_smooth?: number[];
  distance?: number[];
  moving?: boolean[];
  cadence?: number[];
  altitude?: number[];
}

export interface StreamMetrics {
  hrZoneSec: number[] | null;
  powerZoneSec: number[] | null;
  paceZoneSec: number[] | null;
  normalizedPower: number | null;
  /** Mean-max power (bike) keyed by seconds, e.g. { "60": 380, "1200": 265 }. */
  powerCurve: Record<string, number> | null;
  /** Fastest time (s) for standard distances (run), keyed by meters. */
  paceBests: Record<string, number> | null;
  /** Aerobic decoupling (Pa:HR) in percent; <5 is good durability. */
  decoupling: number | null;
  /** Output per heartbeat: NP/avgHR (bike) or speed(m/min)/avgHR (run). */
  efficiencyFactor: number | null;
}

const POWER_CURVE_SECS = [5, 15, 30, 60, 180, 300, 600, 1200, 1800, 3600, 5400];
const RUN_BEST_DISTANCES = [400, 1000, 1609, 3000, 5000, 10000, 21097];

/** Resample to 1 Hz, carrying values forward over gaps up to 10 s (longer gaps = stopped). */
function toPerSecond(time: number[], values: number[] | undefined, moving?: boolean[]): (number | null)[] | null {
  if (!values || values.length !== time.length || !time.length) return null;
  const end = time[time.length - 1];
  const out: (number | null)[] = new Array(end + 1).fill(null);
  for (let i = 0; i < time.length; i++) {
    const t0 = time[i];
    const t1 = i + 1 < time.length ? time[i + 1] : t0 + 1;
    const isMoving = moving ? moving[i] !== false : true;
    const span = Math.min(t1 - t0, 10);
    for (let t = t0; t < t0 + span && t <= end; t++) out[t] = isMoving ? values[i] : null;
  }
  return out;
}

function zoneIndex(defs: { low: number; high: number | null }[], ratio: number): number {
  for (let i = defs.length - 1; i >= 0; i--) if (ratio >= defs[i].low) return i;
  return 0;
}

function rollingMeanMax(series: (number | null)[], window: number): number | null {
  if (series.length < window) return null;
  let sum = 0;
  let best = -1;
  for (let i = 0; i < series.length; i++) {
    sum += series[i] ?? 0;
    if (i >= window) sum -= series[i - window] ?? 0;
    if (i >= window - 1) best = Math.max(best, sum / window);
  }
  return best > 0 ? Math.round(best) : null;
}

function normalizedPower(watts: (number | null)[]): number | null {
  if (watts.length < 60) return null;
  let sum = 0;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i] ?? 0;
    if (i >= 30) sum -= watts[i - 30] ?? 0;
    if (i >= 29) {
      acc += Math.pow(sum / 30, 4);
      n++;
    }
  }
  return n ? Math.round(Math.pow(acc / n, 0.25)) : null;
}

function fastestForDistance(dist: number[], time: number[], meters: number): number | null {
  if (!dist.length || dist[dist.length - 1] < meters) return null;
  let best = Infinity;
  let j = 0;
  for (let i = 0; i < dist.length; i++) {
    while (j < dist.length && dist[j] - dist[i] < meters) j++;
    if (j >= dist.length) break;
    // interpolate the exact crossing
    const over = dist[j] - dist[i] - meters;
    const segD = dist[j] - dist[j - 1] || 1;
    const t = time[j] - time[i] - (over / segD) * (time[j] - time[j - 1]);
    if (t > 0 && t < best) best = t;
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

export function computeStreamMetrics(sport: Sport | null, s: Streams, th: Thresholds): StreamMetrics {
  const empty: StreamMetrics = {
    hrZoneSec: null,
    powerZoneSec: null,
    paceZoneSec: null,
    normalizedPower: null,
    powerCurve: null,
    paceBests: null,
    decoupling: null,
    efficiencyFactor: null,
  };
  if (!s.time?.length || !sport) return empty;
  const time = s.time;
  const hr = toPerSecond(time, s.heartrate, s.moving);
  const watts = toPerSecond(time, s.watts); // include coasting zeros for NP
  const vel = toPerSecond(time, s.velocity_smooth, s.moving);
  const out = { ...empty };

  const lthr = effectiveLthr(th, sport);
  if (hr && lthr) {
    const defs = HR_ZONE_DEFS[sport === "bike" ? "bike" : "run"];
    const z = new Array(defs.length).fill(0);
    for (const h of hr) if (h != null && h > 40) z[zoneIndex(defs, h / lthr)]++;
    out.hrZoneSec = z;
  }

  if (sport === "bike" && watts) {
    out.normalizedPower = normalizedPower(watts);
    const curve: Record<string, number> = {};
    for (const w of POWER_CURVE_SECS) {
      const v = rollingMeanMax(watts, w);
      if (v) curve[String(w)] = v;
    }
    out.powerCurve = Object.keys(curve).length ? curve : null;
    if (th.ftp) {
      const z = new Array(POWER_ZONE_DEFS.length).fill(0);
      for (const w of watts) if (w != null && w > 0) z[zoneIndex(POWER_ZONE_DEFS, w / th.ftp)]++;
      out.powerZoneSec = z;
    }
  }

  if ((sport === "run" || sport === "swim") && vel) {
    const ref = sport === "run" ? (th.runThresholdPace ? 1000 / th.runThresholdPace : null) : th.swimCss ? 100 / th.swimCss : null;
    if (ref) {
      const defs = sport === "run" ? RUN_PACE_ZONE_DEFS : SWIM_ZONE_DEFS;
      const z = new Array(defs.length).fill(0);
      for (const v of vel) if (v != null && v > 0.5) z[zoneIndex(defs, v / ref)]++;
      out.paceZoneSec = z;
    }
  }

  if (sport === "run" && s.distance?.length === time.length) {
    const bests: Record<string, number> = {};
    for (const m of RUN_BEST_DISTANCES) {
      const t = fastestForDistance(s.distance, time, m);
      if (t) bests[String(m)] = t;
    }
    out.paceBests = Object.keys(bests).length ? bests : null;
  }

  // Decoupling + EF over moving portion (skip first 10 min of warm-up).
  const output = sport === "bike" ? watts : vel;
  if (hr && output) {
    const pairs: [number, number][] = [];
    for (let i = 600; i < Math.min(hr.length, output.length); i++) {
      const h = hr[i];
      const o = output[i];
      if (h != null && h > 60 && o != null && o > (sport === "bike" ? 0 : 0.8)) pairs.push([o, h]);
    }
    // Decoupling only means something for steady efforts (VI ≤ 1.06 bike, low pace variation run).
    const outs = pairs.map((p) => p[0]);
    const mean = outs.reduce((a, b) => a + b, 0) / Math.max(1, outs.length);
    const cv = Math.sqrt(outs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, outs.length)) / (mean || 1);
    const steady = sport === "bike" ? (out.normalizedPower ?? 0) / (mean || 1) <= 1.06 : cv <= 0.12;
    if (pairs.length >= 1800 && steady) {
      const half = Math.floor(pairs.length / 2);
      const ef = (arr: [number, number][]) => arr.reduce((a, p) => a + p[0], 0) / arr.reduce((a, p) => a + p[1], 0);
      const ef1 = ef(pairs.slice(0, half));
      const ef2 = ef(pairs.slice(half));
      out.decoupling = Math.round(((ef1 - ef2) / ef1) * 1000) / 10;
    }
    if (pairs.length >= 600) {
      const avgHr = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
      if (sport === "bike") {
        const np = out.normalizedPower;
        if (np) out.efficiencyFactor = Math.round((np / avgHr) * 100) / 100;
      } else {
        const avgV = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
        out.efficiencyFactor = Math.round(((avgV * 60) / avgHr) * 100) / 100;
      }
    }
  }
  return out;
}
