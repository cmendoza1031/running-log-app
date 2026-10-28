/**
 * Periodized plan generator.
 *
 *  1. Macrocycle: base → build → peak → taper → race, with a recovery week after every
 *     three loading weeks (3:1), taper length matched to race distance.
 *  2. Weekly volume: ramps from current training volume toward the athlete's available hours,
 *     never more than ~10% week-over-week; recovery weeks at ~65%.
 *  3. Sport split: by race demands (e.g. Ironman ≈ 15/55/30 swim/bike/run), shifted toward the
 *     athlete's limiter.
 *  4. Scheduling: long ride on the long day, long run on the day next to it (the "big weekend")
 *     unless the athlete stars a second long day; never two hard run (or bike) days in a row;
 *     respects each day's time cap. Days the athlete didn't pick are rest days.
 */
import type { TrainingDay } from "@shared/schema";
import { RACES, type RaceType, type Sport, type PoolUnit } from "@shared/physiology";
import { addDays, daysBetween } from "@shared/training-load";
import {
  type Phase,
  type LibraryContext,
  type SessionSpec,
  runEasy,
  runRecovery,
  runLong,
  runQuality,
  runBrick,
  bikeEndurance,
  bikeRecovery,
  bikeLong,
  bikeQuality,
  swimTechnique,
  swimCss,
  swimEndurance,
  raceDaySessions,
} from "./library";

export interface PlanRequest {
  race: RaceType;
  raceDate: string | null;
  startDate: string;
  /** Peak weekly hours the athlete can train. */
  weeklyHours: number;
  /** Average weekly hours over the last 4 weeks (from data), to set the starting point. */
  currentWeeklyHours: number | null;
  level: string;
  schedule: TrainingDay[];
  limiter: Sport | null;
  /** For general fitness plans: which sports to include. */
  sports: Sport[];
  pool: PoolUnit;
  easyByHr: boolean;
  swimCss: number;
}

export interface PlannedSession extends SessionSpec {
  date: string;
  order: number;
}

export interface PlannedWeek {
  index: number;
  start: string; // Monday
  phase: Phase;
  targetHours: number;
  sessions: PlannedSession[];
}

export interface GeneratedPlan {
  weeks: PlannedWeek[];
  phases: { phase: Phase; startWeek: number; weeks: number }[];
  split: Record<Sport, number>;
  endDate: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mondayOf(date: string): string {
  const dow = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/** 0=Mon … 6=Sun */
function dowMon(date: string): number {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}

/** TrainingDay.day uses 0=Sun … 6=Sat. */
function scheduleDayToMon(day: number): number {
  return (day + 6) % 7;
}

function taperWeeks(race: RaceType): number {
  const d = RACES[race].taperDays;
  if (d === 0) return 0;
  return Math.max(1, Math.ceil(d / 7));
}

// ─── 1. Macrocycle ────────────────────────────────────────────────────────────

export function buildPhases(totalWeeks: number, race: RaceType): Phase[] {
  if (race === "general" || totalWeeks <= 0) {
    // Rolling 12-week block: 4 base, 8 build, 3:1 recovery.
    const out: Phase[] = [];
    for (let w = 0; w < Math.max(totalWeeks, 1); w++) out.push(w < 4 ? "base" : "build");
    return withRecovery(out);
  }
  const taper = Math.min(taperWeeks(race), Math.max(1, totalWeeks - 1));
  const remaining = totalWeeks - taper;
  let peak = remaining >= 10 ? 3 : remaining >= 6 ? 2 : remaining >= 3 ? 1 : 0;
  let build = Math.round((remaining - peak) * 0.45);
  let base = remaining - peak - build;
  if (base < 1 && remaining > 2) {
    base = 1;
    build = remaining - peak - base;
  }
  const out: Phase[] = [
    ...Array(Math.max(0, base)).fill("base"),
    ...Array(Math.max(0, build)).fill("build"),
    ...Array(Math.max(0, peak)).fill("peak"),
    ...Array(taper - 1).fill("taper"),
    "race",
  ];
  return withRecovery(out);
}

/** Insert a recovery week after three loading weeks (base/build only). */
function withRecovery(phases: Phase[]): Phase[] {
  const out = [...phases];
  let streak = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "base" || out[i] === "build") {
      streak++;
      // Don't put a recovery week right before peak/taper (taper does that job).
      const next = out[i + 1];
      if (streak === 4 && next !== "peak" && next !== "taper" && next !== "race" && next !== undefined) {
        out[i] = "recovery";
        streak = 0;
      }
    } else {
      streak = 0;
    }
  }
  return out;
}

