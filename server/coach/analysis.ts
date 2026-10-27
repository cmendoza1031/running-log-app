/**
 * Post-workout analysis with a small, cheap model (Claude Haiku 4.5).
 * Deterministic metrics are computed first; the model only interprets them in a coach's voice
 * and picks one adjustment for upcoming training.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Run, PlanWorkout, WorkoutAnalysis } from "@shared/schema";
import {
  type Sport,
  type Thresholds,
  toSport,
  formatRunPace,
  formatSwimPace,
  formatDistance,
  formatDuration,
  formatClock,
  formatSpeed,
  RACES,
  type RaceType,
} from "@shared/physiology";
import { isValidStructure, describeWorkout, type WorkoutStructure } from "@shared/workout-structure";
import { addDays, daysBetween } from "@shared/training-load";
import { storage } from "../storage";
import { getActivity, getActivitiesBetween, getPlanWorkout, getThresholds, patchActivity, prefsFromProfile, todayInTz, type AthletePrefs } from "../data";
import { getFitness } from "../analytics/load";

export const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || "claude-haiku-4-5";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

const AnalysisSchema = z.object({
  headline: z.string().describe("5-9 word verdict, e.g. 'Controlled threshold work, right on target'"),
  summary: z.string().describe("2-4 sentences in a coach's voice: how it went vs. the goal of the session, citing specific numbers"),
  keyPoints: z.array(z.string()).describe("1-3 short, specific observations (pacing, HR drift, fueling, execution)"),
  nextTime: z.string().describe("One concrete, actionable tip for the next similar session"),
  suggestedAction: z.enum(["none", "ease_next_days", "add_recovery_day", "raise_threshold", "lower_threshold"]),
  actionReason: z.string().describe("One sentence justifying the suggested action; empty if none"),
  executionScore: z.number().int().min(0).max(100).nullable().describe("How well the planned session was executed (null if unplanned)"),
});

const SYSTEM = `You are an elite endurance coach (swim, bike, run, triathlon) writing a short post-workout note to your athlete inside their training app.

Principles:
- Judge the session against its PURPOSE. An easy day done easy is a success; an easy day run at tempo is a mistake even if it "felt good".
- Use the numbers given. Reference actual pace/power/HR vs. target. Never invent data that isn't provided.
- 80/20: most training should be easy. Flag grey-zone drift on easy days.
- Aerobic decoupling < 5% on steady sessions = good durability; > 8% = fatigue, heat, under-fueling or pacing too hard.
- Be direct and warm. No filler, no emojis, no generic praise. Plain text, no markdown.
- Form (TSB) between -10 and -30 is NORMAL productive training in a build — never treat it as a problem by itself. Below -30 is deep fatigue.
- Suggested action rules (be conservative — "none" is the right answer for the large majority of sessions):
  * ease_next_days: only with TSB below -30 AND a second signal (execution clearly fell short, HR unusually high for the output, RPE much higher than the session called for), or the athlete reports feeling awful/very tired.
  * add_recovery_day: the athlete reports pain, illness, or exhaustion, or TSB below -40 with poor execution.
  * raise_threshold: the athlete clearly exceeded threshold-level targets at normal HR/RPE (e.g. held top of threshold range easily, or a new best effort).
  * lower_threshold: repeatedly unable to reach targets despite being fresh.
- If the activity has too little data, say what you can and keep it short.
- Keep the summary to 2-3 sentences. Refer to days by weekday or date, not "day N".`;

function sportName(s: Sport | null) {
  return s === "swim" ? "Swim" : s === "bike" ? "Ride" : s === "run" ? "Run" : "Workout";
}

function paceLabel(sport: Sport | null, speed: number | null | undefined, prefs: AthletePrefs): string | null {
  if (!speed) return null;
  if (sport === "run") return formatRunPace(1000 / speed, prefs.units);
  if (sport === "swim") return formatSwimPace(100 / speed, prefs.pool);
  if (sport === "bike") return formatSpeed(speed, prefs.units);
  return null;
}

function zoneLine(label: string, secs: number[] | null | undefined): string | null {
  if (!secs?.length) return null;
  const total = secs.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return `${label}: ${secs.map((s, i) => `Z${i + 1} ${Math.round((s / total) * 100)}%`).join(", ")}`;
}

export function describeActivityForModel(r: Run, th: Thresholds, prefs: AthletePrefs): string {
  const sport = toSport(r.sportType);
  const secs = r.movingTimeSec ?? r.timeHours * 3600 + r.timeMinutes * 60;
  const lines = [
    `${sportName(sport)} "${r.title ?? r.runType}" on ${r.date}${r.trainer ? " (indoor)" : ""}`,
    `Duration ${formatDuration(secs)}, distance ${formatDistance(r.distanceMeters, sport, prefs.units, prefs.pool)}`,
  ];
  const pace = paceLabel(sport, r.avgSpeed ?? (r.distanceMeters && secs ? r.distanceMeters / secs : null), prefs);
  if (pace) lines.push(`Average ${sport === "bike" ? "speed" : "pace"} ${pace}`);
  if (r.averagePower) lines.push(`Power avg ${r.averagePower} W${r.normalizedPower ? `, NP ${r.normalizedPower} W` : ""}${th.ftp && r.normalizedPower ? ` (IF ${(r.normalizedPower / th.ftp).toFixed(2)})` : ""}`);
  if (r.heartRateAvg) lines.push(`HR avg ${r.heartRateAvg}${r.heartRateMax ? `, max ${r.heartRateMax}` : ""} bpm`);
  if (r.elevationGainM) lines.push(`Elevation gain ${Math.round(prefs.units === "imperial" ? r.elevationGainM * 3.28084 : r.elevationGainM)} ${prefs.units === "imperial" ? "ft" : "m"}`);
  if (r.tss != null) lines.push(`Training load ${Math.round(r.tss)} TSS (IF ${r.intensityFactor?.toFixed(2)}, from ${r.loadSource})`);
  const zl = [zoneLine("Power zones", r.powerZoneSec), zoneLine("HR zones", r.hrZoneSec), zoneLine("Pace zones", r.paceZoneSec)].filter(Boolean);
  lines.push(...(zl as string[]));
  if (r.decoupling != null) lines.push(`Aerobic decoupling ${r.decoupling}%`);
  if (r.efficiencyFactor != null) lines.push(`Efficiency factor ${r.efficiencyFactor}`);
  if (r.laps && r.laps.length > 1 && r.laps.length <= 40) {
    lines.push("Laps:");
    for (const [i, l] of r.laps.entries()) {
      const p = paceLabel(sport, l.avgSpeed ?? (l.movingSec ? l.distanceM / l.movingSec : null), prefs);
      lines.push(
        `  ${i + 1}. ${formatClock(l.movingSec)}, ${formatDistance(l.distanceM, sport, prefs.units, prefs.pool)}${p ? `, ${p}` : ""}${l.avgPower ? `, ${l.avgPower} W` : ""}${l.avgHr ? `, HR ${l.avgHr}` : ""}`,
      );
    }
  }
  if (r.perceivedEffort) lines.push(`Athlete RPE ${r.perceivedEffort}/10`);
  if (r.feel) lines.push(`Athlete feel ${["", "awful", "bad", "ok", "good", "great"][r.feel]}`);
  if (r.notes) lines.push(`Athlete notes: "${r.notes.slice(0, 600)}"`);
  return lines.join("\n");
}

function describeThresholds(th: Thresholds, prefs: AthletePrefs, sport: Sport | null): string {
  const parts: string[] = [];
  if (th.ftp && (sport === "bike" || !sport)) parts.push(`FTP ${th.ftp} W`);
  if (th.runThresholdPace && (sport === "run" || !sport)) parts.push(`threshold pace ${formatRunPace(th.runThresholdPace, prefs.units)}`);
  if (th.swimCss && (sport === "swim" || !sport)) parts.push(`CSS ${formatSwimPace(th.swimCss, prefs.pool)}`);
  if (th.lthrRun && sport === "run") parts.push(`run LTHR ${th.lthrRun}`);
  if (th.lthrBike && sport === "bike") parts.push(`bike LTHR ${th.lthrBike}`);
  if (th.maxHr) parts.push(`max HR ${th.maxHr}`);
  return parts.join(", ") || "not yet established";
}

export async function analyzeActivity(userId: string, activityId: string): Promise<WorkoutAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const run = await getActivity(userId, activityId);
  if (!run) return null;
  const profile = await storage.getProfile(userId);
  const prefs = prefsFromProfile(profile);
  const th = await getThresholds(userId);
  const sport = toSport(run.sportType);
  const today = todayInTz(prefs.tz);

  const planned: PlanWorkout | undefined = run.planWorkoutId ? await getPlanWorkout(userId, run.planWorkoutId) : undefined;
  const [fitness, recent] = await Promise.all([
    getFitness(userId, prefs.tz, { historyDays: 14 }),
    getActivitiesBetween(userId, addDays(run.date, -7), addDays(run.date, -1)),
  ]);

  const ctx: string[] = [];
  ctx.push(`Athlete level: ${profile?.fitnessLevel ?? "unknown"}. Thresholds: ${describeThresholds(th, prefs, sport)}.`);
  const race = profile?.goalRaceType as RaceType | null;
  const raceDate = profile?.targetRaceDate;
  if (race && RACES[race] && raceDate && raceDate >= today) ctx.push(`Goal: ${RACES[race].label} in ${daysBetween(today, raceDate)} days.`);
  ctx.push(`Typical week for this athlete ≈ ${Math.round(fitness.ctl * 7)} TSS (CTL × 7).`);
  ctx.push(`Current fitness (CTL) ${fitness.ctl}, fatigue (ATL) ${fitness.atl}, form (TSB) ${fitness.tsb} → "${fitness.form.label}" (${fitness.form.advice}).`);
  if (recent.length) {
    ctx.push(
      `The 7 days before this session: ${recent.length} sessions totaling ${Math.round(recent.reduce((a, r) => a + (r.tss ?? 0), 0))} TSS (${recent
        .slice(0, 6)
        .map((r) => `${r.date} ${r.sportType} ${r.title ?? r.runType}`)
        .join("; ")}).`,
    );
  }

  let plannedText = "No planned workout for this session (unstructured).";
  if (planned) {
    const structure = isValidStructure(planned.structure) ? (planned.structure as WorkoutStructure) : null;
    plannedText = `Planned: "${planned.title}" (${planned.phase ?? ""} phase${planned.isKey ? ", key session" : ""}). ${
      structure ? `Structure: ${describeWorkout(structure, th, prefs)}.` : planned.description ?? ""
    } Planned duration ${formatDuration(planned.plannedDurationSec ?? 0)}, planned load ${Math.round(planned.plannedTss ?? 0)} TSS.`;
  }

  const prompt = `${ctx.join("\n")}\n\n${plannedText}\n\nWhat the athlete did:\n${describeActivityForModel(run, th, prefs)}\n\nWrite the post-workout note.`;

  try {
    const res = await anthropic().messages.parse({
      model: ANALYSIS_MODEL,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(AnalysisSchema) },
    });
    const parsed = res.parsed_output;
    if (!parsed) return null;
    // Guardrail: plan changes need evidence beyond a single model judgment.
    const athleteStruggling = (run.feel != null && run.feel <= 2) || (run.perceivedEffort != null && run.perceivedEffort >= 9 && !planned?.isKey);
    if ((parsed.suggestedAction === "ease_next_days" || parsed.suggestedAction === "add_recovery_day") && fitness.tsb > -30 && !athleteStruggling) {
      parsed.suggestedAction = "none";
      parsed.actionReason = "";
    }
    const analysis: WorkoutAnalysis = {
      ...parsed,
      executionScore: planned ? parsed.executionScore : null,
      model: ANALYSIS_MODEL,
      createdAt: new Date().toISOString(),
    };
    await patchActivity(userId, run.id, { analysis });
    return analysis;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn("[analysis] rate limited");
    else if (err instanceof Anthropic.APIError) console.error(`[analysis] API error ${err.status}:`, err.message);
    else console.error("[analysis] failed", err);
    return null;
  }
}
