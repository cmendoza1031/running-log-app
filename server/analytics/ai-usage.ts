/**
 * Claude API cost tracking. Prices are USD per million tokens (first-party API rates, Oct 2026).
 * Cache writes use the 5-minute TTL rate (1.25× input).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { aiUsage } from "@shared/schema";
import { db } from "../storage";

const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: string, u: UsageLike): number {
  // Unknown model (e.g. a refusal fallback): price at Opus 5 rates so cost is never under-reported.
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * p.input * 1.25) /
    1_000_000
  );
}

export interface UsageDetails {
  threadId?: string;
  activityId?: string;
  iteration?: number;
  tools?: string[];
  stopReason?: string | null;
  latencyMs?: number;
}

/** Never throws: cost logging must not break a coach reply or a workout note. */
export async function logAiUsage(userId: string, kind: "coach" | "analysis", model: string, u: UsageLike, d: UsageDetails = {}): Promise<void> {
  try {
    await db.insert(aiUsage).values({
      threadId: d.threadId,
      activityId: d.activityId,
      iteration: d.iteration,
      tools: d.tools ?? [],
      stopReason: d.stopReason ?? null,
      latencyMs: d.latencyMs,
      userId,
      kind,
      model,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      costUsd: costUsd(model, u),
    });
  } catch (err) {
    console.warn("[ai-usage] log failed", err instanceof Error ? err.message : err);
  }
}

export async function usageSummary(userId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayStart = new Date(now.getTime() - 24 * 3600 * 1000);
  const rows = await db
    .select({
      kind: aiUsage.kind,
      cost: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float`,
      calls: sql<number>`count(*)::int`,
      last24h: sql<number>`coalesce(sum(${aiUsage.costUsd}) filter (where ${aiUsage.createdAt} >= ${dayStart}), 0)::float`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStart)))
    .groupBy(aiUsage.kind);
  const pick = (k: string) => rows.find((r) => r.kind === k) ?? { cost: 0, calls: 0, last24h: 0 };
  const coach = pick("coach");
  const analysis = pick("analysis");
  return {
    monthCostUsd: coach.cost + analysis.cost,
    last24hCostUsd: coach.last24h + analysis.last24h,
    coach: { costUsd: coach.cost, calls: coach.calls },
    analysis: { costUsd: analysis.cost, calls: analysis.calls },
  };
}
