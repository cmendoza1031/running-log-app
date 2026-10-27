import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { storage } from "../storage";
import type { InsertPlanWorkout } from "@shared/schema";
import { WEEKLY_HOURS_BUCKETS, weeklyTimeCommitmentDisplay } from "@shared/weekly-hours-bucket";
import { syncStravaActivities } from "../integrations/strava";

// Helper to extract userId from LangGraph config
function getUserId(config?: RunnableConfig): string {
  const userId = config?.configurable?.userId as string | undefined;
  if (!userId) throw new Error("userId not found in config");
  return userId;
}

// Shared enum values used across multiple tool schemas
const ALL_WORKOUT_TYPES = [
  "easy", "tempo", "long", "interval", "threshold", "fartlek", "trail", "race", "recovery", "strides",
  "easy_ride", "tempo_ride", "long_ride", "interval_ride", "hill_ride", "sweet_spot", "race_ride", "recovery_ride",
  "easy_swim", "threshold_swim", "interval_swim", "open_water_swim", "drill", "race_swim", "css_test",
  "brick", "transition",
  "other",
] as const;

const ALL_WORKOUT_TYPES_WITH_REST = [...ALL_WORKOUT_TYPES, "rest"] as const;

const SPORT_TYPES = ["running", "cycling", "swimming", "triathlon"] as const;
const DISTANCE_UNITS = ["mi", "km", "yards", "meters"] as const;

// ─── Profile & Stats Tools ───────────────────────────────────────────────────

export const getAthleteProfile = tool(
  async (_input, config) => {
    const userId = getUserId(config);
    const profile = await storage.getProfile(userId);
    if (!profile) {
      return JSON.stringify({ message: "No profile found. Ask the athlete to complete their profile." });
    }
    return JSON.stringify({
      ...profile,
      weeklyTimeCommitmentLabel: weeklyTimeCommitmentDisplay(profile),
      upcomingRacesSummary:
        Array.isArray(profile.upcomingRaces) && profile.upcomingRaces.length
          ? profile.upcomingRaces.map((r) => r.label).join(" · ")
          : profile.targetRace ?? null,
    });
  },
  {
    name: "get_athlete_profile",
    description:
      "Get the athlete's profile including goals, fitness level, upcoming races (up to 3), peak weekly volume hints by sport, weekly time commitment, and legacy target race fields.",
    schema: z.object({}),
  }
);

export const updateAthleteProfile = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const profile = await storage.upsertProfile(userId, input);
    return JSON.stringify({ success: true, profile });
  },
  {
    name: "update_athlete_profile",
    description:
      "Update the athlete's profile — upcoming races, peak weekly volume by sport, weekly time bucket, fitness level, etc. Prefer upcomingRaces over legacy targetRace when setting events.",
    schema: z.object({
      fullName: z.string().optional(),
      targetRace: z.string().optional().describe("Legacy single-line goal; prefer upcomingRaces when possible"),
      targetRaceDate: z.string().optional().describe("YYYY-MM-DD format (legacy; first dated upcoming race is better)"),
      weeklyMileageGoal: z.string().optional().nullable().describe("Deprecated — use peakWeeklyVolume.running instead"),
      upcomingRaces: z
        .array(
          z.object({
            presetKey: z.string().nullable(),
            label: z.string(),
            date: z.string().nullable(),
          })
        )
        .max(3)
        .optional()
        .describe("Up to three goal events with optional dates"),
      peakWeeklyVolume: z
        .object({
          running: z.object({ amount: z.string(), unit: z.enum(["mi", "km"]) }).optional(),
          cycling: z.object({ amount: z.string(), unit: z.enum(["mi", "km"]) }).optional(),
          swimming: z.object({ amount: z.string(), unit: z.enum(["yards", "meters", "hours"]) }).optional(),
        })
        .optional()
        .nullable()
        .describe("Highest weekly volume the athlete has handled before, per sport"),
      weeklyHoursBucket: z.enum(WEEKLY_HOURS_BUCKETS).optional().describe(
        "Training time per week bucket: under_5, five_to_ten, ten_to_fifteen, fifteen_plus. Server sets weeklyHoursGoal from this."
      ),
      fitnessLevel: z.enum(["beginner", "intermediate", "advanced", "elite"]).optional(),
      age: z.number().optional(),
      bio: z.string().optional(),
    }),
  }
);

