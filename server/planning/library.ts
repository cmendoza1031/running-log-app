/**
 * Workout library. Every session is written in the workout DSL with targets relative to the
 * athlete's thresholds (zones, %FTP, %threshold pace, %CSS), so plans re-target automatically
 * when fitness changes.
 *
 * Sources for the session design: Coggan/Allen power training (sweet spot, threshold, VO2),
 * Daniels (threshold & interval running), Friel (triathlon periodization, bricks), Swim Smooth
 * CSS training, and the 80/20 intensity distribution work of Seiler.
 */
import type { PoolUnit, RaceType, Sport } from "@shared/physiology";

export type Phase = "base" | "build" | "peak" | "taper" | "race" | "recovery";

export type SessionKind =
  | "easy"
  | "recovery"
  | "long"
  | "quality"
  | "brick"
  | "technique"
  | "endurance"
  | "race";

export interface LibraryContext {
  race: RaceType;
  phase: Phase;
  /** 0-based index of this build week within its phase (progression). */
  progression: number;
  /** Heart-rate-based easy targets when an LTHR/max HR is known. */
  easyByHr: boolean;
  pool: PoolUnit;
  /** CSS in sec/100 (pool units ≈ meters) — used to size swim sets to the time budget. */
  swimCss: number;
  level: string;
}

export interface SessionSpec {
  sport: Sport;
  kind: SessionKind;
  title: string;
  dsl: string;
  description: string;
  isKey: boolean;
}

const pick = <T,>(arr: T[], i: number): T => arr[Math.max(0, Math.min(arr.length - 1, i))];
const r5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const isTri = (r: RaceType) => r.startsWith("tri_");
const longCourse = (r: RaceType) => r === "tri_full" || r === "tri_703";

// ─── Race-specific intensities ────────────────────────────────────────────────

/** Run race pace as % of threshold speed. */
export function runRacePct(r: RaceType): [number, number] {
  switch (r) {
    case "run_5k":
      return [104, 107];
    case "run_10k":
      return [100, 103];
    case "run_half":
      return [95, 98];
    case "run_marathon":
      return [88, 92];
    case "tri_sprint":
      return [98, 102];
    case "tri_olympic":
      return [95, 99];
    case "tri_703":
      return [88, 92];
    case "tri_full":
      return [82, 86];
    default:
      return [88, 92];
  }
}

/** Bike race intensity as % FTP. */
export function bikeRacePct(r: RaceType): [number, number] {
  switch (r) {
    case "tri_sprint":
      return [90, 96];
    case "tri_olympic":
      return [85, 92];
    case "tri_703":
      return [76, 83];
    case "tri_full":
      return [68, 76];
    default:
      return [76, 85];
  }
}

/** Swim race pace as % of CSS speed. */
export function swimRacePct(r: RaceType): [number, number] {
  switch (r) {
    case "tri_full":
      return [91, 94];
    case "tri_703":
      return [94, 97];
    default:
      return [97, 100];
  }
}

const range = ([a, b]: [number, number]) => `${a}-${b}%`;

// ─── RUN ──────────────────────────────────────────────────────────────────────

function easyTarget(ctx: LibraryContext) {
  return ctx.easyByHr ? "Z2 HR" : "Z2";
}

export function runEasy(min: number, ctx: LibraryContext, strides: boolean): SessionSpec {
  const dsl = strides && min >= 30
    ? `${r5(min - 8)}min ${easyTarget(ctx)} "conversational"\n6x(20s 112-118% TP "strides — relaxed and quick", 60s Z1 "walk/jog")`
    : `${r5(min)}min ${easyTarget(ctx)} "conversational"`;
  return {
    sport: "run",
    kind: "easy",
    title: strides ? "Easy Run + Strides" : "Easy Run",
    dsl,
    description: strides
      ? "Aerobic volume at a truly easy effort, then short relaxed strides to keep turnover and form sharp without adding fatigue."
      : "Aerobic volume. Keep it genuinely easy — you should be able to hold a conversation. Easy days make the hard days work.",
    isKey: false,
  };
}

