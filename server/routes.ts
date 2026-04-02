import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertRunSchema, insertProfileSchema } from "@shared/schema";
import { authMiddleware, type AuthenticatedRequest } from "./auth/middleware";
import { handleChatStream, getChatHistory } from "./agent/agent";
import { buildStravaAuthUrl, exchangeStravaCode, syncStravaActivities } from "./integrations/strava";
import { z } from "zod";
import crypto from "crypto";

export async function registerRoutes(app: Express): Promise<Server> {

  // ─── Health Check ──────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ─── Profile ───────────────────────────────────────────────────────────────

  app.get("/api/profile", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const profile = await storage.getProfile(userId);
      res.json(profile ?? null);
    } catch {
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.put("/api/profile", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const data = insertProfileSchema.partial().parse(req.body);
      const profile = await storage.upsertProfile(userId, data);
      res.json(profile);
    } catch {
      res.status(400).json({ message: "Invalid profile data" });
    }
  });

  // ─── Runs ──────────────────────────────────────────────────────────────────

  app.post("/api/runs", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const runData = insertRunSchema.parse(req.body);

      const runDate = new Date(runData.date);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (runDate > today) {
        return res.status(400).json({ message: "Cannot log runs for future dates" });
      }

      const run = await storage.createRun(runData, userId);
      res.json(run);
    } catch {
      res.status(400).json({ message: "Invalid run data" });
    }
  });

  app.get("/api/runs", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const runs = await storage.getRunsByUserId(userId);
      res.json(runs);
    } catch {
      res.status(500).json({ message: "Failed to fetch runs" });
    }
  });

  app.get("/api/runs/range", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }
      const runs = await storage.getRunsByUserIdAndDateRange(userId, startDate as string, endDate as string);
      res.json(runs);
    } catch {
      res.status(500).json({ message: "Failed to fetch runs" });
    }
  });

  app.get("/api/runs/month/:year/:month", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { year, month } = req.params;
      const runs = await storage.getRunsByUserIdAndMonth(userId, parseInt(year), parseInt(month));
      res.json(runs);
    } catch {
      res.status(500).json({ message: "Failed to fetch runs for month" });
    }
  });

  app.get("/api/runs/:id", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const run = await storage.getRunById(req.params.id, userId);
      if (!run) return res.status(404).json({ message: "Run not found" });
      res.json(run);
    } catch {
      res.status(500).json({ message: "Failed to fetch run" });
    }
  });

  app.put("/api/runs/:id", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const runData = insertRunSchema.parse(req.body);

      const runDate = new Date(runData.date);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (runDate > today) {
        return res.status(400).json({ message: "Cannot log runs for future dates" });
      }

      const updated = await storage.updateRun(req.params.id, runData, userId);
      if (!updated) return res.status(404).json({ message: "Run not found" });
      res.json(updated);
    } catch {
      res.status(400).json({ message: "Invalid run data" });
    }
  });

  app.delete("/api/runs/:id", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const deleted = await storage.deleteRun(req.params.id, userId);
      if (!deleted) return res.status(404).json({ message: "Run not found" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete run" });
    }
  });

  // ─── Training Plans ────────────────────────────────────────────────────────

  app.get("/api/plans", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const plans = await storage.getAllPlans(userId);
      res.json(plans);
    } catch {
      res.status(500).json({ message: "Failed to fetch plans" });
    }
  });

  app.get("/api/plans/active", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const plan = await storage.getActivePlan(userId);
      if (!plan) return res.json(null);
      const workouts = await storage.getPlanWorkouts(plan.id, userId);
      res.json({ plan, workouts });
    } catch {
      res.status(500).json({ message: "Failed to fetch active plan" });
    }
  });

  app.get("/api/plans/workouts/month/:year/:month", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { year, month } = req.params;
      const workouts = await storage.getPlanWorkoutsByMonth(userId, parseInt(year), parseInt(month));
      res.json(workouts);
    } catch {
      res.status(500).json({ message: "Failed to fetch plan workouts" });
    }
  });

  app.patch("/api/plans/workouts/:id/complete", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const { runId } = req.body;
      const updated = await storage.updatePlanWorkout(
        req.params.id,
        { isCompleted: true, completedRunId: runId },
        userId
      );
      res.json(updated);
    } catch {
      res.status(500).json({ message: "Failed to complete workout" });
    }
  });

  // ─── AI Coach (Agent) ──────────────────────────────────────────────────────

  app.post("/api/agent/chat", authMiddleware, handleChatStream);

  app.get("/api/agent/history", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const threadId = (req.query.threadId as string) || "default";
      const history = await getChatHistory(userId, threadId);
      res.json(history);
    } catch {
      res.status(500).json({ message: "Failed to fetch history" });
    }
  });

  app.delete("/api/agent/history", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const threadId = (req.query.threadId as string) || "default";
      await storage.clearChatThread(userId, threadId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to clear history" });
    }
  });

  // ─── Strava Integration ────────────────────────────────────────────────────

  app.get("/api/strava/auth", authMiddleware, (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    // State encodes userId for the callback
    const state = Buffer.from(JSON.stringify({ userId, nonce: crypto.randomBytes(8).toString("hex") })).toString("base64url");
    const url = buildStravaAuthUrl(state);
    res.json({ url });
  });

  app.get("/api/strava/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;

      if (error) {
        return res.redirect(`/?strava=denied`);
      }

      if (!code || !state) {
        return res.status(400).send("Missing code or state");
      }

      const decoded = JSON.parse(Buffer.from(state as string, "base64url").toString());
      const userId = decoded.userId as string;

      const tokens = await exchangeStravaCode(code as string);

      await storage.upsertIntegration(userId, "strava", {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(tokens.expires_at * 1000),
        athleteId: String(tokens.athlete.id),
        isActive: true,
        metadata: { athlete: tokens.athlete } as Record<string, unknown>,
      });

      // Trigger initial sync
      const { synced } = await syncStravaActivities(userId);

      res.redirect(`/?strava=connected&synced=${synced}`);
    } catch (err) {
      console.error("Strava callback error:", err);
      res.redirect(`/?strava=error`);
    }
  });

  app.post("/api/strava/sync", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const result = await syncStravaActivities(userId);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      res.status(500).json({ message: msg });
    }
  });

  app.get("/api/strava/status", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const integration = await storage.getIntegration(userId, "strava");
      res.json({
        connected: !!(integration?.isActive && integration?.accessToken),
        lastSynced: integration?.lastSyncedAt ?? null,
        athlete: (integration?.metadata as Record<string, unknown>)?.athlete ?? null,
      });
    } catch {
      res.status(500).json({ message: "Failed to check Strava status" });
    }
  });

  app.delete("/api/strava/disconnect", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      await storage.upsertIntegration(userId, "strava", { isActive: false, accessToken: null, refreshToken: null });
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to disconnect" });
    }
  });

  // ─── Integrations Status ───────────────────────────────────────────────────

  app.get("/api/integrations", authMiddleware, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const integrations = await storage.getAllIntegrations(userId);
      res.json(integrations);
    } catch {
      res.status(500).json({ message: "Failed to fetch integrations" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
