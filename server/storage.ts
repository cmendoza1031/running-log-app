import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import {
  runs,
  profiles,
  trainingPlans,
  planWorkouts,
  chatMessages,
  fitnessIntegrations,
  type Run,
  type InsertRun,
  type Profile,
  type InsertProfile,
  type TrainingPlan,
  type InsertTrainingPlan,
  type PlanWorkout,
  type InsertPlanWorkout,
  type ChatMessage,
  type FitnessIntegration,
  healthLogs,
  type HealthLog,
  type InsertHealthLog,
} from "@shared/schema";

// ─── Database Connection ─────────────────────────────────────────────────────

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool);

// ─── Storage Interface ───────────────────────────────────────────────────────

export interface IStorage {
  // Profiles
  getProfile(userId: string): Promise<Profile | undefined>;
  upsertProfile(userId: string, profile: Partial<InsertProfile>): Promise<Profile>;

  // Runs
  createRun(run: InsertRun, userId: string): Promise<Run>;
  getRunsByUserId(userId: string): Promise<Run[]>;
  getRunsByUserIdAndDateRange(userId: string, startDate: string, endDate: string): Promise<Run[]>;
  getRunsByUserIdAndMonth(userId: string, year: number, month: number): Promise<Run[]>;
  getRunsByUserIdRecent(userId: string, days: number): Promise<Run[]>;
  getRunById(id: string, userId: string): Promise<Run | undefined>;
  updateRun(id: string, run: Partial<InsertRun>, userId: string): Promise<Run | undefined>;
  deleteRun(id: string, userId: string): Promise<boolean>;

  // Training Plans
  getActivePlan(userId: string): Promise<TrainingPlan | undefined>;
  getPlanById(id: string, userId: string): Promise<TrainingPlan | undefined>;
  getAllPlans(userId: string): Promise<TrainingPlan[]>;
  createTrainingPlan(plan: InsertTrainingPlan, userId: string): Promise<TrainingPlan>;
  updateTrainingPlan(id: string, plan: Partial<InsertTrainingPlan>, userId: string): Promise<TrainingPlan | undefined>;
  deactivateAllPlans(userId: string): Promise<void>;

  // Plan Workouts
  getPlanWorkoutById(id: string, userId: string): Promise<PlanWorkout | undefined>;
  getPlanWorkouts(planId: string, userId: string): Promise<PlanWorkout[]>;
  getPlanWorkoutsByMonth(userId: string, year: number, month: number): Promise<PlanWorkout[]>;
  upsertPlanWorkout(workout: InsertPlanWorkout, userId: string): Promise<PlanWorkout>;
  updatePlanWorkout(id: string, workout: Partial<InsertPlanWorkout>, userId: string): Promise<PlanWorkout | undefined>;
  deletePlanWorkout(id: string, userId: string): Promise<boolean>;
  deleteWorkoutsByPlan(planId: string, userId: string): Promise<void>;

  // Chat Messages
  getChatMessages(userId: string, threadId?: string, limit?: number): Promise<ChatMessage[]>;
  saveChatMessage(userId: string, threadId: string, role: string, content: string, meta?: Record<string, unknown>): Promise<ChatMessage>;
  clearChatThread(userId: string, threadId: string): Promise<void>;

  // Fitness Integrations
  getIntegration(userId: string, provider: string): Promise<FitnessIntegration | undefined>;
  upsertIntegration(userId: string, provider: string, data: Partial<FitnessIntegration>): Promise<FitnessIntegration>;
  getAllIntegrations(userId: string): Promise<FitnessIntegration[]>;

  // Health Logs
  getHealthLogs(userId: string, days?: number): Promise<HealthLog[]>;
  createHealthLog(data: InsertHealthLog, userId: string): Promise<HealthLog>;
  resolveHealthLog(logId: string, resolvedDate: string, userId: string): Promise<HealthLog | undefined>;
}

// ─── Supabase-backed Storage Implementation ──────────────────────────────────

export class SupabaseStorage implements IStorage {