// ─── Run Data Tools ──────────────────────────────────────────────────────────

export const getRecentRuns = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const runs = await storage.getRunsByUserIdRecent(userId, input.days ?? 14);
    if (!runs.length) {
      return JSON.stringify({ message: `No runs in the last ${input.days ?? 14} days.` });
    }

    // Calculate summary stats (exclude cycling from pace avg — cycling stores 0 pace)
    const totalMiles = runs.reduce((s, r) => s + parseFloat(r.distance), 0);
    const totalMinutes = runs.reduce((s, r) => s + r.timeHours * 60 + r.timeMinutes, 0);
    const paceRuns = runs.filter((r) => r.sportType !== "cycling" && r.paceMinutes > 0);
    const avgPace = paceRuns.length
      ? paceRuns.reduce((s, r) => s + r.paceMinutes + r.paceSeconds / 60, 0) / paceRuns.length
      : 0;
    const avgPaceMin = Math.floor(avgPace);
    const avgPaceSec = Math.round((avgPace - avgPaceMin) * 60);

    const sportBreakdown: Record<string, { sessions: number; miles: number; minutes: number }> = {};
    runs.forEach((r) => {
      if (!sportBreakdown[r.sportType]) sportBreakdown[r.sportType] = { sessions: 0, miles: 0, minutes: 0 };
      sportBreakdown[r.sportType].sessions++;
      sportBreakdown[r.sportType].miles += parseFloat(r.distance);
      sportBreakdown[r.sportType].minutes += r.timeHours * 60 + r.timeMinutes;
    });

    return JSON.stringify({
      runs,
      summary: {
        totalActivities: runs.length,
        totalMiles: totalMiles.toFixed(1),
        totalMinutes,
        avgPace: paceRuns.length ? `${avgPaceMin}:${String(avgPaceSec).padStart(2, "0")}/mile` : null,
        sportBreakdown,
      },
    });
  },
  {
    name: "get_recent_runs",
    description: "Fetch the athlete's recent run logs with summary statistics. Always call this at the start of a conversation to have fresh context.",
    schema: z.object({
      days: z.number().optional().default(14).describe("Number of days to look back (default 14)"),
    }),
  }
);

export const searchRuns = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const runs = input.startDate && input.endDate
      ? await storage.getRunsByUserIdAndDateRange(userId, input.startDate, input.endDate)
      : await storage.getRunsByUserId(userId);

    let filtered = input.runType
      ? runs.filter((r) => r.runType === input.runType)
      : runs;

    if (input.sportType) {
      filtered = filtered.filter((r) => r.sportType === input.sportType);
    }

    return JSON.stringify({ runs: filtered.slice(0, 30), total: filtered.length });
  },
  {
    name: "search_runs",
    description: "Search the athlete's activity history by date range, workout type, and/or sport type.",
    schema: z.object({
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD"),
      runType: z.enum(ALL_WORKOUT_TYPES).optional(),
      sportType: z.enum(SPORT_TYPES).optional().describe("Filter by sport discipline"),
    }),
  }
);

export const updateRunNotes = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const updated = await storage.updateRun(input.runId, { notes: input.notes }, userId);
    if (!updated) return JSON.stringify({ error: "Run not found" });
    return JSON.stringify({ success: true, run: updated });
  },
  {
    name: "update_run_notes",
    description: "Update the journal/notes for a specific run. Use when the athlete tells you how a workout went and you want to save it.",
    schema: z.object({
      runId: z.string().describe("UUID of the run to update"),
      notes: z.string().describe("Journal entry or notes for the run"),
    }),
  }
);