export function runRecovery(min: number, ctx: LibraryContext): SessionSpec {
  return {
    sport: "run",
    kind: "recovery",
    title: "Recovery Run",
    dsl: `${r5(min)}min ${ctx.easyByHr ? "Z1 HR" : "Z1"} "slower than you think"`,
    description: "Promotes blood flow and recovery. If legs feel heavy, walk breaks are fine — or swap for rest.",
    isKey: false,
  };
}

export function runLong(min: number, ctx: LibraryContext): SessionSpec {
  const m = r5(min);
  const rp = runRacePct(ctx.race);
  const racey = ["run_half", "run_marathon", "tri_703", "tri_full"].includes(ctx.race);
  if ((ctx.phase === "build" || ctx.phase === "peak") && racey && m >= 60) {
    const block = Math.min(pick([15, 20, 30, 40, 45, 60], ctx.progression + (ctx.phase === "peak" ? 2 : 0)), Math.round(m * 0.45));
    return {
      sport: "run",
      kind: "long",
      title: `Long Run ${fmtMin(m)} w/ Race Pace`,
      dsl: `${r5(m - block - 10)}min ${easyTarget(ctx)}\n${r5(block)}min ${range(rp)} TP "goal race pace — practice fueling"\n10min Z1-Z2 cooldown`,
      description: `Builds endurance and teaches your body to hold goal pace on tired legs. Practice race-day nutrition (30–60 g carbs/hour after the first hour).`,
      isKey: true,
    };
  }
  if (ctx.phase === "build" && (ctx.race === "run_5k" || ctx.race === "run_10k") && m >= 50) {
    return {
      sport: "run",
      kind: "long",
      title: `Long Run ${fmtMin(m)} Fast Finish`,
      dsl: `${r5(m - 12)}min ${easyTarget(ctx)}\n12min 90-95% TP "strong finish, controlled"`,
      description: "Aerobic endurance with a strong finish to practice running fast when fatigued.",
      isKey: true,
    };
  }
  return {
    sport: "run",
    kind: "long",
    title: `Long Run ${fmtMin(m)}`,
    dsl: `${m}min ${easyTarget(ctx)} "steady and relaxed — fuel if > 75 min"`,
    description: "The cornerstone of endurance: capillary density, fat oxidation, durability. Keep it easy; time on feet is the goal.",
    isKey: true,
  };
}

