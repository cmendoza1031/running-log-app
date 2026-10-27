/**
 * Structured workouts.
 *
 * Targets are stored RELATIVE to the athlete's thresholds (zones or % of FTP / threshold
 * speed / CSS / LTHR), so when a threshold changes every future workout re-targets itself.
 * Absolute targets (watts, pace, bpm) are also supported for when the athlete asks for them.
 *
 * A compact text DSL is the interchange format with the LLM and the planner:
 *
 *   15min Z2 warmup
 *   4x(8min 95-100% FTP, 3min Z1)
 *   10min Z1 cooldown
 *
 * Grammar (one step per line or separated by ";"):
 *   step    := duration target? intent? label?
 *   repeat  := N x ( step , step , ... )
 *   duration:= 10min | 90s | 1h | 1h30min | 1:30:00 | 400m | 1.5km | 2mi | 100y | open
 *   target  := Z2 | Z2-Z3 | 88-93% FTP | 95% TP | 100% CSS | 85-89% LTHR | RPE 6
 *            | 250W | 240-260W | 4:30/km | 7:05/mi | 1:40/100m | 1:32/100y | 140-150bpm | rest | easy
 *   intent  := warmup | wu | cooldown | cd | rest | recovery
 *   label   := "any text in double quotes"
 * Note: minutes MUST be written "min" (or "'"), because "m" means meters.
 * TP = threshold pace (percent of threshold SPEED: 105% TP is faster than threshold).
 */

import {
  type Sport,
  type Thresholds,
  type UnitSystem,
  type PoolUnit,
  POWER_ZONE_DEFS,
  RUN_PACE_ZONE_DEFS,
  SWIM_ZONE_DEFS,
  HR_ZONE_DEFS,
  METERS_PER_MILE,
  METERS_PER_YARD,
  effectiveLthr,
  formatClock,
  formatRunPace,
  formatSwimPace,
  formatDuration,
  runPaceToDisplaySec,
  swimPaceToDisplaySec,
} from "./physiology";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Intent = "warmup" | "work" | "recovery" | "cooldown" | "rest";

export type Duration =
  | { type: "time"; sec: number }
  | { type: "distance"; m: number }
  | { type: "open" };

export type TargetMetric = "power" | "pace" | "hr" | "css";

export type Target =
  | { type: "zone"; zoneLow: number; zoneHigh: number; metric?: TargetMetric }
  | { type: "percent"; metric: TargetMetric; low: number; high: number } // fractions, e.g. 0.95–1.0
  | { type: "power"; low: number; high: number } // watts
  | { type: "pace"; low: number; high: number } // sec/km (run) or sec/100m (swim); low = faster
  | { type: "hr"; low: number; high: number } // bpm
  | { type: "rpe"; value: number }
  | { type: "open" };

export interface Step {
  kind: "step";
  intent: Intent;
  duration: Duration;
  target: Target;
  label?: string;
}

export interface Repeat {
  kind: "repeat";
  count: number;
  steps: Step[];
}

export type WorkoutNode = Step | Repeat;