// ─── 2. Weekly volume ─────────────────────────────────────────────────────────

export function weeklyHoursSeries(phases: Phase[], peakHours: number, currentHours: number | null): number[] {
  const loadingWeeks = phases.filter((p) => p === "base" || p === "build").length;
  const start = Math.max(peakHours * 0.55, Math.min(peakHours * 0.9, currentHours ?? peakHours * 0.7));
  const out: number[] = [];
  let lastLoad = start;
  let li = 0;
  const taperIdx = phases.map((p, i) => (p === "taper" ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p === "base" || p === "build") {
      const frac = loadingWeeks > 1 ? li / (loadingWeeks - 1) : 1;
      let h = start + (peakHours * 0.97 - start) * frac;
      h = Math.min(h, lastLoad * 1.1);
      if (li === 0) h = start;
      out.push(h);
      lastLoad = h;
      li++;
    } else if (p === "recovery") {
      out.push(lastLoad * 0.65);
    } else if (p === "peak") {
      out.push(Math.min(peakHours, lastLoad * 1.08));
      lastLoad = out[out.length - 1];
    } else if (p === "taper") {
      const k = taperIdx.indexOf(i);
      const n = taperIdx.length;
      out.push(lastLoad * (n === 1 ? 0.6 : [0.75, 0.55][k] ?? 0.5));
    } else {
      out.push(lastLoad * 0.35); // race week (excluding the race itself)
    }
  }
  return out.map((h) => Math.round(h * 10) / 10);
}

// ─── 3. Sport split & session counts ──────────────────────────────────────────

export function sportSplit(race: RaceType, sports: Sport[], limiter: Sport | null): Record<Sport, number> {
  let split: Record<Sport, number>;
  switch (race) {
    case "tri_full":
      split = { swim: 0.15, bike: 0.53, run: 0.32 };
      break;
    case "tri_703":
      split = { swim: 0.17, bike: 0.5, run: 0.33 };
      break;
    case "tri_olympic":
      split = { swim: 0.2, bike: 0.44, run: 0.36 };
      break;
    case "tri_sprint":
      split = { swim: 0.22, bike: 0.4, run: 0.38 };
      break;
    case "run_5k":
    case "run_10k":
    case "run_half":
    case "run_marathon":
      split = { swim: 0, bike: 0, run: 1 };
      break;
    case "bike_event":
      split = { swim: 0, bike: 1, run: 0 };
      break;
    case "swim_event":
      split = { swim: 1, bike: 0, run: 0 };
      break;
    default: {
      const s = sports.length ? sports : (["swim", "bike", "run"] as Sport[]);
      const w: Record<Sport, number> = { swim: s.includes("swim") ? 1 : 0, bike: s.includes("bike") ? 1.6 : 0, run: s.includes("run") ? 1.3 : 0 };
      const sum = w.swim + w.bike + w.run || 1;
      split = { swim: w.swim / sum, bike: w.bike / sum, run: w.run / sum };
    }
  }
  if (limiter && split[limiter] > 0 && split[limiter] < 1) {
    const add = 0.05;
    const others = (["swim", "bike", "run"] as Sport[]).filter((s) => s !== limiter && split[s] > 0);
    const otherSum = others.reduce((a, s) => a + split[s], 0);
    for (const s of others) split[s] -= add * (split[s] / otherSum);
    split[limiter] += add;
  }
  return split;
}