export const logRun = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const run = await storage.createRun(
      {
        date: input.date,
        sportType: input.sportType,
        distanceUnit: input.distanceUnit,
        distance: String(input.distance),
        timeHours: input.timeHours ?? 0,
        timeMinutes: input.timeMinutes,
        paceMinutes: input.paceMinutes,
        paceSeconds: input.paceSeconds,
        runType: input.runType,
        notes: input.notes,
        perceivedEffort: input.perceivedEffort,
      },
      userId
    );
    return JSON.stringify({ success: true, run });
  },
  {
    name: "log_run",
    description: "Create a new activity log entry. Use when the athlete describes a workout they just completed.",
    schema: z.object({
      date: z.string().describe("YYYY-MM-DD"),
      sportType: z.enum(SPORT_TYPES).default("running").describe("Sport discipline"),
      distanceUnit: z.enum(DISTANCE_UNITS).default("mi").describe("Unit for the distance value"),
      distance: z.number().describe("Distance in the specified unit"),
      timeHours: z.number().optional().default(0),
      timeMinutes: z.number().describe("Minutes component of total time"),
      paceMinutes: z.number().describe("Pace minutes per unit"),
      paceSeconds: z.number().describe("Pace seconds per unit (0-59)"),
      runType: z.enum(ALL_WORKOUT_TYPES),
      notes: z.string().optional(),
      perceivedEffort: z.number().min(1).max(10).optional().describe("RPE 1-10"),
    }),
  }
);

// ─── Training Plan Tools ─────────────────────────────────────────────────────

export const getCurrentPlan = tool(
  async (_input, config) => {
    const userId = getUserId(config);
    const plan = await storage.getActivePlan(userId);
    if (!plan) return JSON.stringify({ message: "No active training plan. Would you like me to create one?" });

    const workouts = await storage.getPlanWorkouts(plan.id, userId);
    return JSON.stringify({ plan, workouts, totalWorkouts: workouts.length });
  },
  {
    name: "get_current_plan",
    description: "Get the athlete's active training plan with all scheduled workouts.",
    schema: z.object({}),
  }
);

export const createTrainingPlan = tool(
  async (input, config) => {
    const userId = getUserId(config);

    // Deactivate any existing active plan
    await storage.deactivateAllPlans(userId);

    // Create the plan
    const plan = await storage.createTrainingPlan(
      {
        title: input.title,
        description: input.description,
        goal: input.goal,
        startDate: input.startDate,
        endDate: input.endDate,
        raceDate: input.raceDate,
        raceName: input.raceName,
        raceDistance: input.raceDistance,
        isActive: true,
        createdByAgent: true,
        planData: input.weeks as unknown as Record<string, unknown>,
      },
      userId
    );

    // Create individual workout entries for the calendar
    const workoutsCreated: unknown[] = [];
    for (const week of input.weeks) {
      for (const day of week.days) {
        if (day.workoutType !== "rest") {
          const workout = await storage.upsertPlanWorkout(
            {
              planId: plan.id,
              date: day.date,
              workoutType: day.workoutType,
              title: day.title,
              description: day.description,
              targetDistance: day.targetDistance ? String(day.targetDistance) : null,
              targetPaceMin: day.targetPaceMin,
              targetPaceSec: day.targetPaceSec,
              targetDurationMinutes: day.targetDurationMinutes,
              notes: day.notes,
              isCompleted: false,
            } as InsertPlanWorkout,
            userId
          );
          workoutsCreated.push(workout);
        }
      }
    }

    return JSON.stringify({
      success: true,
      plan,
      workoutsCreated: workoutsCreated.length,
      message: `Training plan "${input.title}" created with ${workoutsCreated.length} scheduled workouts. It's now live in the athlete's calendar.`,
    });
  },
  {
    name: "create_training_plan",
    description: "Create a comprehensive training plan with weekly structure. This will immediately populate the athlete's calendar with scheduled workouts. IMPORTANT: use the athlete's weeklySchedule from get_performance_summary to place workouts only on available days and respect each day's maxMinutes. Honor isLongDay as the long run/ride/swim slot.",
    schema: z.object({
      title: z.string().describe("Plan name e.g. '12-Week 5K Build'"),
      description: z.string().optional(),
      goal: z.string().describe("Primary goal e.g. 'Break 20 minutes in a 5K'"),
      startDate: z.string().describe("YYYY-MM-DD — first day of plan"),
      endDate: z.string().describe("YYYY-MM-DD — last day of plan"),
      raceDate: z.string().optional().describe("YYYY-MM-DD if training toward a specific race"),
      raceName: z.string().optional(),
      raceDistance: z.string().optional().describe("e.g. '5K', 'Half Marathon', 'Marathon'"),
      weeks: z.array(
        z.object({
          weekNumber: z.number(),
          theme: z.string().describe("e.g. 'Base Building', 'Tempo Focus'"),
          days: z.array(
            z.object({
              date: z.string().describe("YYYY-MM-DD"),
              workoutType: z.enum(ALL_WORKOUT_TYPES_WITH_REST),
              title: z.string().describe("e.g. 'Easy 5 miles', 'Tempo 4x1 mile'"),
              description: z.string().optional().describe("Detailed instructions"),
              targetDistance: z.number().optional().describe("Distance in primary unit"),
              targetPaceMin: z.number().optional(),
              targetPaceSec: z.number().optional(),
              targetDurationMinutes: z.number().optional(),
              notes: z.string().optional(),
            })
          ),
        })
      ),
    }),
  }
);