export function runQuality(min: number, ctx: LibraryContext): SessionSpec {
  const m = Math.max(35, r5(min));
  const i = ctx.progression;
  if (ctx.phase === "base") {
    if (i % 2 === 0) {
      const n = pick([6, 8, 8, 10, 10], Math.floor(i / 2));
      return {
        sport: "run",
        kind: "quality",
        title: `Hill Repeats ${n}×60s`,
        dsl: `15min ${easyTarget(ctx)} warmup\n${n}x(60s RPE 8 "uphill — strong, tall posture", 90s Z1 "jog down")\n${r5(Math.max(10, m - 15 - n * 2.5 - 10))}min ${easyTarget(ctx)}\n10min Z1 cooldown`,
        description: "Strength-endurance and running economy with low injury risk. Drive the knees, stay tall, don't sprint.",
        isKey: true,
      };
    }
    const tempo = pick([15, 20, 20, 25, 30], Math.floor(i / 2));
    return {
      sport: "run",
      kind: "quality",
      title: `Steady Tempo ${tempo}min`,
      dsl: `15min ${easyTarget(ctx)} warmup\n${tempo}min 86-90% TP "comfortably hard, steady breathing"\n${r5(Math.max(10, m - 15 - tempo))}min Z1-Z2 cooldown`,
      description: "Raises aerobic threshold. Controlled — finish feeling you could have gone 10 more minutes.",
      isKey: true,
    };
  }
  if (ctx.phase === "build") {
    const [n, k, rec] = pick(
      [
        [3, 8, 2],
        [4, 8, 2],
        [3, 10, 2],
        [4, 10, 2],
        [3, 12, 3],
        [3, 15, 3],
        [2, 20, 4],
      ],
      i,
    );
    return {
      sport: "run",
      kind: "quality",
      title: `Threshold ${n}×${k}min`,
      dsl: `15min ${easyTarget(ctx)} warmup\n${n}x(${k}min 97-102% TP "threshold — hard but controlled", ${rec}min Z1)\n${r5(Math.max(10, m - 15 - n * (k + rec)))}min Z1 cooldown`,
      description: "Lactate-threshold intervals: the most time-efficient way to raise the pace you can sustain. Even splits — last rep as fast as the first.",
      isKey: true,
    };
  }
  if (ctx.phase === "peak") {
    const rp = runRacePct(ctx.race);
    if (ctx.race === "run_5k" || ctx.race === "tri_sprint") {
      const [n, k] = pick([[5, 3], [6, 3], [5, 4]], i);
      return {
        sport: "run",
        kind: "quality",
        title: `VO2max ${n}×${k}min`,
        dsl: `15min ${easyTarget(ctx)} warmup\n4x(20s 112% TP "strides", 40s Z1)\n${n}x(${k}min 105-110% TP "hard, controlled", ${k}min Z1)\n10min Z1 cooldown`,
        description: "Raises VO2max and race-specific speed. Rest fully between reps.",
        isKey: true,
      };
    }
    if (ctx.race === "run_10k" || ctx.race === "tri_olympic") {
      const n = pick([5, 6, 6], i);
      return {
        sport: "run",
        kind: "quality",
        title: `${n}×1km @ 10K pace`,
        dsl: `15min ${easyTarget(ctx)} warmup\n${n}x(1km ${range(rp)} TP "race pace", 90s Z1)\n10min Z1 cooldown`,
        description: "Race-specific rhythm. Lock into goal pace and stay relaxed.",
        isKey: true,
      };
    }
    const [n, k] = pick([[3, 12], [3, 15], [2, 20]], i);
    return {
      sport: "run",
      kind: "quality",
      title: `Race Pace ${n}×${k}min`,
      dsl: `15min ${easyTarget(ctx)} warmup\n${n}x(${k}min ${range(rp)} TP "goal race pace", 3min Z1-Z2)\n10min Z1 cooldown`,
      description: "Dial in goal race pace until it feels automatic.",
      isKey: true,
    };
  }
  // taper
  const rp = runRacePct(ctx.race);
  return {
    sport: "run",
    kind: "quality",
    title: "Sharpening 4×3min",
    dsl: `15min ${easyTarget(ctx)} warmup\n4x(3min ${range(rp)} TP "race pace — smooth", 2min Z1)\n${r5(Math.min(15, Math.max(5, m - 35)))}min Z1 cooldown`,
    description: "Keeps the legs sharp while volume drops. Should feel easy — resist doing more.",
    isKey: true,
  };
}

export function runBrick(min: number, ctx: LibraryContext): SessionSpec {
  const m = Math.max(10, r5(min));
  const rp = runRacePct(ctx.race);
  const dsl =
    ctx.phase === "base"
      ? `${m}min ${easyTarget(ctx)} "straight off the bike — quick, light steps"`
      : `5min ${easyTarget(ctx)} "find your legs"\n${Math.max(5, m - 5)}min ${range(rp)} TP "settle into race rhythm"`;
  return {
    sport: "run",
    kind: "brick",
    title: `Brick Run ${m}min`,
    dsl,
    description: "Run immediately after the ride (transition under 5 min). Trains the bike-to-run switch so race-day legs don't feel foreign.",
    isKey: ctx.phase !== "base",
  };
}

// ─── BIKE ─────────────────────────────────────────────────────────────────────

export function bikeEndurance(min: number, ctx: LibraryContext): SessionSpec {
  const m = r5(min);
  if (ctx.phase === "base" && m >= 50) {
    return {
      sport: "bike",
      kind: "endurance",
      title: "Endurance Ride + Cadence",
      dsl: `${r5(m - 20)}min Z2 "steady endurance"\n5x(1min Z2 "spin 105+ rpm, smooth", 3min Z2)`,
      description: "Aerobic base with high-cadence drills to improve pedaling efficiency.",
      isKey: false,
    };
  }
  return {
    sport: "bike",
    kind: "endurance",
    title: "Endurance Ride",
    dsl: `${m}min Z2 "steady, cadence 85-95"`,
    description: "Zone 2 builds the aerobic engine — mitochondria, fat oxidation, fatigue resistance. Stay honest: no surging on hills.",
    isKey: false,
  };
}

