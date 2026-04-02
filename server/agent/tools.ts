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

    const filtered = input.runType
      ? runs.filter((r) => r.runType === input.runType)
      : runs;

    return JSON.stringify({ runs: filtered.slice(0, 30), total: filtered.length });
  },
  {
    name: "search_runs",
    description: "Search the athlete's run history by date range and/or run type.",
    schema: z.object({
      startDate: z.string().optional().describe("YYYY-MM-DD"),
      endDate: z.string().optional().describe("YYYY-MM-DD"),
      runType: z.enum(["easy", "tempo", "long", "interval", "trail", "threshold", "race", "recovery", "other"]).optional(),
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
        sportType: "running",
        distanceUnit: "mi",
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
    description: "Create a new run log entry. Use when the athlete describes a workout they just completed.",
    schema: z.object({
      date: z.string().describe("YYYY-MM-DD"),
      distance: z.number().describe("Miles"),
      timeHours: z.number().optional().default(0),
      timeMinutes: z.number().describe("Minutes component of total time"),
      paceMinutes: z.number().describe("Pace minutes per mile"),
      paceSeconds: z.number().describe("Pace seconds per mile (0-59)"),
      runType: z.enum(["easy", "tempo", "long", "interval", "trail", "threshold", "race", "recovery", "other"]),
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
              workoutType: z.enum(["easy", "tempo", "long", "interval", "trail", "threshold", "race", "recovery", "rest", "other"]),
              title: z.string().describe("e.g. 'Easy 5 miles', 'Tempo 4x1 mile'"),
              description: z.string().optional().describe("Detailed instructions"),
              targetDistance: z.number().optional().describe("Miles"),
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
      workoutType: z.enum(["easy", "tempo", "long", "interval", "trail", "threshold", "race", "recovery", "rest", "other"]).optional(),
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
      workoutType: z.enum(["easy", "tempo", "long", "interval", "trail", "threshold", "race", "recovery", "other"]),
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
  async (_input, config) => {
    const userId = getUserId(config);
    const runs = await storage.getRunsByUserIdRecent(userId, 42); // 6 weeks

    if (!runs.length) return JSON.stringify({ message: "Not enough data to calculate metrics." });

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

    const easyPct = ((typeCount.easy || 0) + (typeCount.recovery || 0)) / runs.length * 100;

    return JSON.stringify({
      period: "Last 6 weeks",
      totalRuns: runs.length,
      avgWeeklyMileage: avgWeeklyMileage.toFixed(1),
      weeklyMileage,
      pacetrend: avgPaceRecent && avgPaceOlder ? {
        recent2Weeks: `${Math.floor(avgPaceRecent)}:${String(Math.round((avgPaceRecent % 1) * 60)).padStart(2, "0")}`,
        previous2Weeks: `${Math.floor(avgPaceOlder)}:${String(Math.round((avgPaceOlder % 1) * 60)).padStart(2, "0")}`,
        improving: avgPaceRecent < avgPaceOlder,
      } : null,
      runTypeDistribution: typeCount,
      easyRunPercentage: `${easyPct.toFixed(0)}%`,
      recommendation: easyPct < 70
        ? "Your easy run percentage is below the recommended 80%. Consider slowing down on easy days to maximize aerobic adaptation."
        : "Your training intensity distribution looks healthy.",
    });
  },
  {
    name: "calculate_fitness_metrics",
    description: "Calculate training metrics including weekly mileage trends, pace trends, and intensity distribution over the last 6 weeks.",
    schema: z.object({}),
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
];