function sessionCounts(sport: Sport, hours: number, split: Record<Sport, number>, limiter: Sport | null): number {
  const sportHours = hours * split[sport];
  if (sportHours <= 0.2) return 0;
  const single = split[sport] >= 0.99;
  if (sport === "run") {
    if (single) return hours < 3 ? 3 : hours < 5 ? 4 : hours < 7 ? 5 : hours < 9 ? 6 : 7;
    return sportHours < 1.5 ? 2 : sportHours < 3.5 ? 3 : 4;
  }
  if (sport === "bike") {
    if (single) return hours < 4 ? 3 : hours < 7 ? 4 : hours < 11 ? 5 : 6;
    return sportHours < 2 ? 2 : sportHours < 7.5 ? 3 : 4;
  }
  if (single) return hours < 3 ? 3 : hours < 6 ? 4 : 5;
  return sportHours < 1.5 ? 2 : sportHours < 3 || limiter !== "swim" ? 3 : 4;
}

// ─── 4. Scheduling ────────────────────────────────────────────────────────────

interface DaySlot {
  dow: number; // 0=Mon
  date: string;
  cap: number; // minutes
  isLong: boolean;
  used: number;
  /** Run/bike sports with a hard session (long or quality) on this day. Swim quality doesn't count. */
  hard: Set<Sport>;
  sessions: PlannedSession[];
}

interface Want {
  sport: Sport;
  kind: "long" | "quality" | "brick" | "easy" | "swim_css" | "swim_endurance" | "swim_technique" | "recovery";
  minutes: number;
  priority: number;
}

function defaultSchedule(): TrainingDay[] {
  return [
    { day: 2, maxMinutes: 90, isLongDay: false },
    { day: 3, maxMinutes: 90, isLongDay: false },
    { day: 4, maxMinutes: 90, isLongDay: false },
    { day: 5, maxMinutes: 75, isLongDay: false },
    { day: 6, maxMinutes: 300, isLongDay: true },
    { day: 0, maxMinutes: 180, isLongDay: false },
  ];
}

function buildSlots(weekStart: string, schedule: TrainingDay[], fromDate: string, hours: number): DaySlot[] {
  const sched = schedule.length ? schedule : defaultSchedule();
  const slots: DaySlot[] = [];
  const totalCap = sched.reduce((a, d) => a + d.maxMinutes, 0);
  // "3h+" days are really open-ended; allow long days to stretch when the week demands it.
  const stretch = totalCap < hours * 60 * 1.05;
  for (const d of sched) {
    const dow = scheduleDayToMon(d.day);
    const date = addDays(weekStart, dow);
    if (date < fromDate) continue;
    let cap = d.maxMinutes;
    if (d.maxMinutes >= 180 && stretch) cap = Math.max(cap, 360);
    slots.push({ dow, date, cap, isLong: d.isLongDay, used: 0, hard: new Set(), sessions: [] });
  }
  return slots.sort((a, b) => a.dow - b.dow);
}

function place(spec: SessionSpec, slot: DaySlot, minutes: number, hard: boolean) {
  slot.sessions.push({ ...spec, date: slot.date, order: slot.sessions.length });
  slot.used += minutes;
  if (hard && spec.sport !== "swim") slot.hard.add(spec.sport);
}

/**
 * Hard run/bike sports on each day of the week (0=Mon … 6=Sun). Last week's Saturday and Sunday
 * sit at -2 and -1, so spacing rules hold across the week boundary.
 */
function hardByDow(slots: DaySlot[], prevWeekend: Set<Sport>[]): (dow: number) => Set<Sport> {
  return (dow) => (dow < 0 ? prevWeekend[dow + 2] : slots.find((s) => s.dow === dow)?.hard) ?? new Set();
}

/** `strained`: the only day left breaks a spacing rule (hard sport back to back, or three hard days in a row). */
type Chooser = (want: Want) => { slot: DaySlot; strained: boolean } | null;

/**
 * Pick the day for one session. Rules, strongest first:
 *  - a hard run is never the day before/after another hard run (same for bike) — 48 h between
 *    hard sessions of one sport; only broken when no other day fits;
 *  - no three hard days in a row (any sports); then avoid two hard sessions on one day and
 *    hard days back to back;
 *  - the session should fit the day's time cap; spread sessions over the week.
 * Swim quality is exempt from spacing (low impact, short recovery). When the schedule leaves no
 * day that keeps the rules, the caller turns a quality session into an easy one.
 */