export function bikeRecovery(min: number): SessionSpec {
  return {
    sport: "bike",
    kind: "recovery",
    title: "Recovery Spin",
    dsl: `${r5(min)}min Z1 "easy spin, light gear"`,
    description: "Active recovery. Should feel almost too easy.",
    isKey: false,
  };
}

export function bikeLong(min: number, ctx: LibraryContext): SessionSpec {
  const m = r5(min);
  const rp = bikeRacePct(ctx.race);
  if ((ctx.phase === "build" || ctx.phase === "peak") && (isTri(ctx.race) || ctx.race === "bike_event") && m >= 90) {
    const idx = ctx.progression + (ctx.phase === "peak" ? 3 : 0);
    const [n, k] =
      ctx.race === "tri_full"
        ? pick([[2, 30], [3, 30], [2, 45], [3, 40], [2, 60], [3, 50], [2, 75]], idx)
        : ctx.race === "tri_703"
          ? pick([[2, 20], [3, 20], [2, 30], [3, 25], [2, 40], [3, 30]], idx)
          : pick([[3, 10], [3, 12], [4, 10], [3, 15], [2, 20]], idx);
    const work = n * (k + 10);
    const wu = Math.max(20, Math.round((m - work) * 0.6));
    const cd = Math.max(10, m - work - wu);
    return {
      sport: "bike",
      kind: "long",
      title: `Long Ride ${fmtMin(m)} w/ ${n}×${k}min race effort`,
      dsl: `${r5(wu)}min Z2 warmup\n${n}x(${k}min ${range(rp)} FTP "race effort — aero position, fuel on schedule", 10min Z2)\n${r5(cd)}min Z2 cooldown`,
      description: `Race-specific endurance at goal intensity. Rehearse nutrition exactly as on race day (${ctx.race === "tri_full" ? "80–100" : "60–90"} g carbs/hour, fluids + sodium).`,
      isKey: true,
    };
  }
  return {
    sport: "bike",
    kind: "long",
    title: `Long Ride ${fmtMin(m)}`,
    dsl: `${m}min Z2 "steady endurance — fuel 60-90 g carbs/h"`,
    description: "Long aerobic ride. The single biggest driver of bike durability. Keep power in Z2; eat and drink from the first 30 minutes.",
    isKey: true,
  };
}