export const updatePlanWorkout = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const updated = await storage.updatePlanWorkout(input.workoutId, {
      title: input.title,
      description: input.description,
      workoutType: input.workoutType,
      targetDistance: input.targetDistance ? String(input.targetDistance) : undefined,
      targetPaceMin: input.targetPaceMin,
      targetPaceSec: input.targetPaceSec,
      notes: input.notes,
    }, userId);
    if (!updated) return JSON.stringify({ error: "Workout not found" });
    return JSON.stringify({ success: true, workout: updated });
  },
  {
    name: "update_plan_workout",
    description: "Modify a specific workout in the training plan. Updates immediately reflect in the calendar.",
    schema: z.object({
      workoutId: z.string().describe("UUID of the plan workout to update"),
      title: z.string().optional(),
      description: z.string().optional(),
      workoutType: z.enum(ALL_WORKOUT_TYPES_WITH_REST).optional(),
      targetDistance: z.number().optional(),
      targetPaceMin: z.number().optional(),
      targetPaceSec: z.number().optional(),
      notes: z.string().optional(),
    }),
  }
);

export const markWorkoutComplete = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const updated = await storage.updatePlanWorkout(
      input.workoutId,
      { isCompleted: true, completedRunId: input.runId },
      userId
    );
    return JSON.stringify({ success: !!updated, workout: updated });
  },
  {
    name: "mark_workout_complete",
    description: "Mark a planned workout as completed, optionally linking it to a logged run.",
    schema: z.object({
      workoutId: z.string(),
      runId: z.string().optional().describe("UUID of the logged run that completed this workout"),
    }),
  }
);

export const addWorkoutToPlan = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const plan = await storage.getActivePlan(userId);
    if (!plan) return JSON.stringify({ error: "No active training plan found." });

    const workout = await storage.upsertPlanWorkout(
      {
        planId: plan.id,
        date: input.date,
        workoutType: input.workoutType,
        title: input.title,
        description: input.description,
        targetDistance: input.targetDistance ? String(input.targetDistance) : null,
        targetPaceMin: input.targetPaceMin,
        targetPaceSec: input.targetPaceSec,
        notes: input.notes,
        isCompleted: false,
      } as InsertPlanWorkout,
      userId
    );

    return JSON.stringify({ success: true, workout, message: `Added "${input.title}" to your calendar for ${input.date}` });
  },
  {
    name: "add_workout_to_plan",
    description: "Add a single workout to the athlete's active training plan calendar.",
    schema: z.object({
      date: z.string().describe("YYYY-MM-DD"),
      workoutType: z.enum(ALL_WORKOUT_TYPES),
      title: z.string(),
      description: z.string().optional(),
      targetDistance: z.number().optional(),
      targetPaceMin: z.number().optional(),
      targetPaceSec: z.number().optional(),
      notes: z.string().optional(),
    }),
  }
);