function makeChooser(slots: DaySlot[], longDays: DaySlot[], prevWeekend: Set<Sport>[]): Chooser {
  const hardOn = hardByDow(slots, prevWeekend);
  return (want: Want) => {
    const hard = (want.kind === "quality" || want.kind === "long") && want.sport !== "swim";
    const open = slots
      .filter((s) => s.sessions.length < 2 && s.cap - s.used >= Math.min(want.minutes, 30))
      .filter((s) => !s.sessions.some((x) => x.sport === want.sport));
    const spaced = hard ? open.filter((s) => !hardOn(s.dow - 1).has(want.sport) && !hardOn(s.dow + 1).has(want.sport)) : open;
    const pool = spaced.length ? spaced : open;
    const scored = pool.map((s) => {
      const room = s.cap - s.used;
      let score = room >= want.minutes ? 100 + Math.min(room - want.minutes, 60) / 2 : -2 * (want.minutes - room);
      let strained = hard && !spaced.length;
      if (hard) {
        // Doubling up (e.g. bike intervals + quality run off the bike) beats three hard days in a row.
        if (s.hard.size) score -= 250;
        const before = hardOn(s.dow - 1).size > 0;
        const after = hardOn(s.dow + 1).size > 0;
        if (before || after) score -= 80;
        // Three hard days in a row (any sports) is too much accumulated fatigue.
        if ((before && after) || (before && hardOn(s.dow - 2).size) || (after && hardOn(s.dow + 2).size)) {
          score -= 450;
          strained = true;
        }
        if (longDays.includes(s)) score -= 300;
      } else {
        if (longDays.includes(s)) score -= 120;
        // Easy run the day after a long/hard run is fine; the day before a hard run less so.
        if (want.sport !== "swim" && hardOn(s.dow + 1).has(want.sport)) score -= 40;
      }
      if (want.sport === "swim" && s.sessions.some((x) => x.kind === "long")) score -= 200;
      if (s.sessions.length === 0) score += 60;
      return { s, score, strained };
    });
    scored.sort((a, b) => b.score - a.score || a.s.dow - b.s.dow);
    return scored[0] ? { slot: scored[0].s, strained: scored[0].strained } : null;
  };
}

/**
 * The two long days. Primary (long ride, or long run in run-only plans): the starred day with the
 * most time. Secondary (long run in triathlon plans): a second starred day if there is one, else the
 * day after the primary (Sat ride → Sun run, the standard Ironman "big weekend": running on tired
 * legs is specific practice, and the rest of the week stays free for quality), else the day before,
 * else the roomiest day that isn't next to the primary.
 */
function pickLongDays(trainable: DaySlot[]): DaySlot[] {
  const byRoom = [...trainable].sort((a, b) => Number(b.isLong) - Number(a.isLong) || b.cap - a.cap || a.dow - b.dow);
  const primary = byRoom[0];
  if (!primary) return [];
  const starred = byRoom.filter((s) => s.isLong && s !== primary);
  const roomy = (s: DaySlot | undefined) => !!s && s.cap >= 60;
  const at = (dow: number) => trainable.find((s) => s.dow === dow);
  const secondary =
    starred[0] ??
    [at(primary.dow + 1), at(primary.dow - 1)].find(roomy) ??
    byRoom.find((s) => s !== primary && Math.abs(s.dow - primary.dow) > 1) ??
    byRoom[1];
  return [primary, secondary].filter((s): s is DaySlot => !!s);
}

function specFor(want: Want, ctx: LibraryContext, strides: boolean): SessionSpec {
  const m = want.minutes;
  switch (want.sport) {
    case "run":
      if (want.kind === "long") return runLong(m, ctx);
      if (want.kind === "quality") return runQuality(m, ctx);
      if (want.kind === "brick") return runBrick(m, ctx);
      if (want.kind === "recovery") return runRecovery(m, ctx);
      return runEasy(m, ctx, strides);
    case "bike":
      if (want.kind === "long") return bikeLong(m, ctx);
      if (want.kind === "quality") return bikeQuality(m, ctx);
      if (want.kind === "recovery") return bikeRecovery(m);
      return bikeEndurance(m, ctx);
    case "swim":
      if (want.kind === "swim_css") return swimCss(m, ctx);
      if (want.kind === "swim_endurance") return swimEndurance(m, ctx);
      return swimTechnique(m, ctx);
  }
}