export function bikeQuality(min: number, ctx: LibraryContext): SessionSpec {
  const m = Math.max(45, r5(min));
  const i = ctx.progression;
  const warm = 15;
  const cool = (used: number) => r5(Math.max(10, m - used));
  if (ctx.phase === "base") {
    const [n, k] = pick([[3, 10], [3, 12], [2, 15], [3, 15], [2, 20]], i);
    return {
      sport: "bike",
      kind: "quality",
      title: `Sweet Spot ${n}×${k}min`,
      dsl: `${warm}min Z2 warmup\n${n}x(${k}min 88-93% FTP "sweet spot — smooth pressure", 5min Z1-Z2)\n${cool(warm + n * (k + 5))}min Z2 cooldown`,
      description: "Sweet spot builds FTP and muscular endurance with less fatigue than threshold work.",
      isKey: true,
    };
  }
  if (ctx.phase === "build") {
    if (longCourse(ctx.race)) {
      const [n, k] = pick([[3, 15], [3, 20], [2, 30], [3, 25], [2, 40]], i);
      return {
        sport: "bike",
        kind: "quality",
        title: `Sweet Spot ${n}×${k}min`,
        dsl: `${warm}min Z2 warmup\n${n}x(${k}min 88-93% FTP "steady, aero if possible", 5min Z1-Z2)\n${cool(warm + n * (k + 5))}min Z2 cooldown`,
        description: "Extends time at high aerobic power — exactly what long-course racing needs.",
        isKey: true,
      };
    }
    const [n, k] = pick([[4, 8], [3, 12], [4, 10], [3, 15], [2, 20]], i);
    return {
      sport: "bike",
      kind: "quality",
      title: `Threshold ${n}×${k}min`,
      dsl: `${warm}min Z2 warmup\n3x(1min 105% FTP "opener", 1min Z1)\n${n}x(${k}min 95-100% FTP "threshold", ${Math.max(4, Math.round(k / 2))}min Z1)\n${cool(warm + 6 + n * (k + Math.max(4, Math.round(k / 2))))}min Z2 cooldown`,
      description: "Threshold intervals raise FTP directly. Hold steady power; if you fade >5% on the last rep, the target is too high.",
      isKey: true,
    };
  }
  if (ctx.phase === "peak") {
    if (longCourse(ctx.race)) {
      const rp = bikeRacePct(ctx.race);
      const [n, k] = pick([[2, 30], [3, 25], [2, 40]], i);
      return {
        sport: "bike",
        kind: "quality",
        title: `Race Effort ${n}×${k}min`,
        dsl: `${warm}min Z2 warmup\n${n}x(${k}min ${rp[1]}-${rp[1] + 6}% FTP "top of race range", 5min Z2)\n${cool(warm + n * (k + 5))}min Z2 cooldown`,
        description: "Slightly above race intensity so race pace feels controlled on the day.",
        isKey: true,
      };
    }
    const [n, k] = pick([[5, 3], [6, 3], [5, 4]], i);
    return {
      sport: "bike",
      kind: "quality",
      title: `VO2max ${n}×${k}min`,
      dsl: `${warm}min Z2 warmup\n${n}x(${k}min 110-118% FTP "hard — high cadence", ${k}min Z1)\n${cool(warm + n * k * 2)}min Z2 cooldown`,
      description: "Raises the ceiling. Short, hard, full recoveries.",
      isKey: true,
    };
  }
  const rp = bikeRacePct(ctx.race);
  return {
    sport: "bike",
    kind: "quality",
    title: "Openers",
    dsl: `${warm}min Z2 warmup\n3x(3min ${range(rp)} FTP "race effort", 3min Z1)\n4x(30s 120% FTP "snappy", 90s Z1)\n${cool(warm + 26)}min Z1-Z2 cooldown`,
    description: "Wakes the legs up during the taper without adding fatigue.",
    isKey: true,
  };
}

// ─── SWIM ─────────────────────────────────────────────────────────────────────

function poolSuffix(pool: PoolUnit) {
  return pool === "yards" ? "y" : "m";
}

/** Approximate pool units swimmable in `min` minutes including rest. */
function swimBudget(min: number, ctx: LibraryContext): number {
  const avgPer100 = ctx.swimCss * 1.18; // avg pace incl. rest & easier work
  return Math.max(800, Math.floor((min * 60) / avgPer100 * 100 / 100) * 100);
}

export function swimTechnique(min: number, ctx: LibraryContext): SessionSpec {
  const u = poolSuffix(ctx.pool);
  const total = swimBudget(min, ctx);
  const main = Math.max(4, Math.min(10, Math.round((total - 300 - 400 - 200) / 100)));
  const pull = Math.max(200, Math.round((total - 300 - 400 - 200 - main * 100) / 100) * 100);
  return {
    sport: "swim",
    kind: "technique",
    title: "Technique + Aerobic",
    dsl: `300${u} Z1-Z2 warmup\n8x(50${u} Z1 "drill: catch-up / fingertip drag / 6-kick switch", 15s rest)\n${main}x(100${u} Z2 "long, smooth strokes", 15s rest)\n${pull}${u} Z2 "pull buoy — high elbow catch"\n200${u} Z1 cooldown`,
    description: "Efficiency first: drills groove the catch and body position, then carry it into aerobic swimming.",
    isKey: false,
  };
}

