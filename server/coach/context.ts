/**
 * Athlete context: the compact, numbers-first picture the coach (and the app's Today screen)
 * works from.
 */
import type { PlanWorkout, Run } from "@shared/schema";
import {
  type RaceType,
  type Sport,
  type Thresholds,
  RACES,
  toSport,
  formatRunPace,
  formatSwimPace,
  formatDuration,
  formatDistance,
  formatClock,
  runPaceZones,
  swimZones,
  powerZones,
  hrZones,
  effectiveLthr,
  racePacing,
  vdotFromThresholdPace,
  predictRaceSeconds,
} from "@shared/physiology";
import { isValidStructure, describeWorkout, structureToDsl, type WorkoutStructure } from "@shared/workout-structure";
import { addDays, daysBetween } from "@shared/training-load";
import { storage } from "../storage";
import {
  getActivePlan,
  getActivitiesBetween,
  getPlanWorkoutsBetween,
  getThresholdState,
  prefsFromProfile,
  todayInTz,
  type AthletePrefs,
} from "../data";
import { getFitness, activityMovingSec } from "../analytics/load";

export function thresholdsText(th: Thresholds, prefs: AthletePrefs): string {
  const parts: string[] = [];
  parts.push(th.ftp ? `FTP ${th.ftp} W${th.weightKg ? ` (${(th.ftp / th.weightKg).toFixed(2)} W/kg)` : ""}` : "FTP unknown");
  parts.push(th.runThresholdPace ? `run threshold pace ${formatRunPace(th.runThresholdPace, prefs.units)}` : "run threshold pace unknown");
  parts.push(th.swimCss ? `swim CSS ${formatSwimPace(th.swimCss, prefs.pool)}` : "CSS unknown");
  if (th.lthrRun) parts.push(`run LTHR ${th.lthrRun}`);
  if (th.lthrBike) parts.push(`bike LTHR ${th.lthrBike}`);
  if (th.maxHr) parts.push(`max HR ${th.maxHr}`);
  if (th.restingHr) parts.push(`resting HR ${th.restingHr}`);
  if (th.weightKg) parts.push(`weight ${th.weightKg} kg`);
  if (th.runThresholdPace) parts.push(`VO2max (VDOT) ≈ ${vdotFromThresholdPace(th.runThresholdPace).toFixed(1)}`);
  return parts.join("; ");
}

export function zonesText(th: Thresholds, prefs: AthletePrefs): string {
  const lines: string[] = [];
  if (th.ftp) lines.push(`Bike power: ${powerZones(th.ftp).map((z) => `Z${z.zone} ${z.label}`).join(", ")}`);
  if (th.runThresholdPace) lines.push(`Run pace: ${runPaceZones(th.runThresholdPace, prefs.units).map((z) => `Z${z.zone} ${z.label}`).join(", ")}`);
  if (th.swimCss) lines.push(`Swim pace: ${swimZones(th.swimCss, prefs.pool).map((z) => `Z${z.zone} ${z.label}`).join(", ")}`);
  const lr = effectiveLthr(th, "run");
  if (lr) lines.push(`Run HR: ${hrZones(lr, "run").map((z) => `Z${z.zone} ${z.label}`).join(", ")}`);
  const lb = effectiveLthr(th, "bike");
  if (lb) lines.push(`Bike HR: ${hrZones(lb, "bike").map((z) => `Z${z.zone} ${z.label}`).join(", ")}`);
  return lines.join("\n");
}

export function activityLine(r: Run, prefs: AthletePrefs): string {
  const sport = toSport(r.sportType);
  const secs = activityMovingSec(r);
  const bits = [
    r.date,
    sport ?? r.sportType,
    `"${r.title ?? r.runType}"`,
    formatDuration(secs),
    r.distanceMeters ? formatDistance(r.distanceMeters, sport, prefs.units, prefs.pool) : null,
    sport === "run" && r.distanceMeters && secs ? formatRunPace(secs / (r.distanceMeters / 1000), prefs.units) : null,
    sport === "swim" && r.distanceMeters && secs ? formatSwimPace((secs / r.distanceMeters) * 100, prefs.pool) : null,
    r.normalizedPower ? `NP ${r.normalizedPower}W` : r.averagePower ? `${r.averagePower}W` : null,
    r.heartRateAvg ? `HR ${r.heartRateAvg}` : null,
    r.tss != null ? `${Math.round(r.tss)} TSS` : null,
    r.intensityFactor ? `IF ${r.intensityFactor.toFixed(2)}` : null,
    r.perceivedEffort ? `RPE ${r.perceivedEffort}` : null,
    r.analysis?.headline ? `note: ${r.analysis.headline}` : null,
  ].filter(Boolean);
  return `[${r.id}] ${bits.join(" · ")}`;
}