// ─── Analytics Tools ─────────────────────────────────────────────────────────

export const calculateFitnessMetrics = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const allRuns = await storage.getRunsByUserIdRecent(userId, 42); // 6 weeks

    if (!allRuns.length) return JSON.stringify({ message: "Not enough data to calculate metrics." });

    const runs = input.sportType
      ? allRuns.filter((r) => r.sportType === input.sportType)
      : allRuns;

    if (!runs.length) {
      return JSON.stringify({ message: `No ${input.sportType} activities in the last 6 weeks.` });
    }

    // Weekly mileage breakdown
    const weeklyMileage: Record<string, number> = {};
    runs.forEach((r) => {
      const d = new Date(r.date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split("T")[0];
      weeklyMileage[key] = (weeklyMileage[key] || 0) + parseFloat(r.distance);
    });

    const weeklyValues = Object.values(weeklyMileage);
    const avgWeeklyMileage = weeklyValues.reduce((a, b) => a + b, 0) / weeklyValues.length;

    // Pace trend (last 2 weeks vs previous 2 weeks)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const recentRuns = runs.filter((r) => new Date(r.date) >= twoWeeksAgo);
    const olderRuns = runs.filter((r) => new Date(r.date) < twoWeeksAgo);

    const avgPaceRecent = recentRuns.length
      ? recentRuns.reduce((s, r) => s + r.paceMinutes + r.paceSeconds / 60, 0) / recentRuns.length
      : null;
    const avgPaceOlder = olderRuns.length
      ? olderRuns.reduce((s, r) => s + r.paceMinutes + r.paceSeconds / 60, 0) / olderRuns.length
      : null;

    // Run type distribution
    const typeCount: Record<string, number> = {};
    runs.forEach((r) => { typeCount[r.runType] = (typeCount[r.runType] || 0) + 1; });

    const easyPct = ((typeCount.easy || 0) + (typeCount.recovery || 0) +
      (typeCount.easy_ride || 0) + (typeCount.recovery_ride || 0) +
      (typeCount.easy_swim || 0)) / runs.length * 100;

    // Sport-specific metrics
    const sportNotes: string[] = [];

    if (!input.sportType || input.sportType === "swimming") {
      const swimRuns = runs.filter((r) => r.sportType === "swimming");
      if (swimRuns.length) {
        const totalYards = swimRuns
          .filter((r) => r.distanceUnit === "yards" || r.distanceUnit === "meters")
          .reduce((s, r) => s + parseFloat(r.distance), 0);
        if (totalYards > 0) {
          sportNotes.push(`Swimming: ${totalYards.toFixed(0)} total yards/meters across ${swimRuns.length} sessions`);
        }
      }
    }

    if (!input.sportType || input.sportType === "cycling") {
      const cycleRuns = runs.filter((r) => r.sportType === "cycling");
      if (cycleRuns.length) {
        const totalHours = cycleRuns.reduce((s, r) => s + r.timeHours + r.timeMinutes / 60, 0);
        sportNotes.push(`Cycling: ${totalHours.toFixed(1)} hours in the saddle across ${cycleRuns.length} rides`);
      }
    }

    // ACWR (acute:chronic workload ratio) — duration × RPE weight
    const now = new Date();
    const daysBefore = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const last7 = runs.filter((r) => new Date(r.date) >= daysBefore(7));
    const last28 = runs.filter((r) => new Date(r.date) >= daysBefore(28));

    const loadUnits = (rs: typeof runs) =>
      rs.reduce((sum, r) => {
        const mins = r.timeHours * 60 + r.timeMinutes;
        return sum + mins * (r.perceivedEffort ? r.perceivedEffort / 5 : 1.0);
      }, 0);

    const acute = loadUnits(last7);
    const chronicWeekly = loadUnits(last28) / 4;
    const acwr = chronicWeekly > 0 ? parseFloat((acute / chronicWeekly).toFixed(2)) : null;
    const acwrStatus = acwr == null ? null
      : acwr < 0.8 ? "underloaded — room to add volume"
      : acwr <= 1.3 ? "optimal training zone"
      : acwr <= 1.5 ? "caution — monitor fatigue"
      : "high risk — reduce load";

    return JSON.stringify({
      period: "Last 6 weeks",
      sportFilter: input.sportType ?? "all",
      totalRuns: runs.length,
      avgWeeklyMileage: avgWeeklyMileage.toFixed(1),
      weeklyMileage,
      acwr,
      acwrStatus,
      paceTrend: avgPaceRecent && avgPaceOlder ? {
        recent2Weeks: `${Math.floor(avgPaceRecent)}:${String(Math.round((avgPaceRecent % 1) * 60)).padStart(2, "0")}`,
        previous2Weeks: `${Math.floor(avgPaceOlder)}:${String(Math.round((avgPaceOlder % 1) * 60)).padStart(2, "0")}`,
        improving: avgPaceRecent < avgPaceOlder,
      } : null,
      runTypeDistribution: typeCount,
      easyRunPercentage: `${easyPct.toFixed(0)}%`,
      sportSpecific: sportNotes.length ? sportNotes : undefined,
      recommendation: easyPct < 70
        ? "Easy run percentage is below 80%. Slow down on easy days to maximize aerobic adaptation."
        : "Training intensity distribution looks healthy.",
    });
  },
  {
    name: "calculate_fitness_metrics",
    description: "Calculate training metrics including weekly mileage trends, pace trends, and intensity distribution over the last 6 weeks. Optionally filter by sport.",
    schema: z.object({
      sportType: z.enum(SPORT_TYPES).optional().describe("Filter metrics to a single sport discipline"),
    }),
  }
);