export function swimCss(min: number, ctx: LibraryContext): SessionSpec {
  const u = poolSuffix(ctx.pool);
  const total = swimBudget(min, ctx);
  const sets: [number, number, number][] = [
    [8, 100, 15],
    [10, 100, 15],
    [6, 200, 20],
    [12, 100, 10],
    [5, 300, 30],
    [4, 400, 40],
    [3, 500, 45],
  ];
  let [n, d, rest] = pick(sets, ctx.progression + (ctx.phase === "build" ? 2 : ctx.phase === "peak" ? 3 : 0));
  // Fit the main set into the time budget.
  const available = total - 400 - 200 - 200;
  while (n > 3 && n * d > available) n--;
  const pct = ctx.phase === "base" ? "97-100%" : "100-102%";
  return {
    sport: "swim",
    kind: "quality",
    title: `CSS ${n}×${d}`,
    dsl: `400${u} Z2 warmup "200 swim, 4x50 build"\n4x(50${u} Z4 "build to fast", 15s rest)\n${n}x(${d}${u} ${pct} CSS "threshold — even splits", ${rest}s rest)\n200${u} Z1 cooldown`,
    description: "Critical Swim Speed work: the swim equivalent of threshold intervals. Hold identical splits on every rep; short rest is the point.",
    isKey: true,
  };
}

export function swimEndurance(min: number, ctx: LibraryContext): SessionSpec {
  const u = poolSuffix(ctx.pool);
  const total = swimBudget(min, ctx);
  const main = total - 300 - 200;
  if ((ctx.phase === "peak" || ctx.phase === "build") && isTri(ctx.race)) {
    const cont = Math.max(800, Math.min(Math.round((main * 0.8) / 100) * 100, ctx.race === "tri_full" ? 3000 : 2000));
    const rp = swimRacePct(ctx.race);
    return {
      sport: "swim",
      kind: "endurance",
      title: `Continuous ${cont}${u} @ race pace`,
      dsl: `300${u} Z2 warmup\n${cont}${u} ${range(rp)} CSS "race rhythm — sight every 6-8 strokes"\n200${u} Z1 cooldown`,
      description: "Race-specific continuous swim. Open water if you can — practice sighting and drafting.",
      isKey: true,
    };
  }
  const rep = main >= 2000 ? 500 : 400;
  const n = Math.max(2, Math.floor(main / rep));
  return {
    sport: "swim",
    kind: "endurance",
    title: `Endurance ${n}×${rep}`,
    dsl: `300${u} Z2 warmup\n${n}x(${rep}${u} 90-95% CSS "strong aerobic, relaxed breathing", 30s rest)\n200${u} Z1 cooldown`,
    description: "Aerobic endurance in the water — longer reps build the durability to swim strong to the end.",
    isKey: false,
  };
}

// ─── Race day ─────────────────────────────────────────────────────────────────

export function raceDaySessions(race: RaceType, ctx: LibraryContext, distances: { swimM?: number; bikeM?: number; runM?: number }): SessionSpec[] {
  const out: SessionSpec[] = [];
  const u = poolSuffix(ctx.pool);
  if (distances.swimM) {
    const d = ctx.pool === "yards" ? Math.round(distances.swimM / 0.9144 / 100) * 100 : distances.swimM;
    out.push({
      sport: "swim",
      kind: "race",
      title: "RACE — Swim",
      dsl: `${d}${u} ${range(swimRacePct(race))} CSS "race swim — calm start, find feet to draft"`,
      description: "Start controlled. Settle into rhythm after the first 200. Exit with plenty left.",
      isKey: true,
    });
  }
  if (distances.bikeM) {
    out.push({
      sport: "bike",
      kind: "race",
      title: "RACE — Bike",
      dsl: `${+(distances.bikeM / 1000).toFixed(1)}km ${range(bikeRacePct(race))} FTP "race power — fuel every 15-20 min"`,
      description: "Ride your numbers, not the people around you. The bike is where races are lost by overcooking.",
      isKey: true,
    });
  }
  if (distances.runM) {
    out.push({
      sport: "run",
      kind: "race",
      title: isTri(race) ? "RACE — Run" : "RACE",
      dsl: `${+(distances.runM / 1000).toFixed(2)}km ${range(runRacePct(race))} TP "goal pace — even effort"`,
      description: isTri(race) ? "First 2–3 km easy while your legs adjust, then lock in." : "Even pacing. The first half should feel easy.",
      isKey: true,
    });
  }
  return out;
}

export function fmtMin(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}min`;
  return mm ? `${h}h${String(mm).padStart(2, "0")}` : `${h}h`;
}