export function plannedLine(w: PlanWorkout, th: Thresholds, prefs: AthletePrefs, withDsl = false): string {
  const structure = isValidStructure(w.structure) ? (w.structure as WorkoutStructure) : null;
  const status = w.isCompleted ? "DONE" : w.status === "skipped" ? "SKIPPED" : "planned";
  const head = `[${w.id}] ${w.date} ${w.sport ?? w.workoutType} "${w.title}"${w.isKey ? " (key)" : ""} ${status} · ${formatDuration(w.plannedDurationSec ?? 0)} · ${Math.round(w.plannedTss ?? 0)} TSS`;
  if (!structure) return `${head}${w.description ? ` — ${w.description.slice(0, 160)}` : ""}`;
  const desc = describeWorkout(structure, th, prefs);
  return withDsl ? `${head}\n    DSL: ${structureToDsl(structure, prefs.pool).replace(/\n/g, " | ")}\n    = ${desc}` : `${head} — ${desc}`;
}

export interface OverviewData {
  prefs: AthletePrefs;
  today: string;
  text: string;
}

/** Full athlete overview — the coach's primary briefing tool. */
export async function buildOverview(userId: string): Promise<OverviewData> {
  const profile = await storage.getProfile(userId);
  const prefs = prefsFromProfile(profile);
  const today = todayInTz(prefs.tz);
  const [thState, fitness, recent, upcoming, plan, health, strava] = await Promise.all([
    getThresholdState(userId),
    getFitness(userId, prefs.tz, { historyDays: 28 }),
    getActivitiesBetween(userId, addDays(today, -14), today),
    getPlanWorkoutsBetween(userId, today, addDays(today, 10)),
    getActivePlan(userId),
    storage.getHealthLogs(userId, 60),
    storage.getIntegration(userId, "strava"),
  ]);
  const th = thState.values;
  const lines: string[] = [];
  lines.push(`TODAY: ${today} (${new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })})`);
  lines.push(
    `ATHLETE: ${profile?.fullName ?? "athlete"}, level ${profile?.fitnessLevel ?? "?"}, age ${profile?.age ?? "?"}, sports ${JSON.stringify(profile?.sports ?? [])}, units ${prefs.units}, pool ${prefs.pool}, weekly time ${profile?.weeklyHoursGoal ?? "?"} h, limiter ${profile?.limiter ?? "none stated"}`,
  );
  const sched = (profile?.weeklySchedule as { day: number; maxMinutes: number; isLongDay: boolean }[] | null) ?? [];
  if (sched.length) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    lines.push(`AVAILABILITY: ${sched.map((d) => `${names[d.day]} ${d.maxMinutes}min${d.isLongDay ? " (long day)" : ""}`).join(", ")}`);
  }
  lines.push(`THRESHOLDS: ${thresholdsText(th, prefs)}`);
  const sources = Object.entries(thState.current).map(([m, r]) => `${m}: ${r!.source} ${r!.effectiveDate}`);
  if (sources.length) lines.push(`  (sources: ${sources.join(", ")})`);
  if (thState.suggestions.length) lines.push(`  PENDING THRESHOLD SUGGESTIONS: ${thState.suggestions.map((s) => `${s.metric}=${s.value} (${s.note})`).join("; ")}`);

  const race = profile?.goalRaceType as RaceType | null;
  if (race && RACES[race] && profile?.targetRaceDate) {
    const days = daysBetween(today, profile.targetRaceDate);
    lines.push(`GOAL RACE: ${RACES[race].label} on ${profile.targetRaceDate} (${days} days)`);
    const pacing = racePacing(race, th, profile.fitnessLevel);
    if (pacing) {
      const p: string[] = [];
      if (pacing.swim) p.push(`swim ${formatSwimPace(pacing.swim.paceSec, prefs.pool)} ≈ ${formatClock(pacing.swim.timeSec)}`);
      if (pacing.bike) p.push(`bike ${pacing.bike.powerLow}-${pacing.bike.powerHigh} W${pacing.bike.timeSec ? ` ≈ ${formatClock(pacing.bike.timeSec)}` : ""}`);
      if (pacing.run) p.push(`run ${formatRunPace(pacing.run.paceSec, prefs.units)} ≈ ${formatClock(pacing.run.timeSec)}`);
      if (pacing.totalSec) p.push(`total ≈ ${formatClock(pacing.totalSec)}`);
      lines.push(`  Current race-pace targets (model estimate from thresholds): ${p.join("; ")}`);
    }
  }
  if (th.runThresholdPace) {
    const v = vdotFromThresholdPace(th.runThresholdPace);
    lines.push(
      `RUN RACE PREDICTIONS (fresh, open race): 5K ${formatClock(predictRaceSeconds(v, 5000))}, 10K ${formatClock(predictRaceSeconds(v, 10000))}, HM ${formatClock(predictRaceSeconds(v, 21097.5))}, M ${formatClock(predictRaceSeconds(v, 42195))}`,
    );
  }
  lines.push(
    `FITNESS: CTL ${fitness.ctl}, ATL ${fitness.atl}, TSB ${fitness.tsb} (${fitness.form.label}), ramp ${fitness.rampRate ?? "n/a"} CTL/wk. By sport CTL: swim ${fitness.bySport.swim.ctl}, bike ${fitness.bySport.bike.ctl}, run ${fitness.bySport.run.ctl}`,
  );
  if (plan) {
    const pd = plan.planData as { phases?: { phase: string; startWeek: number; weeks: number }[]; weeks?: { start: string; phase: string; targetHours: number }[] } | null;
    const wk = pd?.weeks?.filter((w) => w.start <= today).pop();
    lines.push(`PLAN: "${plan.title}" ${plan.startDate} → ${plan.endDate}${wk ? `; this week: ${wk.phase} phase, target ${wk.targetHours} h` : ""}`);
  } else {
    lines.push("PLAN: none yet");
  }
  lines.push("UPCOMING (next 10 days):");
  if (upcoming.length) for (const w of upcoming) lines.push(`  ${plannedLine(w, th, prefs)}`);
  else lines.push("  nothing scheduled");
  lines.push("RECENT ACTIVITIES (14 days):");
  if (recent.length) for (const r of recent) lines.push(`  ${activityLine(r, prefs)}`);
  else lines.push("  none");
  const active = health.filter((h) => !h.resolvedDate);
  if (active.length) lines.push(`HEALTH (active): ${active.map((h) => `[${h.id}] ${h.date} ${h.type} sev ${h.severity}${h.bodyPart ? ` ${h.bodyPart}` : ""}: ${h.description}`).join("; ")}`);
  lines.push(
    `DATA: Strava ${strava?.isActive ? `connected, last sync ${strava.lastSyncedAt ? new Date(strava.lastSyncedAt).toISOString() : "never"}` : "NOT connected"}`,
  );
  return { prefs, today, text: lines.join("\n") };
}

