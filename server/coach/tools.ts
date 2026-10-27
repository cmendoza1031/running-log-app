/**
 * Coach tools. Each tool = zod schema (validated before execution) + executor.
 * Results are compact text/JSON meant for the model.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import {
  RACES,
  type RaceType,
  type Sport,
  toSport,
  formatDuration,
  formatDistance,
  formatClock,
} from "@shared/physiology";
import { describeWorkout, structureToDsl, WorkoutParseError, isValidStructure, type WorkoutStructure } from "@shared/workout-structure";
import { addDays } from "@shared/training-load";
import { WEEKLY_HOURS_BUCKETS } from "@shared/weekly-hours-bucket";
import { storage } from "../storage";
import {
  getActivity,
  getActivitiesBetween,
  getPlanWorkout,
  getPlanWorkoutsBetween,
  getThresholds,
  insertPlanWorkouts,
  patchPlanWorkout,
  deletePlanWorkouts,
  prefsFromProfile,
  todayInTz,
  getActivePlan,
} from "../data";
import { buildOverview, activityLine, plannedLine, zonesText, thresholdsText } from "./context";
import { describeActivityForModel } from "./analysis";
import { getFitness, weeklyVolume, weekStart, intensityDistribution, activityMovingSec } from "../analytics/load";
import { createPlanForUser, adaptUpcoming, buildWorkoutFromDsl, ensureActivePlan, planningThresholds } from "../planning/service";
import { applyThresholdInput, ThresholdInputError } from "../analytics/threshold-input";
import { syncUser } from "../sync";

export interface ToolContext {
  userId: string;
}

interface CoachTool<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  status: string;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<string>;
}

function defineTool<S extends z.ZodType>(t: CoachTool<S>): CoachTool<S> {
  return t;
}

const SPORT = z.enum(["swim", "bike", "run"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const RACE_TYPES = Object.keys(RACES) as [RaceType, ...RaceType[]];

// ─── Tools ────────────────────────────────────────────────────────────────────

const getOverview = defineTool({
  name: "get_athlete_overview",
  description:
    "PRIMARY BRIEFING. Profile, availability, thresholds (+ pending auto-detected suggestions), goal race with model race-pace targets, run race predictions, fitness/fatigue/form (CTL/ATL/TSB, ramp) overall and by sport, current plan/phase, the next 10 days of planned workouts (with ids), the last 14 days of activities (with ids and AI note headlines), active health issues, and Strava sync status. Call this before giving training advice, unless you already called it in this conversation and nothing changed.",
  schema: z.object({}),
  status: "Reviewing your training…",
  run: async (_i, ctx) => (await buildOverview(ctx.userId)).text,
});

const getZones = defineTool({
  name: "get_training_zones",
  description: "All training zones in the athlete's units: bike power (Coggan), run pace, swim pace (CSS-based), run & bike heart rate (Friel, %LTHR).",
  schema: z.object({}),
  status: "Checking your zones…",
  run: async (_i, ctx) => {
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const th = await getThresholds(ctx.userId);
    return `${thresholdsText(th, prefs)}\n${zonesText(th, prefs) || "No thresholds set yet — ask the athlete or use update_thresholds."}`;
  },
});

const getActivities = defineTool({
  name: "get_activities",
  description: "List completed activities in a date range (max 120 days), newest first, one line each with id, duration, distance, pace/power, HR, TSS, IF, RPE, AI note headline.",
  schema: z.object({ start_date: DATE, end_date: DATE, sport: SPORT.optional() }),
  status: "Looking through your workouts…",
  run: async (i, ctx) => {
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const start = i.start_date < addDays(i.end_date, -120) ? addDays(i.end_date, -120) : i.start_date;
    const acts = (await getActivitiesBetween(ctx.userId, start, i.end_date)).filter((r) => !i.sport || toSport(r.sportType) === i.sport);
    if (!acts.length) return "No activities in that range.";
    return acts.slice(0, 150).map((r) => activityLine(r, prefs)).join("\n");
  },
});

const getActivityDetail = defineTool({
  name: "get_activity_detail",
  description: "Full detail for one activity: laps, zone distribution, decoupling, efficiency factor, athlete notes/RPE, the planned session it matched, and the AI post-workout note.",
  schema: z.object({ activity_id: z.string() }),
  status: "Analyzing that session…",
  run: async (i, ctx) => {
    const r = await getActivity(ctx.userId, i.activity_id);
    if (!r) return "Activity not found.";
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const th = await getThresholds(ctx.userId);
    const lines = [describeActivityForModel(r, th, prefs)];
    if (r.planWorkoutId) {
      const w = await getPlanWorkout(ctx.userId, r.planWorkoutId);
      if (w) lines.push(`Matched planned workout: ${plannedLine(w, th, prefs)}`);
    }
    if (r.analysis) lines.push(`AI note: ${r.analysis.headline} — ${r.analysis.summary} Next time: ${r.analysis.nextTime}`);
    return lines.join("\n");
  },
});

const getTrends = defineTool({
  name: "get_training_trends",
  description:
    "Longitudinal view: weekly hours/distance/TSS per sport and planned-vs-completed compliance, CTL at each week's end, intensity distribution (low/moderate/high) for the last 4 weeks per sport, and efficiency/decoupling trends plus best efforts (power curve, run bests).",
  schema: z.object({ weeks: z.number().int().min(2).max(52).default(8) }),
  status: "Crunching your trends…",
  run: async (i, ctx) => {
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const today = todayInTz(prefs.tz);
    const first = weekStart(addDays(today, -7 * (i.weeks - 1)));
    const weeks = Array.from({ length: i.weeks }, (_, k) => addDays(first, k * 7));
    const [acts, plan, fit] = await Promise.all([
      getActivitiesBetween(ctx.userId, first, today),
      getPlanWorkoutsBetween(ctx.userId, first, addDays(first, i.weeks * 7 - 1)),
      getFitness(ctx.userId, prefs.tz, { historyDays: i.weeks * 7 }),
    ]);
    const vols = weeklyVolume(acts, plan, weeks);
    const lines = ["WEEK | total h | swim h/dist | bike h/dist | run h/dist | TSS | planned done/total | CTL end"];
    for (const v of vols) {
      const end = fit.series.find((p) => p.date === addDays(v.week, 6)) ?? fit.series[fit.series.length - 1];
      const sp = (s: "swim" | "bike" | "run") =>
        `${(v.sports[s].sec / 3600).toFixed(1)}/${formatDistance(v.sports[s].meters, s, prefs.units, prefs.pool)}`;
      lines.push(
        `${v.week} | ${(v.totalSec / 3600).toFixed(1)} | ${sp("swim")} | ${sp("bike")} | ${sp("run")} | ${Math.round(v.totalTss)} | ${v.planned.completed}/${v.planned.count} | ${end?.ctl ?? "?"}`,
      );
    }
    const last4 = acts.filter((r) => r.date >= addDays(today, -28));
    lines.push("INTENSITY DISTRIBUTION last 4 weeks (low/moderate/high):");
    for (const s of ["all", "swim", "bike", "run"] as const) {
      const d = intensityDistribution(last4, s);
      if (d.totalSec > 0) lines.push(`  ${s}: ${Math.round(d.low * 100)}% / ${Math.round(d.moderate * 100)}% / ${Math.round(d.high * 100)}% (${formatDuration(d.totalSec)}, ${d.source})`);
    }
    const ef = acts.filter((r) => r.efficiencyFactor != null || r.decoupling != null);
    if (ef.length) {
      lines.push("EFFICIENCY/DECOUPLING (steady sessions):");
      for (const r of ef.slice(0, 20)) lines.push(`  ${r.date} ${toSport(r.sportType)} "${r.title}" EF ${r.efficiencyFactor ?? "-"} decoupling ${r.decoupling ?? "-"}%`);
    }
    const bestPower: Record<string, number> = {};
    const bestRun: Record<string, number> = {};
    for (const r of acts) {
      const b = r.bestEfforts as Record<string, number> | null;
      if (!b) continue;
      const target = toSport(r.sportType) === "bike" ? bestPower : toSport(r.sportType) === "run" ? bestRun : null;
      if (!target) continue;
      for (const [k, v] of Object.entries(b)) {
        if (toSport(r.sportType) === "bike") target[k] = Math.max(target[k] ?? 0, v);
        else target[k] = Math.min(target[k] ?? Infinity, v);
      }
    }
    if (Object.keys(bestPower).length) lines.push(`BEST POWER (period): ${Object.entries(bestPower).map(([s, w]) => `${formatDuration(+s)} ${w}W`).join(", ")}`);
    if (Object.keys(bestRun).length) lines.push(`BEST RUN EFFORTS (period): ${Object.entries(bestRun).map(([m, s]) => `${m}m ${formatClock(s)}`).join(", ")}`);
    return lines.join("\n");
  },
});

const getPlan = defineTool({
  name: "get_plan",
  description: "Planned workouts in a date range (max 60 days) with ids, status, the workout DSL, and the resolved targets in the athlete's units. Use before editing workouts.",
  schema: z.object({ start_date: DATE, end_date: DATE }),
  status: "Opening your calendar…",
  run: async (i, ctx) => {
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const th = await planningThresholds(ctx.userId, profile?.fitnessLevel);
    const end = i.end_date > addDays(i.start_date, 60) ? addDays(i.start_date, 60) : i.end_date;
    const ws = await getPlanWorkoutsBetween(ctx.userId, i.start_date, end);
    const plan = await getActivePlan(ctx.userId);
    const pd = plan?.planData as { phases?: unknown; weeks?: { start: string; phase: string; targetHours: number }[] } | null;
    const head = plan
      ? `Plan "${plan.title}" ${plan.startDate}→${plan.endDate}. Weeks in range: ${(pd?.weeks ?? [])
          .filter((w) => w.start >= addDays(i.start_date, -6) && w.start <= end)
          .map((w) => `${w.start} ${w.phase} ${w.targetHours}h`)
          .join(", ")}`
      : "No active plan.";
    return [head, ...(ws.length ? ws.map((w) => plannedLine(w, th, prefs, true)) : ["No workouts in range."])].join("\n");
  },
});

const createPlan = defineTool({
  name: "create_training_plan",
  description:
    "Generate a complete periodized plan with the Vista plan engine (base → build → peak → taper → race, 3:1 recovery weeks, ≤10%/week ramps, race-specific key sessions, bricks, CSS sets, race-week template, race-day pacing) using the athlete's availability, thresholds and current volume. REPLACES future unfinished workouts of any existing plan. Afterwards, customize individual sessions with save_workout if the athlete has specific needs. Confirm with the athlete before replacing an existing plan.",
  schema: z.object({
    race_type: z.enum(RACE_TYPES).describe("general = no race, rolling 12-week base/build"),
    race_date: DATE.optional(),
    race_name: z.string().optional(),
    start_date: DATE.optional().describe("Defaults to today"),
    weekly_hours: z.number().min(2).max(30).optional().describe("Peak weekly hours; defaults to the athlete's stated availability"),
    limiter: SPORT.optional().describe("Sport to give extra emphasis"),
  }),
  status: "Building your plan…",
  run: async (i, ctx) => {
    if (i.race_type !== "general" && !i.race_date) return "ERROR: race_date is required for a race plan (or use race_type general).";
    const { plan, generated, workoutCount } = await createPlanForUser(ctx.userId, {
      race: i.race_type,
      raceDate: i.race_date ?? null,
      raceName: i.race_name ?? null,
      startDate: i.start_date ?? null,
      weeklyHours: i.weekly_hours ?? null,
      limiter: i.limiter ?? null,
    });
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const th = await planningThresholds(ctx.userId, profile?.fitnessLevel);
    const lines = [
      `Created "${plan.title}" ${plan.startDate} → ${plan.endDate}: ${workoutCount} workouts over ${generated.weeks.length} weeks.`,
      `Phases: ${generated.phases.map((p) => `${p.phase} ×${p.weeks}`).join(" → ")}`,
      `Sport split: swim ${Math.round(generated.split.swim * 100)}%, bike ${Math.round(generated.split.bike * 100)}%, run ${Math.round(generated.split.run * 100)}%`,
      `Weekly hours: ${generated.weeks.map((w) => w.targetHours).join(", ")}`,
      "First two weeks:",
    ];
    const ws = await getPlanWorkoutsBetween(ctx.userId, plan.startDate, addDays(plan.startDate, 13));
    for (const w of ws) lines.push(`  ${plannedLine(w, th, prefs)}`);
    return lines.join("\n");
  },
});

const saveWorkout = defineTool({
  name: "save_workout",
  description:
    "Create a new planned workout, or replace an existing one (pass workout_id). The workout is written in the Vista workout DSL (see system prompt). Returns the resolved targets, duration and TSS. On a DSL error you get the message back — fix and retry.",
  schema: z.object({
    workout_id: z.string().optional().describe("Omit to create a new workout"),
    date: DATE,
    sport: SPORT,
    title: z.string().min(2).max(60),
    workout: z.string().min(3).describe("Workout DSL, one step per line"),
    description: z.string().max(600).optional().describe("Purpose + execution cues (why this session, how it should feel)"),
    is_key: z.boolean().optional(),
  }),
  status: "Updating your calendar…",
  run: async (i, ctx) => {
    let built;
    try {
      built = await buildWorkoutFromDsl(ctx.userId, i.sport, i.workout);
    } catch (err) {
      if (err instanceof WorkoutParseError) return `DSL ERROR: ${err.message}. Nothing was saved.`;
      throw err;
    }
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const th = await planningThresholds(ctx.userId, profile?.fitnessLevel);
    const legacy = i.sport === "bike" ? "easy_ride" : i.sport === "swim" ? "easy_swim" : "easy";
    let saved;
    if (i.workout_id) {
      const existing = await getPlanWorkout(ctx.userId, i.workout_id);
      if (!existing) return "ERROR: workout_id not found.";
      saved = await patchPlanWorkout(ctx.userId, i.workout_id, {
        date: i.date,
        sport: i.sport,
        title: i.title,
        description: i.description ?? existing.description,
        structure: built.structure,
        ...built.metrics,
        isKey: i.is_key ?? existing.isKey,
        status: existing.isCompleted ? existing.status : "planned",
      });
    } else {
      const plan = await ensureActivePlan(ctx.userId);
      [saved] = await insertPlanWorkouts([
        {
          planId: plan.id,
          userId: ctx.userId,
          date: i.date,
          sport: i.sport,
          workoutType: legacy,
          title: i.title,
          description: i.description ?? null,
          structure: built.structure,
          ...built.metrics,
          isKey: i.is_key ?? false,
          status: "planned",
          isCompleted: false,
        },
      ]);
    }
    return `Saved: ${plannedLine(saved!, th, prefs)}`;
  },
});

const changeWorkout = defineTool({
  name: "move_or_skip_workout",
  description: "Move a planned workout to another date, mark it skipped, restore a skipped one, or delete it.",
  schema: z.object({ workout_id: z.string(), action: z.enum(["move", "skip", "restore", "delete"]), new_date: DATE.optional() }),
  status: "Updating your calendar…",
  run: async (i, ctx) => {
    const w = await getPlanWorkout(ctx.userId, i.workout_id);
    if (!w) return "ERROR: workout not found.";
    if (i.action === "delete") {
      await deletePlanWorkouts(ctx.userId, [w.id]);
      return `Deleted "${w.title}" on ${w.date}.`;
    }
    if (i.action === "move") {
      if (!i.new_date) return "ERROR: new_date required for move.";
      await patchPlanWorkout(ctx.userId, w.id, { date: i.new_date });
      return `Moved "${w.title}" from ${w.date} to ${i.new_date}.`;
    }
    await patchPlanWorkout(ctx.userId, w.id, { status: i.action === "skip" ? "skipped" : "planned" });
    return `${i.action === "skip" ? "Skipped" : "Restored"} "${w.title}" on ${w.date}.`;
  },
});

const adjust = defineTool({
  name: "adjust_upcoming_training",
  description:
    "Deterministic adaptation of the next days: ease_next_days (next 3 days: key sessions → easy aerobic at 80% duration, others −20%) or add_recovery_day (tomorrow becomes rest, the day after is eased). Use when fatigue, illness, poor sleep or life stress warrant it.",
  schema: z.object({ action: z.enum(["ease_next_days", "add_recovery_day"]) }),
  status: "Adjusting your week…",
  run: async (i, ctx) => (await adaptUpcoming(ctx.userId, i.action)).summary,
});

const updateThresholds = defineTool({
  name: "update_thresholds",
  description:
    "Set the athlete's thresholds when they tell you a value or a test result. All future workouts re-target automatically. Paces as strings with units, e.g. run '4:15/km' or '6:50/mi', swim '1:45/100m' or '1:36/100yd'. recent_race sets run threshold pace via VDOT; css_test takes 400 and 200 times.",
  schema: z.object({
    ftp_watts: z.number().min(50).max(600).optional(),
    run_threshold_pace: z.string().optional(),
    swim_css: z.string().optional(),
    lthr_run: z.number().optional(),
    lthr_bike: z.number().optional(),
    max_hr: z.number().optional(),
    resting_hr: z.number().optional(),
    weight_kg: z.number().optional(),
    recent_race: z.object({ distance_km: z.number(), time: z.string().describe("h:mm:ss or mm:ss") }).optional(),
    css_test: z.object({ t400: z.string(), t200: z.string() }).optional(),
  }),
  status: "Updating your thresholds…",
  run: async (i, ctx) => {
    try {
      const writes = await applyThresholdInput(ctx.userId, {
        ftp: i.ftp_watts,
        runThresholdPace: i.run_threshold_pace,
        swimCss: i.swim_css,
        lthrRun: i.lthr_run,
        lthrBike: i.lthr_bike,
        maxHr: i.max_hr,
        restingHr: i.resting_hr,
        weightKg: i.weight_kg,
        recentRace: i.recent_race ? { distanceMeters: i.recent_race.distance_km * 1000, time: i.recent_race.time } : undefined,
        cssTest: i.css_test,
      });
      const profile = await storage.getProfile(ctx.userId);
      const th = await getThresholds(ctx.userId);
      return `Updated ${writes.map((w) => w.metric).join(", ") || "nothing"}. Now: ${thresholdsText(th, prefsFromProfile(profile))}. Future workouts and loads were re-targeted.`;
    } catch (err) {
      if (err instanceof ThresholdInputError) return `ERROR: ${err.message}`;
      throw err;
    }
  },
});

const updateProfile = defineTool({
  name: "update_athlete_profile",
  description: "Update goal race, weekly time, level, limiter, availability, or display units. Does not rebuild the plan — call create_training_plan afterwards if the plan should change.",
  schema: z.object({
    goal_race_type: z.enum(RACE_TYPES).optional(),
    race_date: DATE.optional(),
    race_name: z.string().optional(),
    weekly_hours_bucket: z.enum(WEEKLY_HOURS_BUCKETS).optional(),
    fitness_level: z.enum(["beginner", "intermediate", "advanced", "elite"]).optional(),
    limiter: SPORT.nullable().optional(),
    unit_system: z.enum(["imperial", "metric"]).optional(),
    pool_unit: z.enum(["yards", "meters"]).optional(),
    weekly_schedule: z
      .array(z.object({ day: z.number().int().min(0).max(6).describe("0=Sun … 6=Sat"), maxMinutes: z.number().int().min(15).max(600), isLongDay: z.boolean() }))
      .optional(),
  }),
  status: "Updating your profile…",
  run: async (i, ctx) => {
    const patch: Record<string, unknown> = {};
    if (i.goal_race_type) patch.goalRaceType = i.goal_race_type;
    if (i.race_date) patch.targetRaceDate = i.race_date;
    if (i.race_name) patch.targetRace = i.race_name;
    if (i.weekly_hours_bucket) patch.weeklyHoursBucket = i.weekly_hours_bucket;
    if (i.fitness_level) patch.fitnessLevel = i.fitness_level;
    if (i.limiter !== undefined) patch.limiter = i.limiter;
    if (i.unit_system) patch.unitSystem = i.unit_system;
    if (i.pool_unit) patch.poolUnit = i.pool_unit;
    if (i.weekly_schedule) patch.weeklySchedule = i.weekly_schedule;
    await storage.upsertProfile(ctx.userId, patch as never);
    return `Profile updated: ${Object.keys(patch).join(", ")}.`;
  },
});

const logHealth = defineTool({
  name: "log_health_status",
  description: "Record an injury, illness, fatigue or life-stress entry so training decisions account for it.",
  schema: z.object({
    type: z.enum(["injury", "illness", "fatigue", "life_stress"]),
    description: z.string(),
    severity: z.number().int().min(1).max(5),
    body_part: z.string().optional(),
    date: DATE,
  }),
  status: "Noting that…",
  run: async (i, ctx) => {
    const log = await storage.createHealthLog({ type: i.type, description: i.description, severity: i.severity, bodyPart: i.body_part, date: i.date }, ctx.userId);
    return `Logged ${i.type} [${log.id}].`;
  },
});

const resolveHealth = defineTool({
  name: "resolve_health_issue",
  description: "Mark a logged health issue as resolved.",
  schema: z.object({ id: z.string(), date: DATE }),
  status: "Updating health log…",
  run: async (i, ctx) => ((await storage.resolveHealthLog(i.id, i.date, ctx.userId)) ? "Resolved." : "ERROR: not found."),
});

const sync = defineTool({
  name: "sync_activities",
  description: "Pull the latest activities from Strava (covers Garmin/COROS/Wahoo/Apple Watch via their Strava sync). Use when the athlete says a workout is missing.",
  schema: z.object({}),
  status: "Syncing from Strava…",
  run: async (_i, ctx) => {
    const r = await syncUser(ctx.userId);
    if (r.error) return `Sync problem: ${r.error}`;
    return `Imported ${r.imported} new activities; ${r.analyzed} analyzed${r.thresholdChanges.length ? `; threshold updates: ${r.thresholdChanges.map((t) => `${t.metric}=${t.value} (${t.status})`).join(", ")}` : ""}.`;
  },
});

export const COACH_TOOLS = [
  getOverview,
  getZones,
  getActivities,
  getActivityDetail,
  getTrends,
  getPlan,
  createPlan,
  saveWorkout,
  changeWorkout,
  adjust,
  updateThresholds,
  updateProfile,
  logHealth,
  resolveHealth,
  sync,
] as CoachTool<z.ZodType>[];

function jsonSchemaFor(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const js = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return js as Anthropic.Tool.InputSchema;
}

/** Tool definitions for the API — deterministic order so the prompt cache prefix is stable. */
export const TOOL_DEFINITIONS: Anthropic.Tool[] = COACH_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: jsonSchemaFor(t.schema),
}));

export function toolStatus(name: string): string {
  return COACH_TOOLS.find((t) => t.name === name)?.status ?? "Working…";
}

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const tool = COACH_TOOLS.find((t) => t.name === name);
  if (!tool) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return { content: `INVALID INPUT: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };
  }
  try {
    return { content: await tool.run(parsed.data, ctx), isError: false };
  } catch (err) {
    console.error(`[coach] tool ${name} failed`, err);
    return { content: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

export { isValidStructure, structureToDsl, describeWorkout, activityMovingSec };
export type { WorkoutStructure, Sport };
