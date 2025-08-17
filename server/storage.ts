import { type User, type InsertUser, type Run, type InsertRun } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Run operations
  createRun(run: InsertRun, userId: string): Promise<Run>;
  getRunsByUserId(userId: string): Promise<Run[]>;
  getRunsByUserIdAndDateRange(userId: string, startDate: string, endDate: string): Promise<Run[]>;
  getRunsByUserIdAndMonth(userId: string, year: number, month: number): Promise<Run[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private runs: Map<string, Run>;

  constructor() {
    this.users = new Map();
    this.runs = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createRun(insertRun: InsertRun, userId: string): Promise<Run> {
    const id = randomUUID();
    const run: Run = { 
      ...insertRun, 
      id, 
      userId,
      timeHours: insertRun.timeHours || 0,
      notes: insertRun.notes || null,
      createdAt: new Date()
    };
    this.runs.set(id, run);
    return run;
  }

  async getRunsByUserId(userId: string): Promise<Run[]> {
    return Array.from(this.runs.values()).filter(run => run.userId === userId);
  }

  async getRunsByUserIdAndDateRange(userId: string, startDate: string, endDate: string): Promise<Run[]> {
    return Array.from(this.runs.values()).filter(run => 
      run.userId === userId && 
      run.date >= startDate && 
      run.date <= endDate
    );
  }

  async getRunsByUserIdAndMonth(userId: string, year: number, month: number): Promise<Run[]> {
    return Array.from(this.runs.values()).filter(run => {
      if (run.userId !== userId) return false;
      const runDate = new Date(run.date);
      return runDate.getFullYear() === year && runDate.getMonth() === month - 1;
    });
  }
}

export const storage = new MemStorage();