const LONG_CAP: Partial<Record<RaceType, { run: number; bike: number }>> = {
  tri_full: { run: 165, bike: 330 },
  tri_703: { run: 120, bike: 210 },
  tri_olympic: { run: 90, bike: 150 },
  tri_sprint: { run: 70, bike: 105 },
  run_marathon: { run: 180, bike: 0 },
  run_half: { run: 120, bike: 0 },
  run_10k: { run: 95, bike: 0 },
  run_5k: { run: 80, bike: 0 },
  bike_event: { run: 0, bike: 300 },
  general: { run: 100, bike: 180 },
  swim_event: { run: 0, bike: 0 },
};

function weekWants(hours: number, phase: Phase, race: RaceType, split: Record<Sport, number>, limiter: Sport | null, level: string): Want[] {
  const wants: Want[] = [];
  const minutes = hours * 60;
  const caps = LONG_CAP[race] ?? LONG_CAP.general!;
  const recoveryish = phase === "recovery" || phase === "taper" || phase === "race";
  const triish = split.swim > 0 && split.bike > 0 && split.run > 0;

  for (const sport of ["bike", "run", "swim"] as Sport[]) {
    const sportMin = minutes * split[sport];
    let n = sessionCounts(sport, hours, split, limiter);
    if (!n) continue;
    if (phase === "race") n = Math.max(1, n - 1);
    if (sport === "swim") {
      // Short swims aren't worth the trip to the pool: prefer fewer, longer sessions.
      if (hours >= 6) n = Math.max(2, Math.min(n, Math.floor(sportMin / 45)));
      const each = sportMin / n;
      const kinds: Want["kind"][] = n >= 3 ? ["swim_css", "swim_endurance", "swim_technique", "swim_technique"] : ["swim_css", "swim_technique"];
      for (let i = 0; i < n; i++) {
        const kind = recoveryish && kinds[i] === "swim_endurance" ? "swim_technique" : kinds[i];
        wants.push({ sport, kind, minutes: Math.round(Math.max(hours >= 6 ? 40 : 30, Math.min(each * (kind === "swim_endurance" ? 1.2 : 1), 90))), priority: kind === "swim_css" ? 3 : 5 });
      }
      continue;
    }
    const cap = sport === "run" ? caps.run : caps.bike;
    const longShare = longSessionShare(race, sport, n);
    let long = Math.min(cap || sportMin * longShare, sportMin * longShare);
    if (phase === "recovery") long *= 0.75;
    if (phase === "race") long = 0;
    if (level === "beginner") long = Math.min(long, sport === "run" ? 120 : 240);
    long = Math.max(sport === "run" ? 40 : 60, long);
    const qualityCount = recoveryish ? (phase === "race" ? 1 : phase === "taper" ? 1 : 0) : single(split, sport) && hours >= 5 && phase !== "base" ? 2 : 1;
    const brick = triish && sport === "run" && (phase === "build" || phase === "peak") && n >= 3;
    let remaining = sportMin - (phase === "race" ? 0 : long);
    const others = n - (phase === "race" ? 0 : 1);
    const each = others > 0 ? remaining / others : 0;
    if (phase !== "race") wants.push({ sport, kind: "long", minutes: Math.round(long), priority: 1 });
    for (let i = 0; i < others; i++) {
      let kind: Want["kind"] = "easy";
      if (i < qualityCount) kind = "quality";
      else if (brick && i === qualityCount) kind = "brick";
      else if (recoveryish && i === others - 1 && sport === "run") kind = "recovery";
      const m = kind === "brick" ? Math.min(35, Math.max(15, each * 0.5)) : kind === "quality" ? Math.max(each, sport === "bike" ? 60 : 45) : each;
      wants.push({ sport, kind, minutes: Math.round(Math.max(20, m)), priority: kind === "quality" ? 2 : kind === "brick" ? 2 : 6 });
    }
  }
  return wants.sort((a, b) => a.priority - b.priority);
}