// ─── Health Logging Tools ────────────────────────────────────────────────────

export const getHealthLogs = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const logs = await storage.getHealthLogs(userId, input.days ?? 30);
    if (!logs.length) {
      return JSON.stringify({ message: `No health logs in the last ${input.days ?? 30} days.` });
    }
    return JSON.stringify({ logs, total: logs.length });
  },
  {
    name: "get_health_logs",
    description: "Fetch the athlete's recent health logs (injuries, illness, fatigue, life stress). Use to understand context before adjusting training.",
    schema: z.object({
      days: z.number().optional().default(30).describe("Number of days to look back (default 30)"),
    }),
  }
);

export const logHealthStatus = tool(
  async (input, config) => {
    const userId = getUserId(config);
    const log = await storage.createHealthLog(
      {
        type: input.type,
        description: input.description,
        severity: input.severity,
        bodyPart: input.bodyPart,
        date: input.date,
      },
      userId
    );
    return JSON.stringify({ success: true, log });
  },
  {
    name: "log_health_status",
    description: "Log an injury, illness, fatigue, or life-stress entry. Use when the athlete reports a health issue so the coach can adapt training accordingly.",
    schema: z.object({
      type: z.enum(["injury", "illness", "fatigue", "life_stress"]),
      description: z.string().describe("Details about the health issue"),
      severity: z.number().min(1).max(5).describe("1 = minor, 5 = severe"),
      bodyPart: z.string().optional().describe("Relevant for injuries, e.g. 'left knee', 'right achilles'"),
      date: z.string().describe("YYYY-MM-DD"),
    }),
  }
);

// ─── Performance Summary (primary briefing tool) ─────────────────────────────

