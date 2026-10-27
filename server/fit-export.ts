/**
 * Workout file exports:
 *   .fit — Garmin / COROS / Wahoo structured workout (repeats, pace/power/HR target ranges)
 *   .zwo — Zwift / TrainerRoad-style indoor bike workout (% FTP)
 */
import { Encoder } from "@garmin/fitsdk";
import FIT from "@garmin/fitsdk/src/fit.js";
import Profile from "@garmin/fitsdk/src/profile.js";
import type { PlanWorkout } from "@shared/schema";
import { type Sport, type Thresholds, type PoolUnit, swimPaceToDisplaySec, formatClock } from "@shared/physiology";
import {
  resolveTarget,
  flattenWorkout,
  isValidStructure,
  parseWorkout,
  type Step,
  type WorkoutStructure,
} from "@shared/workout-structure";

const FIT_SPORT: Record<Sport, string> = { run: "running", bike: "cycling", swim: "swimming" };
const FIT_INTENSITY: Record<Step["intent"], string> = {
  warmup: "warmup",
  work: "active",
  recovery: "recovery",
  cooldown: "cooldown",
  rest: "rest",
};

function structureOf(w: PlanWorkout): WorkoutStructure {
  if (isValidStructure(w.structure)) return w.structure as WorkoutStructure;
  // Legacy workouts without structure: a single open step of the target duration.
  const sport = (w.sport as Sport) ?? "run";
  return parseWorkout(`${w.targetDurationMinutes ?? 45}min Z2`, sport);
}

function stepName(s: Step, sport: Sport, th: Thresholds, pool: PoolUnit): string {
  const base =
    s.intent === "warmup" ? "Warm up" : s.intent === "cooldown" ? "Cool down" : s.intent === "rest" ? "Rest" : s.intent === "recovery" ? "Recover" : s.label ?? "Work";
  if (sport === "swim" && s.intent !== "rest") {
    const r = resolveTarget(s.target, sport, th);
    if (r.metric === "pace" && r.low && r.high) {
      return `${base} ${formatClock(swimPaceToDisplaySec((r.low + r.high) / 2, pool))}`.slice(0, 20);
    }
  }
  return base.slice(0, 20);
}

export function generateWorkoutFit(w: PlanWorkout, th: Thresholds, pool: PoolUnit = "meters"): Uint8Array {
  const ws = structureOf(w);
  const sport = ws.sport;
  const encoder = new Encoder();
  const now = new Date();

  type Msg = Record<string, unknown>;
  const steps: Msg[] = [];
  const push = (s: Step) => {
    const idx = steps.length;
    const msg: Msg = {
      mesgNum: Profile.MesgNum.WORKOUT_STEP,
      messageIndex: idx,
      wktStepName: stepName(s, sport, th, pool),
      intensity: FIT_INTENSITY[s.intent],
    };
    if (s.duration.type === "time") {
      msg.durationType = "time";
      msg.durationValue = Math.round(s.duration.sec * 1000);
    } else if (s.duration.type === "distance") {
      msg.durationType = "distance";
      msg.durationValue = Math.round(s.duration.m * 100);
    } else {
      msg.durationType = "open";
      msg.durationValue = 0;
    }
    const r = s.intent === "rest" ? null : resolveTarget(s.target, sport, th);
    if (!r || r.metric === "open" || r.metric === "rpe" || (sport === "swim" && r.metric === "pace")) {
      msg.targetType = "open";
      msg.targetValue = 0;
    } else if (r.metric === "power") {
      msg.targetType = "power";
      msg.targetValue = 0;
      msg.customTargetValueLow = Math.round(r.low!) + 1000;
      msg.customTargetValueHigh = Math.round(r.high!) + 1000;
    } else if (r.metric === "hr") {
      msg.targetType = "heartRate";
      msg.targetValue = 0;
      msg.customTargetValueLow = Math.round(r.low!) + 100;
      msg.customTargetValueHigh = Math.round(r.high!) + 100;
    } else if (r.metric === "pace") {
      // speed in mm/s; low = slower bound
      msg.targetType = "speed";
      msg.targetValue = 0;
      msg.customTargetValueLow = Math.round((1000 / r.high!) * 1000);
      msg.customTargetValueHigh = Math.round((1000 / r.low!) * 1000);
    }
    steps.push(msg);
  };

  for (const n of ws.nodes) {
    if (n.kind === "step") {
      push(n);
      continue;
    }
    const first = steps.length;
    for (const s of n.steps) push(s);
    steps.push({
      mesgNum: Profile.MesgNum.WORKOUT_STEP,
      messageIndex: steps.length,
      durationType: "repeatUntilStepsCmplt",
      durationValue: first,
      targetType: "open",
      targetValue: n.count,
    });
  }

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "workout",
    manufacturer: "development",
    product: 1,
    serialNumber: Math.floor(Math.random() * 0xfffffff),
    timeCreated: now,
  });
  const workout: Msg = {
    mesgNum: Profile.MesgNum.WORKOUT,
    wktName: w.title.slice(0, 30),
    sport: FIT_SPORT[sport],
    subSport: sport === "swim" ? "lapSwimming" : "generic",
    numValidSteps: steps.length,
  };
  if (sport === "swim") {
    workout.poolLength = pool === "yards" ? 22.86 : 25;
    workout.poolLengthUnit = pool === "yards" ? "statute" : "metric";
  }
  encoder.writeMesg(workout);
  for (const s of steps) encoder.writeMesg(s);
  return encoder.close();
}