export interface WorkoutStructure {
  sport: Sport;
  nodes: WorkoutNode[];
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

export class WorkoutParseError extends Error {}

function splitTopLevel(input: string, seps: string[]): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = "";
  for (const ch of input) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && (ch === "(" || ch === "[")) depth++;
    if (!inQuote && (ch === ")" || ch === "]")) depth--;
    if (!inQuote && depth === 0 && seps.includes(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (depth !== 0) throw new WorkoutParseError(`Unbalanced parentheses in "${input.trim()}"`);
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const INTENT_WORDS: Record<string, Intent> = {
  warmup: "warmup",
  "warm-up": "warmup",
  wu: "warmup",
  cooldown: "cooldown",
  "cool-down": "cooldown",
  cd: "cooldown",
  rest: "rest",
  recovery: "recovery",
  rec: "recovery",
  recover: "recovery",
};

function parseDuration(tok: string): { dur: Duration; rest: string } | null {
  const t = tok.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^open\b/i))) return { dur: { type: "open" }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+):(\d{2}):(\d{2})\b/)))
    return { dur: { type: "time", sec: +m[1] * 3600 + +m[2] * 60 + +m[3] }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h(?:r|rs|ours?)?\s*(?:(\d+)\s*(?:min|m(?![a-z])|'))?/i))) {
    const sec = parseFloat(m[1]) * 3600 + (m[2] ? parseInt(m[2], 10) * 60 : 0);
    return { dur: { type: "time", sec }, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?|')(?![a-z])/i)))
    return { dur: { type: "time", sec: parseFloat(m[1]) * 60 }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds?|")(?![a-z])/i)))
    return { dur: { type: "time", sec: parseFloat(m[1]) }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*km(?![a-z])/i)))
    return { dur: { type: "distance", m: parseFloat(m[1]) * 1000 }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:mi|miles?)(?![a-z])/i)))
    return { dur: { type: "distance", m: parseFloat(m[1]) * METERS_PER_MILE }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:y|yd|yds|yards?)(?![a-z])/i)))
    return { dur: { type: "distance", m: parseFloat(m[1]) * METERS_PER_YARD }, rest: t.slice(m[0].length) };
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)(?![a-z])/i)))
    return { dur: { type: "distance", m: parseFloat(m[1]) }, rest: t.slice(m[0].length) };
  return null;
}

function paceToSec(min: string, sec: string): number {
  return parseInt(min, 10) * 60 + parseInt(sec, 10);
}

/** Converts a pace given in `unit` into canonical sec/km (run) or sec/100m (swim). */
function canonicalPace(sec: number, unit: string): number {
  switch (unit) {
    case "mi":
      return sec / (METERS_PER_MILE / 1000);
    case "100y":
    case "100yd":
      return sec / METERS_PER_YARD;
    default:
      return sec;
  }
}

function parseTarget(src: string, sport: Sport): { target: Target | null; intent: Intent | null; rest: string } {
  let t = src.trim();
  let m: RegExpMatchArray | null;

  if ((m = t.match(/^@\s*/))) t = t.slice(m[0].length);

  if ((m = t.match(/^z(\d)(?:\s*-\s*z?(\d))?(?![\d])(?:\s+(hr|power|pace))?(?![a-z])/i))) {
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    const metric = m[3] ? (m[3].toLowerCase() as TargetMetric) : undefined;
    const target: Target = { type: "zone", zoneLow: Math.min(a, b), zoneHigh: Math.max(a, b) };
    if (metric) target.metric = metric;
    return { target, intent: null, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%\s*(ftp|tp|threshold pace|css|lthr|thr)\b/i))) {
    const lo = parseFloat(m[1]) / 100;
    const hi = m[2] ? parseFloat(m[2]) / 100 : lo;
    const key = m[3].toLowerCase();
    const metric: TargetMetric =
      key === "ftp" ? "power" : key === "css" ? "css" : key === "lthr" || key === "thr" ? "hr" : sport === "swim" ? "css" : "pace";
    return { target: { type: "percent", metric, low: Math.min(lo, hi), high: Math.max(lo, hi) }, intent: null, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^(\d{2,4})(?:\s*-\s*(\d{2,4}))?\s*w\b/i))) {
    const lo = +m[1];
    const hi = m[2] ? +m[2] : lo;
    return { target: { type: "power", low: Math.min(lo, hi), high: Math.max(lo, hi) }, intent: null, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^(\d{2,3})(?:\s*-\s*(\d{2,3}))?\s*bpm\b/i))) {
    const lo = +m[1];
    const hi = m[2] ? +m[2] : lo;
    return { target: { type: "hr", low: Math.min(lo, hi), high: Math.max(lo, hi) }, intent: null, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?\s*\/\s*(km|mi|100m|100yd|100y)\b/i))) {
    const unit = m[5].toLowerCase();
    const a = canonicalPace(paceToSec(m[1], m[2]), unit);
    const b = m[3] ? canonicalPace(paceToSec(m[3], m[4]), unit) : a;
    // single value → ±2% band
    const lo = m[3] ? Math.min(a, b) : a * 0.985;
    const hi = m[3] ? Math.max(a, b) : a * 1.015;
    return { target: { type: "pace", low: lo, high: hi }, intent: null, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^rpe\s*(\d{1,2})\b/i))) {
    return { target: { type: "rpe", value: Math.min(10, Math.max(1, +m[1])) }, intent: null, rest: t.slice(m[0].length) };
  }
  if ((m = t.match(/^(rest|easy|open)\b/i))) {
    const w = m[1].toLowerCase();
    if (w === "rest") return { target: { type: "open" }, intent: "rest", rest: t.slice(m[0].length) };
    if (w === "easy") return { target: { type: "zone", zoneLow: 1, zoneHigh: 2 }, intent: null, rest: t.slice(m[0].length) };
    return { target: { type: "open" }, intent: null, rest: t.slice(m[0].length) };
  }
  return { target: null, intent: null, rest: t };
}

