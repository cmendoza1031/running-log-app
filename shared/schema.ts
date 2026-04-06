import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  decimal,
  integer,
  timestamp,
  date,
  boolean,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Sport constants ────────────────────────────────────────────────────────
export const SPORT_TYPES = ["running", "cycling", "swimming", "triathlon"] as const;
export type SportType = typeof SPORT_TYPES[number];

export const FITNESS_LEVELS = ["beginner", "intermediate", "advanced", "elite"] as const;
export type FitnessLevel = typeof FITNESS_LEVELS[number];

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
  weeklyHoursGoal: decimal("weekly_hours_goal", { precision: 4, scale: 1 }), // training hours/week
  weeklyMileageGoal: decimal("weekly_mileage_goal", { precision: 5, scale: 2 }),
  fitnessLevel: text("fitness_level").default("intermediate"), // beginner|intermediate|advanced|elite
  yearsTraining: integer("years_training"),
  age: integer("age"),
  bio: text("bio"),
  onboardingComplete: boolean("onboarding_complete").default(false),
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
  weather: jsonb("weather"),
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
  targetDistance: decimal("target_distance", { precision: 5, scale: 2 }),
  targetPaceMin: integer("target_pace_min"),
  targetPaceSec: integer("target_pace_sec"),
  targetDurationMinutes: integer("target_duration_minutes"),
  notes: text("notes"),
  isCompleted: boolean("is_completed").default(false),
  completedRunId: uuid("completed_run_id"),
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
});

export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
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
export type InsertHealthLog = z.infer<typeof insertHealthLogSchema>;

// Legacy type for backward compat
export type User = { id: string; username: string };
export type InsertUser = { username: string; password: string };