// ─── Zwift .zwo ───────────────────────────────────────────────────────────────

function xmlEscape(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export function generateWorkoutZwo(w: PlanWorkout, th: Thresholds): string | null {
  const ws = structureOf(w);
  if (ws.sport !== "bike") return null;
  const ftp = th.ftp ?? 200;
  const flat = flattenWorkout(ws, { ...th, ftp }, { units: "metric", pool: "meters" });
  const pct = (i: number) => {
    const r = flat[i].resolved;
    const watts = r.metric === "power" && r.low && r.high ? (r.low + r.high) / 2 : r.intensity * ftp;
    return (watts / ftp).toFixed(2);
  };
  const lines: string[] = [];
  let i = 0;
  for (const n of ws.nodes) {
    if (n.kind === "repeat" && n.steps.length === 2) {
      const on = Math.round(flat[i].seconds);
      const off = Math.round(flat[i + 1].seconds);
      lines.push(`    <IntervalsT Repeat="${n.count}" OnDuration="${on}" OffDuration="${off}" OnPower="${pct(i)}" OffPower="${pct(i + 1)}"/>`);
      i += n.count * 2;
      continue;
    }
    const count = n.kind === "repeat" ? n.count * n.steps.length : 1;
    for (let k = 0; k < count; k++, i++) {
      const f = flat[i];
      const dur = Math.round(f.seconds);
      const text = f.label ? `><textevent timeoffset="0" message="${xmlEscape(f.label)}"/></` : "/>";
      const close = (tag: string) => (f.label ? `${text}${tag}>` : "/>");
      if (f.intent === "warmup") {
        lines.push(`    <Warmup Duration="${dur}" PowerLow="${Math.max(0.4, +pct(i) - 0.15).toFixed(2)}" PowerHigh="${pct(i)}"${close("Warmup")}`);
      } else if (f.intent === "cooldown") {
        lines.push(`    <Cooldown Duration="${dur}" PowerLow="${pct(i)}" PowerHigh="${Math.max(0.4, +pct(i) - 0.15).toFixed(2)}"${close("Cooldown")}`);
      } else {
        lines.push(`    <SteadyState Duration="${dur}" Power="${f.intent === "rest" ? "0.45" : pct(i)}"${close("SteadyState")}`);
      }
    }
  }
  return `<workout_file>
  <author>Vista</author>
  <name>${xmlEscape(w.title)}</name>
  <description>${xmlEscape(w.description ?? "")}</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
${lines.join("\n")}
  </workout>
</workout_file>
`;
}

export { FIT };