function parseStep(src: string, sport: Sport): Step {
  let text = src.trim();
  let label: string | undefined;
  const q = text.match(/"([^"]*)"/);
  if (q) {
    label = q[1].trim() || undefined;
    text = (text.slice(0, q.index) + text.slice(q.index! + q[0].length)).trim();
  }

  // Leading intent word ("WU 15min Z2", "cooldown 10min")
  let intent: Intent | null = null;
  const lead = text.match(/^([a-z-]+)\s+/i);
  if (lead && INTENT_WORDS[lead[1].toLowerCase()]) {
    intent = INTENT_WORDS[lead[1].toLowerCase()];
    text = text.slice(lead[0].length);
  }

  const d = parseDuration(text);
  if (!d) throw new WorkoutParseError(`Couldn't read a duration/distance at the start of "${src.trim()}" (use e.g. 10min, 90s, 400m, 1km, 2mi, 100y)`);
  let rest = d.rest.trim();

  const tg = parseTarget(rest, sport);
  let target: Target = tg.target ?? { type: "open" };
  if (tg.intent) intent = intent ?? tg.intent;
  rest = tg.rest.trim();

  // Trailing intent word
  const trail = rest.match(/^([a-z-]+)\b/i);
  if (trail && INTENT_WORDS[trail[1].toLowerCase()]) {
    intent = intent ?? INTENT_WORDS[trail[1].toLowerCase()];
    rest = rest.slice(trail[0].length).trim();
  }
  if (rest && !label) {
    if (/^[\w\s,.'&/-]+$/.test(rest) && rest.length <= 60) label = rest;
    else throw new WorkoutParseError(`Didn't understand "${rest}" in "${src.trim()}"`);
  }
  if (!tg.target && intent === "rest") target = { type: "open" };
  return { kind: "step", intent: intent ?? "work", duration: d.dur, target, label };
}

export function parseWorkout(dsl: string, sport: Sport): WorkoutStructure {
  const lines = splitTopLevel(dsl.replace(/\r/g, ""), ["\n", ";", "+"]);
  if (!lines.length) throw new WorkoutParseError("Workout is empty");
  const nodes: WorkoutNode[] = [];
  for (const line of lines) {
    const rep = line.match(/^(\d+)\s*[x×]\s*[([]([\s\S]*)[)\]]\s*$/i);
    if (rep) {
      const count = parseInt(rep[1], 10);
      if (count < 1 || count > 60) throw new WorkoutParseError(`Repeat count ${count} out of range in "${line}"`);
      const inner = splitTopLevel(rep[2], [",", ";", "\n"]).map((s) => parseStep(s, sport));
      if (!inner.length) throw new WorkoutParseError(`Empty repeat in "${line}"`);
      nodes.push({ kind: "repeat", count, steps: inner });
      continue;
    }
    // "6x100m 100% CSS" shorthand without parentheses → repeat of a single step
    const single = line.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    if (single && parseDuration(single[2])) {
      nodes.push({ kind: "repeat", count: parseInt(single[1], 10), steps: [parseStep(single[2], sport)] });
      continue;
    }
    nodes.push(parseStep(line, sport));
  }
  // Infer warmup/cooldown for first/last plain easy steps when unspecified.
  const first = nodes[0];
  if (first?.kind === "step" && first.intent === "work" && nodes.length > 2 && isEasyTarget(first.target)) first.intent = "warmup";
  const last = nodes[nodes.length - 1];
  if (last?.kind === "step" && last.intent === "work" && nodes.length > 2 && isEasyTarget(last.target)) last.intent = "cooldown";
  // Recovery steps inside repeats
  for (const n of nodes) {
    if (n.kind === "repeat" && n.steps.length > 1) {
      for (const s of n.steps.slice(1)) if (s.intent === "work" && isEasyTarget(s.target)) s.intent = "recovery";
    }
  }
  return { sport, nodes };
}

function isEasyTarget(t: Target): boolean {
  if (t.type === "zone") return t.zoneHigh <= 2;
  if (t.type === "percent") return t.high <= (t.metric === "power" ? 0.75 : 0.85);
  if (t.type === "rpe") return t.value <= 3;
  return t.type === "open";
}

// ─── Serialization (structure → DSL) ─────────────────────────────────────────

function durToDsl(d: Duration, sport: Sport, pool: PoolUnit): string {
  if (d.type === "open") return "open";
  if (d.type === "time") {
    if (d.sec % 3600 === 0 && d.sec >= 3600) return `${d.sec / 3600}h`;
    if (d.sec >= 60 && d.sec % 60 === 0) return `${d.sec / 60}min`;
    return `${Math.round(d.sec)}s`;
  }
  if (sport === "swim" && pool === "yards") return `${Math.round(d.m / METERS_PER_YARD)}y`;
  if (d.m >= 1000 && sport !== "swim") return `${+(d.m / 1000).toFixed(2)}km`;
  return `${Math.round(d.m)}m`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}`;
}

function targetToDsl(t: Target): string {
  switch (t.type) {
    case "zone": {
      const z = t.zoneLow === t.zoneHigh ? `Z${t.zoneLow}` : `Z${t.zoneLow}-Z${t.zoneHigh}`;
      return t.metric === "hr" ? `${z} HR` : z;
    }
    case "percent": {
      const unit = t.metric === "power" ? "FTP" : t.metric === "css" ? "CSS" : t.metric === "hr" ? "LTHR" : "TP";
      return t.low === t.high ? `${pct(t.low)}% ${unit}` : `${pct(t.low)}-${pct(t.high)}% ${unit}`;
    }
    case "power":
      return t.low === t.high ? `${t.low}W` : `${t.low}-${t.high}W`;
    case "hr":
      return `${t.low}-${t.high}bpm`;
    case "pace":
      return `${formatClock(t.low)}-${formatClock(t.high)}/km`;
    case "rpe":
      return `RPE ${t.value}`;
    case "open":
      return "";
  }
}

function stepToDsl(s: Step, sport: Sport, pool: PoolUnit): string {
  const parts = [durToDsl(s.duration, sport, pool)];
  if (s.intent === "rest") parts.push("rest");
  else {
    const tg = targetToDsl(s.target);
    if (tg) parts.push(tg);
    if (s.intent === "warmup" || s.intent === "cooldown") parts.push(s.intent);
  }
  if (s.label) parts.push(`"${s.label}"`);
  return parts.join(" ");
}

export function structureToDsl(ws: WorkoutStructure, pool: PoolUnit = "meters"): string {
  return ws.nodes
    .map((n) =>
      n.kind === "repeat"
        ? `${n.count}x(${n.steps.map((s) => stepToDsl(s, ws.sport, pool)).join(", ")})`
        : stepToDsl(n, ws.sport, pool),
    )
    .join("\n");
}

// ─── Resolving targets against thresholds ────────────────────────────────────

export interface ResolvedTarget {
  /** Which metric the watch should target. */
  metric: "power" | "pace" | "hr" | "rpe" | "open";
  /** Absolute range: watts, sec/km (run) or sec/100m (swim) — low=faster for pace, bpm. */
  low: number | null;
  high: number | null;
  /** Intensity factor used for load estimation (fraction of threshold). */
  intensity: number;
  /** Zone number (1..7) for coloring. */
  zone: number;
}

const RPE_IF = [0, 0.5, 0.55, 0.62, 0.68, 0.74, 0.8, 0.86, 0.93, 1.0, 1.08];

function zoneDefsFor(sport: Sport, metric: TargetMetric | undefined) {
  if (metric === "hr") return HR_ZONE_DEFS[sport === "bike" ? "bike" : "run"];
  if (sport === "bike") return POWER_ZONE_DEFS;
  if (sport === "swim") return SWIM_ZONE_DEFS;
  return RUN_PACE_ZONE_DEFS;
}

function zoneForIntensity(sport: Sport, intensity: number): number {
  const defs = sport === "bike" ? POWER_ZONE_DEFS : sport === "swim" ? SWIM_ZONE_DEFS : RUN_PACE_ZONE_DEFS;
  for (let i = defs.length - 1; i >= 0; i--) if (intensity >= defs[i].low) return i + 1;
  return 1;
}

/** Map intensity (fraction of threshold) into a 1–5 color zone scale regardless of sport. */
export function colorZone(sport: Sport, intensity: number): number {
  return Math.min(5, zoneForIntensity(sport, intensity));
}

export function resolveTarget(t: Target, sport: Sport, th: Thresholds): ResolvedTarget {
  const lthr = effectiveLthr(th, sport);
  const threshSpeedTarget = (lo: number, hi: number): ResolvedTarget => {
    const intensity = (lo + hi) / 2;
    const zone = colorZone(sport, intensity);
    if (sport === "bike") {
      if (th.ftp) return { metric: "power", low: Math.round(lo * th.ftp), high: Math.round(hi * th.ftp), intensity, zone };
    } else if (sport === "run") {
      if (th.runThresholdPace) return { metric: "pace", low: th.runThresholdPace / hi, high: th.runThresholdPace / lo, intensity, zone };
    } else if (th.swimCss) {
      return { metric: "pace", low: th.swimCss / hi, high: th.swimCss / lo, intensity, zone };
    }
    // No threshold: fall back to HR if available
    if (lthr) {
      const hrLo = sport === "bike" ? 0.62 + lo * 0.36 : 0.66 + lo * 0.33;
      const hrHi = sport === "bike" ? 0.62 + hi * 0.36 : 0.66 + hi * 0.33;
      return { metric: "hr", low: Math.round(hrLo * lthr), high: Math.round(Math.min(hrHi, 1.06) * lthr), intensity, zone };
    }
    return { metric: "rpe", low: null, high: null, intensity, zone };
  };

  switch (t.type) {
    case "zone": {
      const defs = zoneDefsFor(sport, t.metric);
      const a = defs[Math.min(t.zoneLow, defs.length) - 1];
      const b = defs[Math.min(t.zoneHigh, defs.length) - 1];
      const lo = a.low === 0 ? Math.max((a.high ?? 0.6) - 0.12, 0.45) : a.low;
      const hi = b.high ?? b.low + 0.12;
      if (t.metric === "hr" && lthr) {
        return {
          metric: "hr",
          low: Math.round(lo * lthr),
          high: Math.round(hi * lthr),
          intensity: sport === "bike" ? (lo + hi) / 2 - 0.1 : (lo + hi) / 2 - 0.08,
          zone: Math.min(t.zoneHigh, 5),
        };
      }
      return threshSpeedTarget(lo, hi);
    }
    case "percent": {
      if (t.metric === "hr") {
        const intensity = Math.max(0.5, (t.low + t.high) / 2 - 0.1);
        if (lthr) return { metric: "hr", low: Math.round(t.low * lthr), high: Math.round(t.high * lthr), intensity, zone: colorZone(sport, intensity) };
        return { metric: "rpe", low: null, high: null, intensity, zone: colorZone(sport, intensity) };
      }
      return threshSpeedTarget(t.low, t.high);
    }
    case "power": {
      const intensity = th.ftp ? (t.low + t.high) / 2 / th.ftp : 0.75;
      return { metric: "power", low: t.low, high: t.high, intensity, zone: colorZone(sport, intensity) };
    }
    case "pace": {
      const ref = sport === "swim" ? th.swimCss : th.runThresholdPace;
      const mid = (t.low + t.high) / 2;
      const intensity = ref ? ref / mid : 0.8;
      return { metric: "pace", low: t.low, high: t.high, intensity, zone: colorZone(sport, intensity) };
    }
    case "hr": {
      const intensity = lthr ? Math.max(0.5, (t.low + t.high) / 2 / lthr - 0.1) : 0.75;
      return { metric: "hr", low: t.low, high: t.high, intensity, zone: colorZone(sport, intensity) };
    }
    case "rpe": {
      const intensity = RPE_IF[t.value] ?? 0.7;
      // Color by perceived effort bands (RPE 1-2 Z1 … 9-10 Z5), not by the load estimate.
      return { metric: "rpe", low: null, high: null, intensity, zone: Math.min(5, Math.max(1, Math.ceil(t.value / 2))) };
    }
    case "open":
      return { metric: "open", low: null, high: null, intensity: 0.55, zone: 1 };
  }
}

// ─── Estimation (duration, distance, load) ───────────────────────────────────

function speedFor(sport: Sport, r: ResolvedTarget, th: Thresholds): number {
  // m/s
  if (r.metric === "pace" && r.low && r.high) {
    const secPerUnit = (r.low + r.high) / 2;
    return sport === "swim" ? 100 / secPerUnit : 1000 / secPerUnit;
  }
  if (sport === "swim") return 100 / ((th.swimCss ?? 110) / Math.max(r.intensity, 0.7));
  if (sport === "run") return 1000 / ((th.runThresholdPace ?? 300) / Math.max(r.intensity, 0.6));
  // bike: rough speed from intensity
  return 5 + 4 * r.intensity;
}

export interface FlatStep {
  intent: Intent;
  seconds: number;
  meters: number;
  resolved: ResolvedTarget;
  label?: string;
  /** Human-readable target in athlete units. */
  targetText: string;
  /** Original duration definition. */
  duration: Duration;
  repeatIndex?: { rep: number; of: number };
}

export interface DisplayPrefs {
  units: UnitSystem;
  pool: PoolUnit;
}

export function targetText(sport: Sport, r: ResolvedTarget, t: Target, prefs: DisplayPrefs): string {
  if (t.type === "open" || r.metric === "open") return "Open";
  const zoneTxt = t.type === "zone" ? (t.zoneLow === t.zoneHigh ? `Z${t.zoneLow}` : `Z${t.zoneLow}–${t.zoneHigh}`) : null;
  let abs = "";
  if (r.metric === "power") abs = r.low === r.high ? `${r.low} W` : `${r.low}–${r.high} W`;
  else if (r.metric === "pace" && r.low && r.high) {
    const same = Math.abs(r.high - r.low) < 1;
    if (same) abs = sport === "swim" ? formatSwimPace(r.low, prefs.pool) : formatRunPace(r.low, prefs.units);
    else if (sport === "swim") {
      abs = `${formatSwimPace(r.high, prefs.pool, false)}–${formatSwimPace(r.low, prefs.pool)}`;
    } else {
      abs = `${formatRunPace(r.high, prefs.units, false)}–${formatRunPace(r.low, prefs.units)}`;
    }
  } else if (r.metric === "hr") abs = `${r.low}–${r.high} bpm`;
  else if (r.metric === "rpe") abs = t.type === "rpe" ? `RPE ${t.value}` : `RPE ${Math.round(r.intensity * 10)}`;
  if (zoneTxt && abs) return `${zoneTxt} · ${abs}`;
  return abs || zoneTxt || "Open";
}

export function flattenWorkout(ws: WorkoutStructure, th: Thresholds, prefs: DisplayPrefs): FlatStep[] {
  const out: FlatStep[] = [];
  const push = (s: Step, repeatIndex?: { rep: number; of: number }) => {
    const r = resolveTarget(s.target, ws.sport, th);
    const speed = speedFor(ws.sport, r, th);
    let seconds: number;
    let meters: number;
    if (s.duration.type === "time") {
      seconds = s.duration.sec;
      meters = seconds * (s.intent === "rest" ? 0 : speed);
    } else if (s.duration.type === "distance") {
      meters = s.duration.m;
      seconds = meters / speed;
    } else {
      seconds = s.intent === "rest" ? 60 : 300;
      meters = s.intent === "rest" ? 0 : seconds * speed;
    }
    out.push({
      intent: s.intent,
      seconds,
      meters,
      resolved: s.intent === "rest" ? { ...r, intensity: 0, zone: 1 } : r,
      label: s.label,
      targetText: s.intent === "rest" ? "Rest" : targetText(ws.sport, r, s.target, prefs),
      duration: s.duration,
      repeatIndex,
    });
  };
  for (const n of ws.nodes) {
    if (n.kind === "step") push(n);
    else for (let i = 0; i < n.count; i++) for (const s of n.steps) push(s, { rep: i + 1, of: n.count });
  }
  return out;
}

export interface WorkoutSummary {
  seconds: number;
  meters: number;
  tss: number;
  intensityFactor: number;
}

export function summarizeWorkout(ws: WorkoutStructure, th: Thresholds, prefs: DisplayPrefs = { units: "metric", pool: "meters" }): WorkoutSummary {
  const flat = flattenWorkout(ws, th, prefs);
  let seconds = 0;
  let meters = 0;
  let load = 0;
  let sumI4 = 0;
  for (const f of flat) {
    seconds += f.seconds;
    meters += f.meters;
    const i = f.resolved.intensity;
    const exp = ws.sport === "swim" ? 3 : 2;
    load += (f.seconds / 3600) * Math.pow(i, exp) * 100;
    sumI4 += f.seconds * Math.pow(i, 4);
  }
  const intensityFactor = seconds > 0 ? Math.pow(sumI4 / seconds, 0.25) : 0;
  return { seconds, meters, tss: Math.round(load), intensityFactor: Math.round(intensityFactor * 100) / 100 };
}

/** One-line human description, e.g. "15m WU · 4×(8m @ 243–256 W / 3m easy) · 10m CD". */
export function describeWorkout(ws: WorkoutStructure, th: Thresholds, prefs: DisplayPrefs): string {
  const stepTxt = (s: Step) => {
    const r = resolveTarget(s.target, ws.sport, th);
    const d =
      s.duration.type === "time"
        ? compactTime(s.duration.sec)
        : s.duration.type === "distance"
          ? ws.sport === "swim"
            ? prefs.pool === "yards"
              ? `${Math.round(s.duration.m / METERS_PER_YARD)}yd`
              : `${Math.round(s.duration.m)}m`
            : prefs.units === "imperial"
              ? `${+(s.duration.m / METERS_PER_MILE).toFixed(2)}mi`
              : s.duration.m >= 1000
                ? `${+(s.duration.m / 1000).toFixed(2)}km`
                : `${Math.round(s.duration.m)}m`
          : "open";
    if (s.intent === "rest") return `${d} rest`;
    const tt = targetText(ws.sport, r, s.target, prefs);
    const tag = s.intent === "warmup" ? " WU" : s.intent === "cooldown" ? " CD" : "";
    return `${d}${tag} ${tt === "Open" ? "" : `@ ${tt}`}`.trim();
  };
  return ws.nodes
    .map((n) => (n.kind === "repeat" ? `${n.count}×(${n.steps.map(stepToDslHuman(stepTxt)).join(" / ")})` : stepTxt(n)))
    .join(" · ");
}

/** Unambiguous short duration: "45s", "90s", "2:30", "8min", "1h30". ("m" alone could read as meters/miles.) */
export function compactTime(sec: number): string {
  const s = Math.round(sec);
  if (s < 120 && s % 60 !== 0) return `${s}s`;
  if (s < 600 && s % 60 !== 0) return formatClock(s);
  if (s < 3600) return `${Math.round(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function stepToDslHuman(fn: (s: Step) => string) {
  return (s: Step) => fn(s);
}

export function isValidStructure(x: unknown): x is WorkoutStructure {
  return !!x && typeof x === "object" && Array.isArray((x as WorkoutStructure).nodes) && typeof (x as WorkoutStructure).sport === "string";
}

/** Display seconds for a pace in athlete units (helper for UIs). */
export function paceDisplaySec(sport: Sport, canonical: number, prefs: DisplayPrefs): number {
  return sport === "swim" ? swimPaceToDisplaySec(canonical, prefs.pool) : runPaceToDisplaySec(canonical, prefs.units);
}
