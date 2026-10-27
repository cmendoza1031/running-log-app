import { sql } from "drizzle-orm";
import {
  pgTable,
  doublePrecision,
  text,
  varchar,
  decimal,
  integer,
  timestamp,
  date,
  boolean,
  uuid,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { WEEKLY_HOURS_BUCKETS } from "./weekly-hours-bucket";
import { upcomingRacesArraySchema, peakWeeklyVolumeSchema, type UpcomingRaceEntry, type PeakWeeklyVolume } from "./profile-goals";

// ─── Sport constants ────────────────────────────────────────────────────────
export const SPORT_TYPES = ["running", "cycling", "swimming", "triathlon"] as const;
export type SportType = typeof SPORT_TYPES[number];

export const FITNESS_LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;
export type FitnessLevel = typeof FITNESS_LEVELS[number];

// ─── Weekly schedule ─────────────────────────────────────────────────────────
// day: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export interface TrainingDay {
  day: number;
  maxMinutes: number; // 30, 60, 90, 120, 180
  isLongDay: boolean;
}

const trainingDaySchema = z.object({
  day: z.number().min(0).max(6),
  maxMinutes: z.number(),
  isLongDay: z.boolean(),
});
export const weeklyScheduleSchema = z.array(trainingDaySchema);

// ─── Profiles (extends Supabase auth.users) ────────────────────────────────
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  username: text("username").unique(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  sports: jsonb("sports").$type<SportType[]>().default(["running"]), // primary sports
  primarySport: text("primary_sport").default("running"),
  targetRace: text("target_race"),
  targetRaceDate: date("target_race_date"),
  targetRaceDistance: text("target_race_distance"), // e.g. "marathon", "Ironman", "5K"
  /** Athlete-selected range from onboarding (source of truth for "how much time"). */
  weeklyHoursBucket: text("weekly_hours_bucket"),
  /** Planning default: midpoint hours/week derived from `weeklyHoursBucket` (see shared/weekly-hours-bucket.ts). */
  weeklyHoursGoal: decimal("weekly_hours_goal", { precision: 4, scale: 1 }),
  weeklyMileageGoal: decimal("weekly_mileage_goal", { precision: 5, scale: 2 }),
  upcomingRaces: jsonb("upcoming_races").$type<UpcomingRaceEntry[]>().notNull().default([]),
  peakWeeklyVolume: jsonb("peak_weekly_volume").$type<PeakWeeklyVolume | null>(),
  weeklySchedule: jsonb("weekly_schedule").$type<TrainingDay[]>().default([]),
  fitnessLevel: text("fitness_level").default("intermediate"), // beginner|intermediate|advanced|elite
  yearsTraining: integer("years_training"),
  age: integer("age"),
  bio: text("bio"),
  onboardingComplete: boolean("onboarding_complete").default(false),
  /** Display units: imperial (mi, /mi) or metric (km, /km). */
  unitSystem: text("unit_system").default("imperial"),
  /** Pool length unit for swim display. */
  poolUnit: text("pool_unit").default("yards"),
  /** IANA timezone, reported by the device — drives "today" for server-side work. */
  timezone: text("timezone"),
  sex: text("sex"),
  /** Primary goal race used by the planner (see shared/physiology.ts RaceType). */
  goalRaceType: text("goal_race_type"),
  /** Athlete-reported limiter sport, e.g. "swim" — the planner gives it more time. */
  limiter: text("limiter"),
  /** Fueling profile (optional; see shared/fueling.ts for defaults). */
  sweatRateMlPerH: integer("sweat_rate_ml_per_h"),
  sweatSodiumMgPerL: integer("sweat_sodium_mg_per_l"),
  carbToleranceGPerH: integer("carb_tolerance_g_per_h"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Activity type constants ─────────────────────────────────────────────────
// sport → valid workout types
export const ACTIVITY_SPORT_TYPES = {
  running: ["easy", "tempo", "long", "interval", "threshold", "fartlek", "trail", "race", "recovery", "strides", "other"],
  cycling: ["easy_ride", "tempo_ride", "long_ride", "interval_ride", "hill_ride", "sweet_spot", "race_ride", "recovery_ride", "other"],
  swimming: ["easy_swim", "threshold_swim", "interval_swim", "open_water_swim", "drill", "race_swim", "css_test", "other"],
  triathlon: ["brick", "transition", "race", "other"],
} as const;

export const ALL_WORKOUT_TYPES = [
  // Running
  "easy", "tempo", "long", "interval", "threshold", "fartlek", "trail", "race", "recovery", "strides",
  // Cycling
  "easy_ride", "tempo_ride", "long_ride", "interval_ride", "hill_ride", "sweet_spot", "race_ride", "recovery_ride",
  // Swimming
  "easy_swim", "threshold_swim", "interval_swim", "open_water_swim", "drill", "race_swim", "css_test",
  // Triathlon/Multi
  "brick", "transition",
  // Universal
  "other",
] as const;

export type WorkoutType = typeof ALL_WORKOUT_TYPES[number];

// ─── Runs / Activities ───────────────────────────────────────────────────────
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  date: date("date").notNull(),
  sportType: text("sport_type").notNull().default("running"), // running|cycling|swimming|triathlon
  distance: decimal("distance", { precision: 6, scale: 2 }).notNull(),
  distanceUnit: text("distance_unit").default("mi"), // mi | km | yards | meters
  timeHours: integer("time_hours").notNull().default(0),
  timeMinutes: integer("time_minutes").notNull(),
  paceMinutes: integer("pace_minutes").notNull(),
  paceSeconds: integer("pace_seconds").notNull(),
  runType: text("run_type").notNull(), // workout type within the sport
  title: text("title"),
  notes: text("notes"),
  perceivedEffort: integer("perceived_effort"), // 1-10 RPE
  heartRateAvg: integer("heart_rate_avg"),
  heartRateMax: integer("heart_rate_max"),
  elevationGain: integer("elevation_gain"), // feet
  externalId: text("external_id"), // Strava/Garmin activity ID
  externalSource: text("external_source"), // strava|garmin|apple_health|coros
  averagePower: integer("average_power"), // watts, cycling only
  weather: jsonb("weather"),
  // ── Canonical metrics (metric units) ──
  startTime: timestamp("start_time", { withTimezone: true }),
  movingTimeSec: integer("moving_time_sec"),
  elapsedTimeSec: integer("elapsed_time_sec"),
  distanceMeters: doublePrecision("distance_meters"),
  elevationGainM: doublePrecision("elevation_gain_m"),
  avgSpeed: doublePrecision("avg_speed"), // m/s
  maxSpeed: doublePrecision("max_speed"),
  avgCadence: doublePrecision("avg_cadence"),
  normalizedPower: integer("normalized_power"),
  maxPower: integer("max_power"),
  kilojoules: doublePrecision("kilojoules"),
  hasPowerMeter: boolean("has_power_meter"),
  trainer: boolean("trainer"),
  deviceName: text("device_name"),
  providerSportType: text("provider_sport_type"),
  calories: integer("calories"),
  // ── Load ──
  tss: doublePrecision("tss"),
  intensityFactor: doublePrecision("intensity_factor"),
  loadSource: text("load_source"),
  // ── Stream-derived detail ──
  hrZoneSec: jsonb("hr_zone_sec").$type<number[] | null>(),
  powerZoneSec: jsonb("power_zone_sec").$type<number[] | null>(),
  paceZoneSec: jsonb("pace_zone_sec").$type<number[] | null>(),
  bestEfforts: jsonb("best_efforts").$type<Record<string, number> | null>(),
  decoupling: doublePrecision("decoupling"),
  efficiencyFactor: doublePrecision("efficiency_factor"),
  laps: jsonb("laps").$type<ActivityLap[] | null>(),
  detailFetched: boolean("detail_fetched").default(false),
  streamsFetched: boolean("streams_fetched").default(false),
  // ── Coaching ──
  planWorkoutId: uuid("plan_workout_id"),
  feel: integer("feel"), // 1 (awful) – 5 (great)
  analysis: jsonb("analysis").$type<WorkoutAnalysis | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Training Plans ─────────────────────────────────────────────────────────
export const trainingPlans = pgTable("training_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  goal: text("goal"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  raceDate: date("race_date"),
  raceName: text("race_name"),
  raceDistance: text("race_distance"),
  isActive: boolean("is_active").default(true),
  createdByAgent: boolean("created_by_agent").default(false),
  planData: jsonb("plan_data"), // full plan as JSON for reference
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Plan Workouts (individual days) ────────────────────────────────────────
export const planWorkouts = pgTable("plan_workouts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: uuid("plan_id").notNull(),
  userId: uuid("user_id").notNull(),
  date: date("date").notNull(),
  workoutType: text("workout_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  targetDistance: decimal("target_distance", { precision: 9, scale: 2 }),
  targetPaceMin: integer("target_pace_min"),
  targetPaceSec: integer("target_pace_sec"),
  targetDurationMinutes: integer("target_duration_minutes"),
  notes: text("notes"),
  isCompleted: boolean("is_completed").default(false),
  completedRunId: uuid("completed_run_id"),
  sport: text("sport"), // swim | bike | run | strength
  structure: jsonb("structure"), // WorkoutStructure (shared/workout-structure.ts)
  plannedTss: doublePrecision("planned_tss"),
  plannedDurationSec: integer("planned_duration_sec"),
  plannedDistanceM: doublePrecision("planned_distance_m"),
  phase: text("phase"),
  weekNumber: integer("week_number"),
  isKey: boolean("is_key").default(false),
  status: text("status").default("planned"), // planned | completed | skipped
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Chat Messages ──────────────────────────────────────────────────────────
export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  threadId: text("thread_id").notNull().default("default"),
  role: text("role").notNull(), // user|assistant|tool
  content: text("content").notNull(),
  toolCalls: jsonb("tool_calls"),
  toolResults: jsonb("tool_results"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Health Logs (injury, illness, fatigue) ─────────────────────────────────
export const healthLogs = pgTable("health_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(), // injury | illness | fatigue | life_stress
  description: text("description").notNull(),
  severity: integer("severity").notNull(), // 1-5
  bodyPart: text("body_part"), // for injuries: knee, hamstring, etc.
  date: date("date").notNull(),
  resolvedDate: date("resolved_date"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Fitness Integrations ───────────────────────────────────────────────────
export const fitnessIntegrations = pgTable("fitness_integrations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(), // strava|garmin|apple_health|coros
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  athleteId: text("athlete_id"),
  metadata: jsonb("metadata"),
  isActive: boolean("is_active").default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Athlete thresholds (history; latest active row per metric is current) ───
export const athleteThresholds = pgTable("athlete_thresholds", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  metric: text("metric").notNull(), // see THRESHOLD_METRICS
  value: doublePrecision("value").notNull(),
  source: text("source").notNull(), // manual | auto | test | default
  status: text("status").notNull().default("active"), // active | suggested | dismissed
  note: text("note"),
  activityId: uuid("activity_id"),
  effectiveDate: date("effective_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Coach conversations (Anthropic content blocks, append-only) ──────────────
export const coachThreads = pgTable("coach_threads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const coachMessages = pgTable("coach_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: uuid("thread_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: jsonb("content").notNull(), // Anthropic content block array, stored verbatim
  /** Text shown in the UI for this message (user text or final assistant text). */
  displayText: text("display_text"),
  /** false for internal turns (tool results) that the chat UI hides. */
  visible: boolean("visible").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Coach long-term memory (durable facts across conversations) ──────────────
export const COACH_MEMORY_CATEGORIES = ["injury", "preference", "life", "goal", "race_history", "equipment", "other"] as const;
export type CoachMemoryCategory = (typeof COACH_MEMORY_CATEGORIES)[number];

export const coachMemory = pgTable("coach_memory", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull(),
  category: text("category").$type<CoachMemoryCategory>().notNull(),
  note: text("note").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Daily wellness (Apple Health: HRV, resting HR, sleep) ────────────────────
export const dailyWellness = pgTable(
  "daily_wellness",
  {
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    hrvMs: doublePrecision("hrv_ms"),
    restingHr: integer("resting_hr"),
    sleepMin: integer("sleep_min"),
    source: text("source").notNull().default("apple_health"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

export interface ActivityLap {
  name?: string;
  distanceM: number;
  movingSec: number;
  avgSpeed?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  avgCadence?: number | null;
}

export type SuggestedAction = "none" | "ease_next_days" | "add_recovery_day" | "raise_threshold" | "lower_threshold";

export interface WorkoutAnalysis {
  headline: string;
  summary: string;
  keyPoints: string[];
  nextTime: string;
  suggestedAction: SuggestedAction;
  actionReason: string;
  executionScore: number | null;
  model: string;
  createdAt: string;
  actionApplied?: boolean;
}

// ─── Insert Schemas ─────────────────────────────────────────────────────────
export const insertRunSchema = createInsertSchema(runs).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  sportType: z.enum(["running", "cycling", "swimming", "triathlon"]).default("running"),
  distanceUnit: z.enum(["mi", "km", "yards", "meters"]).optional().default("mi"),
  perceivedEffort: z.number().min(1).max(10).optional(),
  heartRateAvg: z.number().optional(),
  heartRateMax: z.number().optional(),
  elevationGain: z.number().optional(),
  averagePower: z.number().optional(),
  feel: z.number().min(1).max(5).optional().nullable(),
});

export const insertProfileSchema = createInsertSchema(profiles)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    weeklyHoursBucket: z.enum(WEEKLY_HOURS_BUCKETS).optional().nullable(),
    upcomingRaces: upcomingRacesArraySchema.optional().nullable(),
    peakWeeklyVolume: peakWeeklyVolumeSchema,
    weeklyMileageGoal: z.union([z.string(), z.number(), z.null()]).optional(),
    weeklySchedule: weeklyScheduleSchema.optional().nullable(),
    unitSystem: z.enum(["imperial", "metric"]).optional(),
    poolUnit: z.enum(["yards", "meters"]).optional(),
    goalRaceType: z.string().max(40).optional().nullable(),
    limiter: z.enum(["swim", "bike", "run"]).optional().nullable(),
    timezone: z.string().max(64).optional().nullable(),
  });

export const insertTrainingPlanSchema = createInsertSchema(trainingPlans).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlanWorkoutSchema = createInsertSchema(planWorkouts).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export const insertHealthLogSchema = createInsertSchema(healthLogs).omit({
  id: true,
  userId: true,
  createdAt: true,
}).extend({
  type: z.enum(["injury", "illness", "fatigue", "life_stress"]),
  severity: z.number().min(1).max(5),
});

// ─── Types ──────────────────────────────────────────────────────────────────
export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;

export type Run = typeof runs.$inferSelect;
export type InsertRun = z.infer<typeof insertRunSchema>;

export type TrainingPlan = typeof trainingPlans.$inferSelect;
export type InsertTrainingPlan = z.infer<typeof insertTrainingPlanSchema>;

export type PlanWorkout = typeof planWorkouts.$inferSelect;
export type InsertPlanWorkout = z.infer<typeof insertPlanWorkoutSchema>;

export type ChatMessage = typeof chatMessages.$inferSelect;

export type FitnessIntegration = typeof fitnessIntegrations.$inferSelect;

export type HealthLog = typeof healthLogs.$inferSelect;
export type AthleteThreshold = typeof athleteThresholds.$inferSelect;
export type CoachThread = typeof coachThreads.$inferSelect;
export type CoachMessage = typeof coachMessages.$inferSelect;
export type CoachMemory = typeof coachMemory.$inferSelect;
export type DailyWellness = typeof dailyWellness.$inferSelect;
export type InsertHealthLog = z.infer<typeof insertHealthLogSchema>;

// Legacy type for backward compat
export type User = { id: string; username: string };
export type InsertUser = { username: string; password: string };