  // ── Profiles ──────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<Profile | undefined> {
    const result = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    return result[0];
  }

  async upsertProfile(userId: string, profile: Partial<InsertProfile>): Promise<Profile> {
    const existing = await this.getProfile(userId);
    // Cast sports array to unknown to avoid Drizzle's strict JSONB generic inference
    const data = { ...profile } as Record<string, unknown>;
    if (existing) {
      const result = await db
        .update(profiles)
        .set({ ...data, updatedAt: new Date() } as Parameters<typeof db.update<typeof profiles>>[0] extends { set: (v: infer V) => unknown } ? V : never)
        .where(eq(profiles.id, userId))
        .returning();
      return result[0];
    } else {
      const result = await db
        .insert(profiles)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ id: userId, ...data } as any)
        .returning();
      return result[0];
    }
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  async createRun(insertRun: InsertRun, userId: string): Promise<Run> {
    const result = await db
      .insert(runs)
      .values({ ...insertRun, userId })
      .returning();
    return result[0];
  }

  async getRunsByUserId(userId: string): Promise<Run[]> {
    return db.select().from(runs).where(eq(runs.userId, userId)).orderBy(desc(runs.date));
  }

  async getRunsByUserIdAndDateRange(userId: string, startDate: string, endDate: string): Promise<Run[]> {
    return db
      .select()
      .from(runs)
      .where(and(eq(runs.userId, userId), gte(runs.date, startDate), lte(runs.date, endDate)))
      .orderBy(desc(runs.date));
  }

  async getRunsByUserIdAndMonth(userId: string, year: number, month: number): Promise<Run[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    return this.getRunsByUserIdAndDateRange(userId, startDate, endDate);
  }

  async getRunsByUserIdRecent(userId: string, days: number): Promise<Run[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    return this.getRunsByUserIdAndDateRange(userId, sinceStr, today);
  }

  async getRunById(id: string, userId: string): Promise<Run | undefined> {
    const result = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.userId, userId)))
      .limit(1);
    return result[0];
  }

  async updateRun(id: string, run: Partial<InsertRun>, userId: string): Promise<Run | undefined> {
    const result = await db
      .update(runs)
      .set({ ...run, updatedAt: new Date() })
      .where(and(eq(runs.id, id), eq(runs.userId, userId)))
      .returning();
    return result[0];
  }

  async deleteRun(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(runs)
      .where(and(eq(runs.id, id), eq(runs.userId, userId)))
      .returning();
    return result.length > 0;
  }

  // ── Training Plans ────────────────────────────────────────────────────────

  async getActivePlan(userId: string): Promise<TrainingPlan | undefined> {
    const result = await db
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.isActive, true)))
      .orderBy(desc(trainingPlans.createdAt))
      .limit(1);
    return result[0];
  }

  async getPlanById(id: string, userId: string): Promise<TrainingPlan | undefined> {
    const result = await db
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.id, id), eq(trainingPlans.userId, userId)))
      .limit(1);
    return result[0];
  }

  async getAllPlans(userId: string): Promise<TrainingPlan[]> {
    return db
      .select()
      .from(trainingPlans)
      .where(eq(trainingPlans.userId, userId))
      .orderBy(desc(trainingPlans.createdAt));
  }

  async createTrainingPlan(plan: InsertTrainingPlan, userId: string): Promise<TrainingPlan> {
    const result = await db
      .insert(trainingPlans)
      .values({ ...plan, userId })
      .returning();
    return result[0];
  }

  async updateTrainingPlan(id: string, plan: Partial<InsertTrainingPlan>, userId: string): Promise<TrainingPlan | undefined> {
    const result = await db
      .update(trainingPlans)
      .set({ ...plan, updatedAt: new Date() })
      .where(and(eq(trainingPlans.id, id), eq(trainingPlans.userId, userId)))
      .returning();
    return result[0];
  }

  async deactivateAllPlans(userId: string): Promise<void> {
    await db
      .update(trainingPlans)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(trainingPlans.userId, userId));
  }

  // ── Plan Workouts ─────────────────────────────────────────────────────────

  async getPlanWorkoutById(id: string, userId: string): Promise<PlanWorkout | undefined> {
    const [workout] = await db
      .select()
      .from(planWorkouts)
      .where(and(eq(planWorkouts.id, id), eq(planWorkouts.userId, userId)));
    return workout;
  }

  async getPlanWorkouts(planId: string, userId: string): Promise<PlanWorkout[]> {
    return db
      .select()
      .from(planWorkouts)
      .where(and(eq(planWorkouts.planId, planId), eq(planWorkouts.userId, userId)))
      .orderBy(planWorkouts.date);
  }

  async getPlanWorkoutsByMonth(userId: string, year: number, month: number): Promise<PlanWorkout[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    return db
      .select()
      .from(planWorkouts)
      .where(
        and(
          eq(planWorkouts.userId, userId),
          gte(planWorkouts.date, startDate),
          lte(planWorkouts.date, endDate)
        )
      )
      .orderBy(planWorkouts.date);
  }

  async upsertPlanWorkout(workout: InsertPlanWorkout, userId: string): Promise<PlanWorkout> {
    const result = await db
      .insert(planWorkouts)
      .values({ ...workout, userId })
      .returning();
    return result[0];
  }

  async updatePlanWorkout(id: string, workout: Partial<InsertPlanWorkout>, userId: string): Promise<PlanWorkout | undefined> {
    const result = await db
      .update(planWorkouts)
      .set({ ...workout, updatedAt: new Date() })
      .where(and(eq(planWorkouts.id, id), eq(planWorkouts.userId, userId)))
      .returning();
    return result[0];
  }

  async deletePlanWorkout(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(planWorkouts)
      .where(and(eq(planWorkouts.id, id), eq(planWorkouts.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async deleteWorkoutsByPlan(planId: string, userId: string): Promise<void> {
    await db
      .delete(planWorkouts)
      .where(and(eq(planWorkouts.planId, planId), eq(planWorkouts.userId, userId)));
  }

  // ── Chat Messages ─────────────────────────────────────────────────────────

  async getChatMessages(userId: string, threadId = "default", limit = 50): Promise<ChatMessage[]> {
    const msgs = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.userId, userId), eq(chatMessages.threadId, threadId)))
      .orderBy(chatMessages.createdAt);
    return msgs.slice(-limit);
  }

  async saveChatMessage(
    userId: string,
    threadId: string,
    role: string,
    content: string,
    meta?: Record<string, unknown>
  ): Promise<ChatMessage> {
    const result = await db
      .insert(chatMessages)
      .values({ userId, threadId, role, content, metadata: meta ?? null })
      .returning();
    return result[0];
  }

  async clearChatThread(userId: string, threadId: string): Promise<void> {
    await db
      .delete(chatMessages)
      .where(and(eq(chatMessages.userId, userId), eq(chatMessages.threadId, threadId)));
  }

  // ── Fitness Integrations ──────────────────────────────────────────────────

  async getIntegration(userId: string, provider: string): Promise<FitnessIntegration | undefined> {
    const result = await db
      .select()
      .from(fitnessIntegrations)
      .where(and(eq(fitnessIntegrations.userId, userId), eq(fitnessIntegrations.provider, provider)))
      .limit(1);
    return result[0];
  }

  async upsertIntegration(userId: string, provider: string, data: Partial<FitnessIntegration>): Promise<FitnessIntegration> {
    const existing = await this.getIntegration(userId, provider);
    if (existing) {
      const result = await db
        .update(fitnessIntegrations)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(fitnessIntegrations.userId, userId), eq(fitnessIntegrations.provider, provider)))
        .returning();
      return result[0];
    } else {
      const result = await db
        .insert(fitnessIntegrations)
        .values({ userId, provider, ...data } as typeof fitnessIntegrations.$inferInsert)
        .returning();
      return result[0];
    }
  }

  async getAllIntegrations(userId: string): Promise<FitnessIntegration[]> {
    return db
      .select()
      .from(fitnessIntegrations)
      .where(eq(fitnessIntegrations.userId, userId));
  }
  // ── Health Logs ───────────────────────────────────────────────────────────

  async getHealthLogs(userId: string, days?: number): Promise<HealthLog[]> {
    const conditions = [eq(healthLogs.userId, userId)];
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString().split("T")[0];
      conditions.push(gte(healthLogs.date, sinceStr));
    }
    return db
      .select()
      .from(healthLogs)
      .where(and(...conditions))
      .orderBy(desc(healthLogs.date));
  }

  async createHealthLog(data: InsertHealthLog, userId: string): Promise<HealthLog> {
    const result = await db
      .insert(healthLogs)
      .values({ ...data, userId })
      .returning();
    return result[0];
  }

  async resolveHealthLog(logId: string, resolvedDate: string, userId: string): Promise<HealthLog | undefined> {
    const result = await db
      .update(healthLogs)
      .set({ resolvedDate })
      .where(and(eq(healthLogs.id, logId), eq(healthLogs.userId, userId)))
      .returning();
    return result[0];
  }
}

export const storage = new SupabaseStorage();
