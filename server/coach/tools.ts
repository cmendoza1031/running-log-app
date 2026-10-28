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
  racePacing,
} from "@shared/physiology";
import { sessionFueling, raceFueling, fuelingLine, formatRange, intensityFromTss, type FuelingProfile, type FuelingTarget } from "@shared/fueling";
import { COACH_MEMORY_CATEGORIES } from "@shared/schema";
import { paceMath, PaceMathError } from "@shared/pace-math";
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
  saveMemory,
  archiveMemory,
} from "../data";
import { buildOverview, activityLine, plannedHead, plannedLine, zonesText, thresholdsText } from "./context";
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
    "Full briefing: the athlete card (profile, availability, thresholds, goal race + pacing, plan phase, health, coach notes — already in the first message of each conversation) plus run race predictions, fitness/fatigue/form (CTL/ATL/TSB, ramp) overall and by sport, wellness, the next 10 days of planned workouts (one line each, with ids) and the last 14 days of activities (with ids and AI note headlines). Call it for weekly reviews, planning advice or when the card may be stale; not for simple questions the card answers.",
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
  description:
    "Completed activities, newest first, one line each with id, duration, distance, pace/power, HR, TSS, IF, RPE, AI note headline. Without dates: the most recent `limit` activities from the last 120 days. With dates: that range (max 120 days). For week-by-week volume use get_training_trends instead.",
  schema: z.object({
    start_date: DATE.optional(),
    end_date: DATE.optional().describe("Defaults to today"),
    sport: SPORT.optional(),
    limit: z.number().int().min(1).max(150).default(10).describe("Max activities returned (default 10)"),
  }),
  status: "Looking through your workouts…",
  run: async (i, ctx) => {
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const end = i.end_date ?? todayInTz(prefs.tz);
    const from = i.start_date ?? addDays(end, -120);
    const start = from < addDays(end, -120) ? addDays(end, -120) : from;
    const acts = (await getActivitiesBetween(ctx.userId, start, end)).filter((r) => !i.sport || toSport(r.sportType) === i.sport);
    if (!acts.length) return "No activities in that range.";
    const shown = acts.slice(0, i.limit);
    const more = acts.length - shown.length;
    return [...shown.map((r) => activityLine(r, prefs)), ...(more > 0 ? [`(+${more} older in range; raise limit or narrow dates to see them)`] : [])].join("\n");
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
  description:
    "Planned workouts. With a date range (max 60 days): one line per workout (id, date, sport, title, key, status, duration, TSS) plus the plan phase of each week. With workout_ids: full detail for those workouts (workout DSL + resolved targets in the athlete's units) — get this for the sessions you are about to rewrite or explain step by step. detail=\"full\" gives full detail for a whole range (expensive; avoid for more than a week).",
  schema: z.object({
    start_date: DATE.optional(),
    end_date: DATE.optional(),
    workout_ids: z.array(z.string()).max(20).optional(),
    detail: z.enum(["summary", "full"]).default("summary"),
  }),
  status: "Opening your calendar…",
  run: async (i, ctx) => {
    const profile = await storage.getProfile(ctx.userId);
    const prefs = prefsFromProfile(profile);
    const th = await planningThresholds(ctx.userId, profile?.fitnessLevel);
    if (i.workout_ids?.length) {
      const found = await Promise.all(i.workout_ids.map((id) => getPlanWorkout(ctx.userId, id)));
      return i.workout_ids.map((id, k) => (found[k] ? plannedLine(found[k]!, th, prefs, true) : `[${id}] not found`)).join("\n");
    }
    const start = i.start_date;
    if (!start || !i.end_date) return "ERROR: pass start_date and end_date, or workout_ids.";
    const end = i.end_date > addDays(start, 60) ? addDays(start, 60) : i.end_date;
    const ws = await getPlanWorkoutsBetween(ctx.userId, start, end);
    const plan = await getActivePlan(ctx.userId);
    const pd = plan?.planData as { phases?: unknown; weeks?: { start: string; phase: string; targetHours: number }[] } | null;
    const head = plan
      ? `Plan "${plan.title}" ${plan.startDate}→${plan.endDate}. Weeks in range: ${(pd?.weeks ?? [])
          .filter((w) => w.start >= addDays(start, -6) && w.start <= end)
          .map((w) => `${w.start} ${w.phase} ${w.targetHours}h`)
          .join(", ")}`
      : "No active plan.";
    const line = (w: (typeof ws)[number]) => (i.detail === "full" ? plannedLine(w, th, prefs, true) : plannedHead(w));
    return [head, ...(ws.length ? ws.map(line) : ["No workouts in range."])].join("\n");
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
    const lines = [
      `Created "${plan.title}" ${plan.startDate} → ${plan.endDate}: ${workoutCount} workouts over ${generated.weeks.length} weeks.`,
      `Phases: ${generated.phases.map((p) => `${p.phase} ×${p.weeks}`).join(" → ")}`,
      `Sport split: swim ${Math.round(generated.split.swim * 100)}%, bike ${Math.round(generated.split.bike * 100)}%, run ${Math.round(generated.split.run * 100)}%`,
      `Weekly hours: ${generated.weeks.map((w) => w.targetHours).join(", ")}`,
      "First two weeks:",
    ];
    const ws = await getPlanWorkoutsBetween(ctx.userId, plan.startDate, addDays(plan.startDate, 13));
    for (const w of ws) lines.push(`  ${plannedHead(w)}`);
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
    "Deterministic adaptation of the next days: ease_next_days (3 days: key sessions → easy aerobic at 80% duration, others −20%) or add_recovery_day (first day becomes rest, the day after is eased). The window starts TOMORROW unless include_today=true (use it when the athlete hasn't trained yet today). The result lists every changed session — report exactly those dates.",
  schema: z.object({ action: z.enum(["ease_next_days", "add_recovery_day"]), include_today: z.boolean().optional() }),
  status: "Adjusting your week…",
  run: async (i, ctx) => (await adaptUpcoming(ctx.userId, i.action, { includeToday: i.include_today })).summary,
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
    sweat_rate_ml_per_h: z.number().int().min(200).max(3000).optional().describe("Measured sweat rate"),
    sweat_sodium_mg_per_l: z.number().int().min(100).max(3000).optional().describe("From a sweat test"),
    carb_tolerance_g_per_h: z.number().int().min(20).max(150).optional().describe("Highest carb rate practised without GI issues"),
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
    if (i.sweat_rate_ml_per_h) patch.sweatRateMlPerH = i.sweat_rate_ml_per_h;
    if (i.sweat_sodium_mg_per_l) patch.sweatSodiumMgPerL = i.sweat_sodium_mg_per_l;
    if (i.carb_tolerance_g_per_h) patch.carbToleranceGPerH = i.carb_tolerance_g_per_h;
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

const remember = defineTool({
  name: "remember",
  description:
    "Save a durable fact about the athlete to long-term memory (shown in every future conversation under COACH NOTES). Use for things that stay true for weeks or more: injury history and triggers, preferences (e.g. hates treadmill, swims masters Tue/Thu), life constraints (job, kids, travel pattern), goals and motivations, past race results, equipment (power meter, pool access, trainer). Do NOT save daily state (today's soreness → log_health_status) or anything already in the profile/thresholds. To correct a note, pass its id.",
  schema: z.object({
    id: z.string().optional().describe("Existing note id to replace"),
    category: z.enum(COACH_MEMORY_CATEGORIES),
    note: z.string().min(3).max(400).describe("One self-contained fact, written in third person, with dates where relevant"),
  }),
  status: "Making a note…",
  run: async (i, ctx) => {
    const row = await saveMemory(ctx.userId, { id: i.id, category: i.category, note: i.note });
    return row ? `Saved [${row.id}].` : "ERROR: note not found.";
  },
});

const forget = defineTool({
  name: "forget",
  description: "Remove a long-term memory note that is no longer true (e.g. an injury fully healed months ago, a changed schedule).",
  schema: z.object({ id: z.string() }),
  status: "Updating notes…",
  run: async (i, ctx) => ((await archiveMemory(ctx.userId, i.id)) ? "Removed." : "ERROR: not found."),
});

function fuelingTargetText(label: string, t: FuelingTarget): string {
  return `${label}: ${fuelingLine(t)}${t.notes.length ? `\n  - ${t.notes.join("\n  - ")}` : ""}`;
}

const getFueling = defineTool({
  name: "get_fueling_plan",
  description:
    "Carb (g/h), fluid (ml/h) and sodium (mg/h) targets from the fueling model (Jeukendrup/ACSM), personalised by weight, sweat rate, sweat sodium and practised carb tolerance when known. Modes: a planned workout (workout_id), an ad-hoc session (sport + duration_min [+ intensity]), or race day (race=true: carb load, breakfast, per-leg plan from the goal race and current race-pace model; override leg_minutes if the athlete gives expected splits). Quote these numbers; don't invent your own.",
  schema: z.object({
    workout_id: z.string().optional(),
    sport: SPORT.optional(),
    duration_min: z.number().min(10).max(1200).optional(),
    intensity: z.enum(["easy", "moderate", "hard"]).optional(),
    race: z.boolean().optional(),
    leg_minutes: z.object({ swim: z.number().optional(), bike: z.number().optional(), run: z.number().optional() }).optional(),
    temp_c: z.number().min(-10).max(45).optional().describe("Expected air temperature"),
  }),
  status: "Working out your fueling…",
  run: async (i, ctx) => {
    const [profile, th] = await Promise.all([storage.getProfile(ctx.userId), getThresholds(ctx.userId)]);
    const fp: FuelingProfile = {
      weightKg: th.weightKg,
      sweatRateMlPerH: profile?.sweatRateMlPerH,
      sweatSodiumMgPerL: profile?.sweatSodiumMgPerL,
      carbToleranceGPerH: profile?.carbToleranceGPerH,
    };
    const known = [
      fp.weightKg ? `weight ${fp.weightKg} kg` : "weight unknown",
      fp.sweatRateMlPerH ? `sweat rate ${fp.sweatRateMlPerH} ml/h` : "sweat rate unknown (population estimate)",
      fp.sweatSodiumMgPerL ? `sweat sodium ${fp.sweatSodiumMgPerL} mg/L` : "sweat sodium unknown (assumed 900 mg/L)",
      fp.carbToleranceGPerH ? `practised carb max ${fp.carbToleranceGPerH} g/h` : "carb tolerance unknown (capped at 90 g/h)",
    ].join("; ");

    if (i.race) {
      const race = profile?.goalRaceType as RaceType | null;
      if (!race || !RACES[race]) return "ERROR: no goal race set. Set one with update_athlete_profile first.";
      const pacing = racePacing(race, th, profile?.fitnessLevel);
      const leg = (m: number | undefined, est: number | null | undefined) => (m ? m * 60 : est ?? undefined);
      const legs = { swim: leg(i.leg_minutes?.swim, pacing?.swim?.timeSec), bike: leg(i.leg_minutes?.bike, pacing?.bike?.timeSec), run: leg(i.leg_minutes?.run, pacing?.run?.timeSec) };
      if (!legs.swim && !legs.bike && !legs.run) return "ERROR: no leg time estimates (thresholds missing). Pass leg_minutes.";
      const plan = raceFueling(race, legs, fp, i.temp_c);
      const out = [`RACE FUELING — ${RACES[race].label}${i.temp_c != null ? `, ${i.temp_c}°C` : ""} (${known})`];
      if (plan.carbLoad) {
        out.push(`Carb load: ${plan.carbLoad.days} day(s) before, ${formatRange(plan.carbLoad.gPerKgPerDay, "g/kg/day")}${plan.carbLoad.gPerDay ? ` = ${formatRange(plan.carbLoad.gPerDay, "g/day")}` : ""}; cut fibre and fat.`);
      }
      out.push(`Breakfast: ${formatRange(plan.breakfast.hoursBefore, "h")} before${plan.breakfast.carbsG ? `, ${formatRange(plan.breakfast.carbsG, "g carbs")}` : ", 1-3 g/kg carbs"}. ${plan.breakfast.note}`);
      for (const l of plan.legs) out.push(fuelingTargetText(`${l.leg.toUpperCase()} (${formatClock(l.durationSec)})`, l.target));
      out.push(`Total in-race carbs ≈ ${formatRange(plan.totalCarbsG, "g")}`);
      out.push(...plan.notes.map((n) => `- ${n}`));
      return out.join("\n");
    }

    let durationSec = i.duration_min ? i.duration_min * 60 : 0;
    let sport = i.sport;
    let intensity = i.intensity === "easy" ? 0.6 : i.intensity === "hard" ? 0.85 : i.intensity === "moderate" ? 0.72 : undefined;
    let label = "Session";
    if (i.workout_id) {
      const w = await getPlanWorkout(ctx.userId, i.workout_id);
      if (!w) return "ERROR: workout not found.";
      durationSec ||= w.plannedDurationSec ?? 0;
      sport ??= (w.sport as Sport | null) ?? undefined;
      intensity ??= intensityFromTss(w.plannedTss, durationSec);
      label = `${w.date} "${w.title}"`;
    }
    if (!durationSec) return "ERROR: need workout_id or duration_min.";
    const t = sessionFueling({ durationSec, intensity, sport, tempC: i.temp_c }, fp);
    return `${fuelingTargetText(`${label} (${formatDuration(durationSec)}${sport ? ` ${sport}` : ""})`, t)}\n(${known})`;
  },
});

const paceCalc = defineTool({
  name: "pace_calculator",
  description:
    "Exact pace/split/distance/speed math. ALWAYS use this instead of computing in your head — rep split times, pace unit conversions (/mi ↔ /km, /100yd ↔ /100m), track lap times, finish times, distance conversions (mi/km/m/yd), speed ↔ pace. Give any combination: pace + distance → split time; time + distance → pace; pace + time → distance; pace or speed alone → converted; distance alone → converted.",
  schema: z.object({
    pace: z.string().optional().describe('m:ss with unit, e.g. "5:40/mi", "3:31/km", "1:34/100yd"'),
    time: z.string().optional().describe('m:ss or h:mm:ss, e.g. "3:30", "1:45:30"'),
    distance: z.string().optional().describe('number + unit, e.g. "1km", "400m", "1mi", "100yd", "26.2mi"'),
    speed_kmh: z.number().positive().optional(),
    speed_mph: z.number().positive().optional(),
  }),
  status: "Calculating…",
  run: async (i) => {
    try {
      return paceMath(i);
    } catch (e) {
      if (e instanceof PaceMathError) return `ERROR: ${e.message}`;
      throw e;
    }
  },
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
  remember,
  forget,
  getFueling,
  paceCalc,
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