export const getPerformanceSummary = tool(
  async (_input, config) => {
    const userId = getUserId(config);

    // Parallel fetch everything needed for a complete coach briefing
    const [profile, allRuns, plan, healthLogs, stravaInteg] = await Promise.all([
      storage.getProfile(userId),
      storage.getRunsByUserIdRecent(userId, 42),
      storage.getActivePlan(userId),
      storage.getHealthLogs(userId, 30),
      storage.getIntegration(userId, "strava"),
    ]);

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const daysBefore = (d: number) => new Date(now.getTime() - d * 86_400_000);

    const last7d = allRuns.filter((r) => new Date(r.date) >= daysBefore(7));
    const last28d = allRuns.filter((r) => new Date(r.date) >= daysBefore(28));

    // Load unit = duration × RPE weight (RPE 5 = neutral 1.0×; no RPE defaults to 1.0)
    const loadUnits = (rs: typeof allRuns) =>
      rs.reduce((sum, r) => {
        const mins = r.timeHours * 60 + r.timeMinutes;
        return sum + mins * (r.perceivedEffort ? r.perceivedEffort / 5 : 1.0);
      }, 0);

    // Per-sport ACWR
    const SPORTS = ["running", "cycling", "swimming", "triathlon"] as const;
    const trainingLoad: Record<string, unknown> = {};

    for (const sport of SPORTS) {
      const s7 = last7d.filter((r) => r.sportType === sport);
      const s28 = last28d.filter((r) => r.sportType === sport);
      if (s28.length === 0 && s7.length === 0) continue;

      const acute = loadUnits(s7);
      const chronicWeekly = loadUnits(s28) / 4;
      const acwr = chronicWeekly > 0 ? parseFloat((acute / chronicWeekly).toFixed(2)) : null;

      const easyTypes = new Set(["easy", "recovery", "easy_ride", "recovery_ride", "easy_swim"]);
      const easy7d = s7.filter((r) => easyTypes.has(r.runType)).length;
      const totalDist7d = s7.reduce((s, r) => s + parseFloat(r.distance), 0);
      const totalMins7d = s7.reduce((s, r) => s + r.timeHours * 60 + r.timeMinutes, 0);
      const hrSamples = s7.filter((r) => r.heartRateAvg);
      const avgHR7d = hrSamples.length
        ? Math.round(hrSamples.reduce((s, r) => s + (r.heartRateAvg ?? 0), 0) / hrSamples.length)
        : null;

      trainingLoad[sport] = {
        sessions7d: s7.length,
        minutes7d: totalMins7d,
        distance7d: parseFloat(totalDist7d.toFixed(1)),
        distUnit: sport === "swimming" ? "meters" : "mi",
        acwr,
        acwrStatus:
          acwr == null ? null
          : acwr < 0.8 ? "underloaded"
          : acwr <= 1.3 ? "optimal"
          : acwr <= 1.5 ? "caution"
          : "high_risk",
        easyPct7d: s7.length > 0 ? `${Math.round((easy7d / s7.length) * 100)}%` : null,
        avgHR7d,
      };
    }

    // Training plan: upcoming 7 days + last-7-day compliance
    let planSummary: unknown = null;
    if (plan) {
      const workouts = await storage.getPlanWorkouts(plan.id, userId);
      const next7End = new Date(now.getTime() + 7 * 86_400_000).toISOString().split("T")[0];

      const upcoming = workouts
        .filter((w) => w.date >= todayStr && w.date <= next7End && !w.isCompleted)
        .slice(0, 7)
        .map((w) => ({
          date: w.date,
          title: w.title,
          type: w.workoutType,
          targetDist: w.targetDistance ? `${w.targetDistance} mi` : null,
          targetPace:
            w.targetPaceMin != null
              ? `${w.targetPaceMin}:${String(w.targetPaceSec ?? 0).padStart(2, "0")}/mi`
              : null,
        }));

      const past7Planned = workouts.filter((w) => {
        const d = new Date(w.date);
        return d >= daysBefore(7) && d < now;
      });
      const completed7 = past7Planned.filter((w) => w.isCompleted).length;
      const missed = past7Planned.filter((w) => !w.isCompleted && w.date < todayStr).map((w) => w.title);

      planSummary = {
        title: plan.title,
        goal: plan.goal,
        raceDate: plan.raceDate,
        daysUntilRace:
          plan.raceDate
            ? Math.ceil((new Date(plan.raceDate).getTime() - now.getTime()) / 86_400_000)
            : null,
        upcoming,
        complianceLast7d: `${completed7}/${past7Planned.length}`,
        missedWorkouts: missed,
      };
    }

    // Recent 14-day activities (condensed for token efficiency)
    const recent14d = allRuns
      .filter((r) => new Date(r.date) >= daysBefore(14))
      .map((r) => ({
        date: r.date,
        sport: r.sportType,
        type: r.runType,
        dist: `${r.distance} ${r.distanceUnit}`,
        time: `${r.timeHours > 0 ? r.timeHours + "h " : ""}${r.timeMinutes}m`,
        pace:
          r.paceMinutes && r.sportType !== "cycling"
            ? `${r.paceMinutes}:${String(r.paceSeconds).padStart(2, "0")}`
            : null,
        rpe: r.perceivedEffort,
        hr: r.heartRateAvg,
        title: r.title ?? undefined,
      }));

    return JSON.stringify({
      generatedAt: todayStr,
      athlete: profile
        ? {
            fitnessLevel: profile.fitnessLevel,
            weeklyTimeCommitment: weeklyTimeCommitmentDisplay(profile),
            upcomingRaces: profile.upcomingRaces ?? null,
            peakWeeklyVolume: profile.peakWeeklyVolume ?? null,
            weeklySchedule: profile.weeklySchedule ?? [],
          }
        : null,
      trainingLoad,
      recentActivities: recent14d,
      plan: planSummary,
      activeHealthIssues: healthLogs
        .filter((h) => !h.resolvedDate)
        .map((h) => ({
          type: h.type,
          description: h.description,
          severity: h.severity,
          date: h.date,
          bodyPart: h.bodyPart,
        })),
      stravaConnected: !!stravaInteg?.isActive,
      stravaLastSync: stravaInteg?.lastSyncedAt ?? null,
      lastActivity: allRuns[0]
        ? {
            date: allRuns[0].date,
            sport: allRuns[0].sportType,
            type: allRuns[0].runType,
            daysAgo: Math.floor(
              (now.getTime() - new Date(allRuns[0].date).getTime()) / 86_400_000
            ),
          }
        : null,
    });
  },
  {
    name: "get_performance_summary",
    description:
      "PRIMARY COACH BRIEFING — call this first for ANY workout recommendation, week planning, training load question, or performance review. Returns in ONE call: athlete profile + upcoming races, per-sport ACWR training load (7-day acute vs 28-day chronic average), condensed 14-day activity log with HR, next 7 planned workouts, plan compliance, active health issues, and Strava sync status. Designed to replace 4–5 separate tool calls. ACWR guide: <0.8 underloaded, 0.8–1.3 optimal, 1.3–1.5 caution, >1.5 high injury risk.",
    schema: z.object({}),
  }
);