/** Short per-turn context appended to each user message (keeps the cached prefix stable). */
export async function buildTurnContext(userId: string): Promise<string> {
  const profile = await storage.getProfile(userId);
  const prefs = prefsFromProfile(profile);
  const today = todayInTz(prefs.tz);
  const [fitness, todays, last] = await Promise.all([
    getFitness(userId, prefs.tz, { historyDays: 1 }),
    getPlanWorkoutsBetween(userId, today, addDays(today, 1)),
    getActivitiesBetween(userId, addDays(today, -2), today),
  ]);
  const th = (await getThresholdState(userId)).values;
  const weekday = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const parts = [
    `Today is ${weekday} ${today} (athlete's local date).`,
    `Form: CTL ${fitness.ctl}, ATL ${fitness.atl}, TSB ${fitness.tsb} (${fitness.form.label}).`,
    todays.length ? `Planned today/tomorrow: ${todays.map((w) => `${w.date} ${w.title}${w.isCompleted ? " (done)" : ""} [${w.id}]`).join("; ")}.` : "Nothing planned today/tomorrow.",
    last.length ? `Latest activities: ${last.slice(0, 3).map((r) => activityLine(r, prefs)).join(" | ")}` : "",
    `Thresholds: ${thresholdsText(th, prefs)}.`,
  ];
  return parts.filter(Boolean).join("\n");
}

export type { Sport };
