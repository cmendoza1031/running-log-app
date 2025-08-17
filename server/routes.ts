import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertRunSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Create a run
  app.post("/api/runs", async (req, res) => {
    try {
      const runData = insertRunSchema.parse(req.body);
      // For demo purposes, using a default user ID
      const userId = "demo-user";
      const run = await storage.createRun(runData, userId);
      res.json(run);
    } catch (error) {
      res.status(400).json({ message: "Invalid run data" });
    }
  });

  // Get all runs for user
  app.get("/api/runs", async (req, res) => {
    try {
      const userId = "demo-user";
      const runs = await storage.getRunsByUserId(userId);
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch runs" });
    }
  });

  // Get runs by date range
  app.get("/api/runs/range", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Start date and end date are required" });
      }
      const userId = "demo-user";
      const runs = await storage.getRunsByUserIdAndDateRange(
        userId, 
        startDate as string, 
        endDate as string
      );
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch runs by date range" });
    }
  });

  // Get runs by month
  app.get("/api/runs/month/:year/:month", async (req, res) => {
    try {
      const { year, month } = req.params;
      const userId = "demo-user";
      const runs = await storage.getRunsByUserIdAndMonth(
        userId, 
        parseInt(year), 
        parseInt(month)
      );
      res.json(runs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch runs for month" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