/** Fraction of a sport's weekly time that goes into its long session. */
function longSessionShare(race: RaceType, sport: Sport, sessions: number): number {
  if (sessions < 3) return 0.5;
  if (race === "tri_full") return sport === "bike" ? 0.6 : 0.48;
  if (race === "tri_703") return sport === "bike" ? 0.5 : 0.4;
  if (race === "run_marathon") return 0.33;
  return sport === "bike" ? 0.42 : 0.3;
}

function single(split: Record<Sport, number>, sport: Sport) {
  return split[sport] >= 0.99;
}

/**
 * Race week (days before race → session). Volume drops sharply; short race-pace touches keep
 * the legs sharp; the day before is a shakeout.
 */
function raceWeekSessions(ctx: LibraryContext, split: Record<Sport, number>): [number, SessionSpec][] {
  const out: [number, SessionSpec][] = [];
  const tri = split.swim > 0 && split.bike > 0 && split.run > 0;
  const easy = ctx.easyByHr ? "Z2 HR" : "Z2";
  const shake = (sport: Sport, min: number, dsl: string): SessionSpec => ({
    sport,
    kind: "easy",
    title: `Shakeout ${sport === "run" ? "Run" : sport === "bike" ? "Spin" : "Swim"} ${min}min`,
    dsl,
    description: "Loosen up and check your gear. Short and easy — you can't gain fitness now, only lose freshness.",
    isKey: false,
  });
  if (tri || split.run === 0) {
    if (split.swim > 0) out.push([5, swimCss(35, { ...ctx, progression: 0 })]);
    if (split.bike > 0) out.push([4, bikeQuality(60, { ...ctx, phase: "taper" })]);
    if (split.run > 0) out.push([3, runQuality(40, { ...ctx, phase: "taper" })]);
    if (split.swim > 0) out.push([2, shake("swim", 20, `${ctx.pool === "yards" ? "800y" : "800m"} Z2 "easy, a few race-pace 50s"`)]);
    if (split.bike > 0) out.push([1, shake("bike", 30, `20min Z2\n3x(1min 90-95% FTP "openers", 1min Z1)\n4min Z1`)]);
    if (split.run > 0) out.push([1, shake("run", 15, `11min ${easy}\n4x(20s 110% TP "strides", 40s Z1)`)]);
  } else {
    out.push([5, runEasy(40, ctx, false)]);
    out.push([4, runQuality(40, { ...ctx, phase: "taper" })]);
    out.push([2, runEasy(30, ctx, false)]);
    out.push([1, shake("run", 20, `16min ${easy}\n4x(20s 110% TP "strides", 40s Z1)`)]);
  }
  return out;
}