// ─── Strava On-Demand Sync ────────────────────────────────────────────────────

export const syncStravaData = tool(
  async (_input, config) => {
    const userId = getUserId(config);
    try {
      const result = await syncStravaActivities(userId);
      return JSON.stringify({
        success: true,
        synced: result.synced,
        skipped: result.skipped,
        message:
          result.synced > 0
            ? `Pulled ${result.synced} new activities from Strava (includes Garmin activities that auto-sync to Strava).`
            : "Already up to date — no new activities found since last sync.",
      });
    } catch (err) {
      return JSON.stringify({ success: false, error: (err as Error).message });
    }
  },
  {
    name: "sync_strava_data",
    description:
      "Trigger a fresh Strava activity sync to pull the latest workouts into the database. Call this when: (1) athlete says they just finished a workout that isn't showing, (2) stravaLastSync in get_performance_summary is >4 hours old, or (3) athlete asks about a recent workout you can't find. Note: Garmin Connect activities auto-sync to Strava, so this also pulls Garmin data. Do NOT call on every message — only when data freshness is needed.",
    schema: z.object({}),
  }
);

// ─── All Tools Export ────────────────────────────────────────────────────────

export const coachTools = [
  getPerformanceSummary,   // primary — call this first for any training question
  syncStravaData,          // on-demand Strava sync (covers Garmin via auto-sync)
  getAthleteProfile,
  updateAthleteProfile,
  getRecentRuns,
  searchRuns,
  updateRunNotes,
  logRun,
  getCurrentPlan,
  createTrainingPlan,
  updatePlanWorkout,
  markWorkoutComplete,
  addWorkoutToPlan,
  calculateFitnessMetrics,
  getHealthLogs,
  logHealthStatus,
];
