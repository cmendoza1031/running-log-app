import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { storage } from "../storage";
import type { InsertPlanWorkout } from "@shared/schema";

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
    return JSON.stringify(profile);
  },
  {
    name: "get_athlete_profile",
    description: "Get the athlete's profile including their goals, fitness level, target race, and weekly mileage targets.",
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
    description: "Update the athlete's profile — goals, target race, weekly mileage goal, fitness level, etc.",
    schema: z.object({
      fullName: z.string().optional(),
      targetRace: z.string().optional().describe("e.g. 'Boston Marathon', '5K local race'"),
      targetRaceDate: z.string().optional().describe("YYYY-MM-DD format"),
      weeklyMileageGoal: z.string().optional().describe("target weekly miles as a decimal string"),
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

    // Calculate summary stats
    const totalMiles = runs.reduce((s, r) => s + parseFloat(r.distance), 0);
    const totalMinutes = runs.reduce((s, r) => s + r.timeHours * 60 + r.timeMinutes, 0);
    const avgPace = runs.reduce((s, r) => s + r.paceMinutes + r.paceSeconds / 60, 0) / runs.length;
    const avgPaceMin = Math.floor(avgPace);
    const avgPaceSec = Math.round((avgPace - avgPaceMin) * 60);

    return JSON.stringify({
      runs,
      summary: {
        totalRuns: runs.length,
        totalMiles: totalMiles.toFixed(1),
        totalMinutes,
        avgPace: `${avgPaceMin}:${String(avgPaceSec).padStart(2, "0")}/mile`,
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
    description: "Create a comprehensive training plan with weekly structure. This will immediately populate the athlete's calendar with scheduled workouts.",
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

    return JSON.stringify({
      period: "Last 6 weeks",
      sportFilter: input.sportType ?? "all",
      totalRuns: runs.length,
      avgWeeklyMileage: avgWeeklyMileage.toFixed(1),
      weeklyMileage,
      paceTrend: avgPaceRecent && avgPaceOlder ? {
        recent2Weeks: `${Math.floor(avgPaceRecent)}:${String(Math.round((avgPaceRecent % 1) * 60)).padStart(2, "0")}`,
        previous2Weeks: `${Math.floor(avgPaceOlder)}:${String(Math.round((avgPaceOlder % 1) * 60)).padStart(2, "0")}`,
        improving: avgPaceRecent < avgPaceOlder,
      } : null,
      runTypeDistribution: typeCount,
      easyRunPercentage: `${easyPct.toFixed(0)}%`,
      sportSpecific: sportNotes.length ? sportNotes : undefined,
      recommendation: easyPct < 70
        ? "Your easy run percentage is below the recommended 80%. Consider slowing down on easy days to maximize aerobic adaptation."
        : "Your training intensity distribution looks healthy.",
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

// ─── All Tools Export ────────────────────────────────────────────────────────

export const coachTools = [
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