export function generatePlan(req: PlanRequest): GeneratedPlan {
  const race = req.race;
  const start = req.startDate;
  const firstMonday = mondayOf(start);
  const raceDate = req.raceDate && req.raceDate > start ? req.raceDate : null;
  const totalWeeks = raceDate ? Math.floor(daysBetween(firstMonday, raceDate) / 7) + 1 : 12;
  const phases = buildPhases(totalWeeks, raceDate ? race : "general");
  const hoursSeries = weeklyHoursSeries(phases, req.weeklyHours, req.currentWeeklyHours);
  const split = sportSplit(race, req.sports, req.limiter);

  const phaseCounters: Record<string, number> = {};
  const weeks: PlannedWeek[] = [];
  let prevWeekendHard: Set<Sport>[] = [new Set(), new Set()];
  for (let w = 0; w < phases.length; w++) {
    const phase = phases[w];
    const weekStart = addDays(firstMonday, w * 7);
    const hours = hoursSeries[w];
    const progKey = phase === "recovery" ? "recovery" : phase;
    const progression = phaseCounters[progKey] ?? 0;
    phaseCounters[progKey] = progression + 1;
    const ctx: LibraryContext = {
      race: raceDate ? race : "general",
      phase: phase === "recovery" ? "base" : phase,
      progression: phase === "recovery" ? Math.max(0, (phaseCounters.base ?? 1) - 1) : progression,
      easyByHr: req.easyByHr,
      pool: req.pool,
      swimCss: req.swimCss,
      level: req.level,
    };

    const slots = buildSlots(weekStart, req.schedule, start, hours);
    // Race week: the race day itself is fixed.
    let raceSlot: DaySlot | undefined;
    if (phase === "race" && raceDate) {
      raceSlot = slots.find((s) => s.date === raceDate);
      if (!raceSlot) {
        raceSlot = { dow: dowMon(raceDate), date: raceDate, cap: 999, isLong: true, used: 0, hard: new Set(), sessions: [] };
        slots.push(raceSlot);
      }
      raceSlot.cap = 0;
      raceSlot.hard = new Set(["run", "bike"]);
      // No training the day before the race except a short shakeout.
    }
    const trainable = slots.filter((s) => s !== raceSlot && (!raceDate || s.date < raceDate));
    const longDays = pickLongDays(trainable);

    const wants = phase === "race" && raceDate ? [] : weekWants(hours, phase, ctx.race, split, req.limiter, req.level);
    if (phase === "race" && raceDate) {
      for (const [offset, spec] of raceWeekSessions(ctx, split)) {
        const date = addDays(raceDate, -offset);
        if (date < start) continue;
        let slot = trainable.find((t) => t.date === date);
        if (!slot) {
          slot = { dow: dowMon(date), date, cap: 120, isLong: false, used: 0, hard: new Set(), sessions: [] };
          trainable.push(slot);
        }
        place(spec, slot, 30, false);
      }
    }
    const choose = makeChooser(trainable, longDays, prevWeekendHard);
    let easyRunCount = 0;
    let longBikeSlot: DaySlot | null = null;

    for (let want of wants) {
      let slot: DaySlot | null = null;
      if (want.kind === "long") {
        const bikeFirst = want.sport === "bike" || split.bike === 0;
        const preferred = bikeFirst ? longDays[0] : longDays.find((d) => d !== longBikeSlot);
        slot = preferred && preferred.cap - preferred.used >= Math.min(want.minutes, 45) && !preferred.sessions.some((s) => s.sport === want.sport) ? preferred : choose(want)?.slot ?? null;
        if (want.sport === "bike") longBikeSlot = slot;
      } else if (want.kind === "brick") {
        slot = longBikeSlot && longBikeSlot.sessions.length < 2 ? longBikeSlot : choose(want)?.slot ?? null;
      } else {
        const pick = choose(want);
        slot = pick?.slot ?? null;
        // No day keeps 48 h between hard sessions: an easy session beats stacked fatigue.
        if (pick?.strained && want.kind === "quality") want = { ...want, kind: "easy", priority: 6 };
      }
      if (!slot) continue;
      const room = slot.cap - slot.used;
      const minutes = Math.max(20, Math.min(want.minutes, room));
      if (room < 20) continue;
      const strides = want.sport === "run" && want.kind === "easy" && easyRunCount++ === 0 && phase !== "race";
      const spec = specFor({ ...want, minutes }, ctx, strides);
      place(spec, slot, minutes, want.kind === "quality" || want.kind === "long");
    }
    prevWeekendHard = [5, 6].map((d) => trainable.find((s) => s.dow === d)?.hard ?? new Set<Sport>());

    if (raceSlot && raceDate) {
      const def = RACES[race];
      const sessions = raceDaySessions(race, ctx, { swimM: def.swimM, bikeM: def.bikeM, runM: def.runM });
      sessions.forEach((spec, i) => raceSlot!.sessions.push({ ...spec, date: raceDate, order: i }));
    }

    weeks.push({
      index: w,
      start: weekStart,
      phase,
      targetHours: hours,
      sessions: [...trainable, ...(raceSlot ? [raceSlot] : [])].flatMap((s) => s.sessions).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order),
    });
  }

  const phaseRuns: { phase: Phase; startWeek: number; weeks: number }[] = [];
  phases.forEach((p, i) => {
    const last = phaseRuns[phaseRuns.length - 1];
    if (last && last.phase === p) last.weeks++;
    else phaseRuns.push({ phase: p, startWeek: i, weeks: 1 });
  });

  return {
    weeks,
    phases: phaseRuns,
    split,
    endDate: raceDate ?? addDays(firstMonday, phases.length * 7 - 1),
  };
}
