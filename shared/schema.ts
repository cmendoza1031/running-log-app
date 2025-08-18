import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const runs = pgTable("runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: date("date").notNull(),
  distance: decimal("distance", { precision: 5, scale: 2 }).notNull(),
  timeHours: integer("time_hours").notNull().default(0),
  timeMinutes: integer("time_minutes").notNull(),
  paceMinutes: integer("pace_minutes").notNull(),
  paceSeconds: integer("pace_seconds").notNull(),
  runType: text("run_type").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertRunSchema = createInsertSchema(runs).omit({
  id: true,
  userId: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runs.$inferSelect;
