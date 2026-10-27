import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { z } from "zod";
import { storage } from "./storage";
import { insertProfileSchema, insertHealthLogSchema, type Run } from "@shared/schema";
import { authMiddleware, type AuthenticatedRequest } from "./auth/middleware";
import { supabaseAdmin } from "./supabase";
import { handleChatStream, getChatHistory, startNewThread } from "./coach/agent";
import { analyzeActivity } from "./coach/analysis";
import {
  buildStravaAuthUrl,
  createStravaOAuthState,
  finishStravaOAuth,
  parseStravaOAuthState,
  deauthorizeStrava,
  webhookVerifyToken,
  updateStravaActivityFromWebhook,
  deleteStravaActivityFromWebhook,
} from "./integrations/strava";
import { syncUser, handleNewStravaActivity, findUserByStravaAthlete } from "./sync";
import { generateWorkoutFit, generateWorkoutZwo } from "./fit-export";
import {
  getActivity,
  getActivitiesBetween,
  getPlanWorkout,
  getPlanWorkoutsBetween,
  getThresholdState,
  getActivePlan,
  patchActivity,
  patchPlanWorkout,
  deletePlanWorkouts,
  deleteActivity,
  insertActivity,
  insertPlanWorkouts,
  listThreads,
  prefsFromProfile,
  setThresholdStatus,
  todayInTz,
  deleteAllUserData,
  listMemories,
  archiveMemory,
  upsertWellness,
} from "./data";
import { getWellness } from "./analytics/wellness";
import { getFitness, weeklyVolume, weekStart, intensityDistribution, activityLoad, recomputeLoads } from "./analytics/load";
import { applyThresholdInput, thresholdInputSchema, ThresholdInputError } from "./analytics/threshold-input";
import { runThresholdDetection } from "./analytics/thresholds";
import {
  createPlanForUser,
  adaptUpcoming,
  buildWorkoutFromDsl,
  ensureActivePlan,
  matchActivityToPlan,
  refreshPlannedMetrics,
  planningThresholds,
} from "./planning/service";
import { addDays } from "@shared/training-load";
import { RACES, racePacing, toSport, type RaceType, METERS_PER_MILE, METERS_PER_YARD, parseClock } from "@shared/physiology";
import { WorkoutParseError } from "@shared/workout-structure";

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Wrap async handlers: auth user id + uniform error handling. */
const route =
  (fn: (req: Request, res: Response, userId: string) => Promise<unknown>): Handler =>
  async (req, res) => {
    try {
      await fn(req, res, (req as AuthenticatedRequest).userId);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid request", issues: err.issues });
        return;
      }
      if (err instanceof ThresholdInputError || err instanceof WorkoutParseError) {
        res.status(400).json({ message: err.message });
        return;
      }
      console.error(`${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) res.status(500).json({ message: "Something went wrong" });
    }
  };

/** Remember the device timezone so "today" is right for server-side work (webhooks, analysis). */
const tzSeen = new Map<string, string>();
async function timezoneMiddleware(req: Request, _res: Response, next: NextFunction) {
  const tz = req.header("x-timezone");
  const userId = (req as AuthenticatedRequest).userId;
  if (tz && userId && tzSeen.get(userId) !== tz && /^[A-Za-z_]+\/[A-Za-z_\/+-]+$|^UTC$/.test(tz)) {
    tzSeen.set(userId, tz);
    const p = await storage.getProfile(userId).catch(() => undefined);
    if (p && p.timezone !== tz) await storage.upsertProfile(userId, { timezone: tz } as never).catch(() => undefined);
  }
  next();
}

const auth = [authMiddleware, timezoneMiddleware];

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

  // ─── Profile ────────────────────────────────────────────────────────────────
  app.get(
    "/api/profile",
    ...auth,
    route(async (_req, res, userId) => {
      let profile = await storage.getProfile(userId);
      if (!profile) profile = await storage.upsertProfile(userId, {});
      res.json(profile);
    }),
  );

  app.put(
    "/api/profile",
    ...auth,
    route(async (req, res, userId) => {
      const data = insertProfileSchema.partial().parse(req.body);
      res.json(await storage.upsertProfile(userId, data));
    }),
  );

  // ─── Dashboard (Today) ──────────────────────────────────────────────────────
  app.get(
    "/api/dashboard",
    ...auth,
    route(async (_req, res, userId) => {
      const profile = await storage.getProfile(userId);
      const prefs = prefsFromProfile(profile);
      const today = todayInTz(prefs.tz);
      const monday = weekStart(today);
      const [fitness, planned, recent, thState, strava, plan] = await Promise.all([
        getFitness(userId, prefs.tz, { historyDays: 42, projectDays: 14 }),
        getPlanWorkoutsBetween(userId, addDays(today, -1), addDays(today, 7)),
        getActivitiesBetween(userId, addDays(today, -21), today),
        getThresholdState(userId),
        storage.getIntegration(userId, "strava"),
        getActivePlan(userId),
      ]);
      const weekPlanned = await getPlanWorkoutsBetween(userId, monday, addDays(monday, 6));
      const [week] = weeklyVolume(recent, weekPlanned, [monday]);
      const race = profile?.goalRaceType as RaceType | null;
      const raceInfo =
        race && RACES[race] && profile?.targetRaceDate && profile.targetRaceDate >= today
          ? {
              type: race,
              label: RACES[race].label,
              name: profile.targetRace,
              date: profile.targetRaceDate,
              daysOut: Math.round((new Date(profile.targetRaceDate).getTime() - new Date(today).getTime()) / 86_400_000),
              pacing: racePacing(race, thState.values, profile.fitnessLevel),
            }
          : null;
      const pd = plan?.planData as { weeks?: { start: string; phase: string; targetHours: number }[] } | null;
      const planWeek = pd?.weeks?.filter((w) => w.start <= today).pop() ?? null;
      const recentThresholdUpdates = Object.values(thState.current).filter(
        (r) => r && r.source === "auto" && r.effectiveDate >= addDays(today, -10),
      );
      res.json({
        today,
        fitness: { ...fitness, series: fitness.series },
        planned,
        activities: recent.slice(0, 12),
        week,
        planWeek,
        plan: plan ? { id: plan.id, title: plan.title, startDate: plan.startDate, endDate: plan.endDate } : null,
        race: raceInfo,
        thresholds: thState.values,
        thresholdUpdates: recentThresholdUpdates,
        thresholdSuggestions: thState.suggestions,
        strava: { connected: !!strava?.isActive, lastSynced: strava?.lastSyncedAt ?? null },
      });
    }),
  );

  // ─── Calendar ───────────────────────────────────────────────────────────────
  app.get(
    "/api/calendar",
    ...auth,
    route(async (req, res, userId) => {
      const q = z.object({ start: z.string(), end: z.string() }).parse(req.query);
      const [workouts, activities] = await Promise.all([
        getPlanWorkoutsBetween(userId, q.start, q.end),
        getActivitiesBetween(userId, q.start, q.end),
      ]);
      const weeks: string[] = [];
      for (let w = weekStart(q.start); w <= q.end; w = addDays(w, 7)) weeks.push(w);
      res.json({ workouts, activities, weeks: weeklyVolume(activities, workouts, weeks) });
    }),
  );

  // ─── Activities ─────────────────────────────────────────────────────────────
  app.get(
    "/api/activities/:id",
    ...auth,
    route(async (req, res, userId) => {
      const act = await getActivity(userId, req.params.id);
      if (!act) return res.status(404).json({ message: "Not found" });
      const planned = act.planWorkoutId ? await getPlanWorkout(userId, act.planWorkoutId) : null;
      res.json({ activity: act, planned });
    }),
  );

  const activityPatch = z.object({
    title: z.string().max(120).optional(),
    notes: z.string().max(4000).nullable().optional(),
    perceivedEffort: z.number().int().min(1).max(10).nullable().optional(),
    feel: z.number().int().min(1).max(5).nullable().optional(),
    reanalyze: z.boolean().optional(),
  });
  app.patch(
    "/api/activities/:id",
    ...auth,
    route(async (req, res, userId) => {
      const { reanalyze, ...patch } = activityPatch.parse(req.body);
      let act = await patchActivity(userId, req.params.id, patch);
      if (!act) return res.status(404).json({ message: "Not found" });
      if (patch.perceivedEffort !== undefined) {
        const l = activityLoad(act, (await getThresholdState(userId)).values);
        act = (await patchActivity(userId, act.id, { tss: l.tss, intensityFactor: l.intensityFactor, loadSource: l.source })) ?? act;
      }
      if (reanalyze) await analyzeActivity(userId, act.id);
      res.json(await getActivity(userId, act.id));
    }),
  );

  app.post(
    "/api/activities/:id/analyze",
    ...auth,
    route(async (req, res, userId) => {
      const a = await analyzeActivity(userId, req.params.id);
      if (!a) return res.status(503).json({ message: "Analysis unavailable right now" });
      res.json(a);
    }),
  );

  const manualActivity = z.object({
    date: z.string(),
    sport: z.enum(["swim", "bike", "run"]),
    title: z.string().max(120).optional(),
    durationSec: z.number().int().min(60).max(24 * 3600),
    distanceMeters: z.number().min(0).max(400000).optional(),
    avgHr: z.number().int().min(40).max(230).optional(),
    avgPower: z.number().int().min(0).max(2000).optional(),
    perceivedEffort: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(4000).optional(),
  });
  app.post(
    "/api/activities",
    ...auth,
    route(async (req, res, userId) => {
      const b = manualActivity.parse(req.body);
      const profile = await storage.getProfile(userId);
      if (b.date > todayInTz(profile?.timezone)) return res.status(400).json({ message: "Can't log future activities" });
      const sportType = b.sport === "run" ? "running" : b.sport === "bike" ? "cycling" : "swimming";
      const dist = b.distanceMeters ?? 0;
      const perUnit = dist > 0 && b.sport !== "bike" ? (b.sport === "swim" ? (b.durationSec / dist) * 100 : b.durationSec / (dist / METERS_PER_MILE)) : 0;
      const row = {
        userId,
        date: b.date,
        sportType,
        distance: String(b.sport === "swim" ? Math.round(dist) : Math.round((dist / METERS_PER_MILE) * 100) / 100),
        distanceUnit: b.sport === "swim" ? "meters" : "mi",
        timeHours: Math.floor(b.durationSec / 3600),
        timeMinutes: Math.floor((b.durationSec % 3600) / 60),
        paceMinutes: Math.min(99, Math.floor(perUnit / 60)),
        paceSeconds: Math.round(perUnit % 60) % 60,
        runType: b.sport === "bike" ? "easy_ride" : b.sport === "swim" ? "easy_swim" : "easy",
        title: b.title ?? `${b.sport === "run" ? "Run" : b.sport === "bike" ? "Ride" : "Swim"}`,
        notes: b.notes ?? null,
        perceivedEffort: b.perceivedEffort ?? null,
        heartRateAvg: b.avgHr ?? null,
        averagePower: b.avgPower ?? null,
        hasPowerMeter: !!b.avgPower,
        movingTimeSec: b.durationSec,
        elapsedTimeSec: b.durationSec,
        distanceMeters: dist || null,
        avgSpeed: dist ? dist / b.durationSec : null,
        externalSource: "manual",
      } as const;
      const th = (await getThresholdState(userId)).values;
      const l = activityLoad(row as unknown as Run, th);
      const inserted = await insertActivity({ ...row, tss: l.tss, intensityFactor: l.intensityFactor, loadSource: l.source });
      if (!inserted) return res.status(500).json({ message: "Couldn't save" });
      await matchActivityToPlan(userId, inserted);
      void analyzeActivity(userId, inserted.id);
      res.json(inserted);
    }),
  );

  app.delete(
    "/api/activities/:id",
    ...auth,
    route(async (req, res, userId) => {
      await deleteActivity(userId, req.params.id);
      res.json({ success: true });
    }),
  );

  // ─── Planned workouts ───────────────────────────────────────────────────────
  app.get(
    "/api/workouts/:id",
    ...auth,
    route(async (req, res, userId) => {
      const w = await getPlanWorkout(userId, req.params.id);
      if (!w) return res.status(404).json({ message: "Not found" });
      const completed = w.completedRunId ? await getActivity(userId, w.completedRunId) : null;
      res.json({ workout: w, activity: completed });
    }),
  );

  const workoutPatch = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["planned", "skipped"]).optional(),
    title: z.string().min(1).max(80).optional(),
    dsl: z.string().min(3).optional(),
    description: z.string().max(1000).nullable().optional(),
  });
  app.patch(
    "/api/workouts/:id",
    ...auth,
    route(async (req, res, userId) => {
      const b = workoutPatch.parse(req.body);
      const w = await getPlanWorkout(userId, req.params.id);
      if (!w) return res.status(404).json({ message: "Not found" });
      const patch: Record<string, unknown> = {};
      if (b.date) patch.date = b.date;
      if (b.status) patch.status = b.status;
      if (b.title) patch.title = b.title;
      if (b.description !== undefined) patch.description = b.description;
      if (b.dsl) {
        const built = await buildWorkoutFromDsl(userId, (w.sport ?? "run") as "run", b.dsl);
        Object.assign(patch, { structure: built.structure }, built.metrics);
      }
      res.json(await patchPlanWorkout(userId, w.id, patch));
    }),
  );

  app.post(
    "/api/workouts",
    ...auth,
    route(async (req, res, userId) => {
      const b = z
        .object({ date: z.string(), sport: z.enum(["swim", "bike", "run"]), title: z.string().min(1).max(80), dsl: z.string().min(3), description: z.string().max(1000).optional() })
        .parse(req.body);
      const built = await buildWorkoutFromDsl(userId, b.sport, b.dsl);
      const plan = await ensureActivePlan(userId);
      const [w] = await insertPlanWorkouts([
        {
          planId: plan.id,
          userId,
          date: b.date,
          sport: b.sport,
          workoutType: b.sport === "bike" ? "easy_ride" : b.sport === "swim" ? "easy_swim" : "easy",
          title: b.title,
          description: b.description ?? null,
          structure: built.structure,
          ...built.metrics,
          status: "planned",
          isCompleted: false,
        },
      ]);
      res.json(w);
    }),
  );

  app.delete(
    "/api/workouts/:id",
    ...auth,
    route(async (req, res, userId) => {
      await deletePlanWorkouts(userId, [req.params.id]);
      res.json({ success: true });
    }),
  );

  app.get(
    "/api/workouts/:id/fit",
    ...auth,
    route(async (req, res, userId) => {
      const w = await getPlanWorkout(userId, req.params.id);
      if (!w) return res.status(404).json({ message: "Not found" });
      const profile = await storage.getProfile(userId);
      const th = await planningThresholds(userId, profile?.fitnessLevel);
      const data = generateWorkoutFit(w, th, prefsFromProfile(profile).pool);
      const filename = `${w.date}_${w.title.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40)}.fit`;
      res.setHeader("Content-Type", "application/vnd.ant.fit");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(data));
    }),
  );

  app.get(
    "/api/workouts/:id/zwo",
    ...auth,
    route(async (req, res, userId) => {
      const w = await getPlanWorkout(userId, req.params.id);
      if (!w) return res.status(404).json({ message: "Not found" });
      const profile = await storage.getProfile(userId);
      const th = await planningThresholds(userId, profile?.fitnessLevel);
      const xml = generateWorkoutZwo(w, th);
      if (!xml) return res.status(400).json({ message: "Zwift files are only available for bike workouts" });
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename="${w.title.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40)}.zwo"`);
      res.send(xml);
    }),
  );

  // ─── Plan ───────────────────────────────────────────────────────────────────
  app.get(
    "/api/plan",
    ...auth,
    route(async (_req, res, userId) => {
      res.json((await getActivePlan(userId)) ?? null);
    }),
  );

  const planBody = z.object({
    race: z.enum(Object.keys(RACES) as [RaceType, ...RaceType[]]).optional(),
    raceDate: z.string().nullable().optional(),
    raceName: z.string().max(80).nullable().optional(),
    startDate: z.string().nullable().optional(),
    weeklyHours: z.number().min(2).max(30).nullable().optional(),
    limiter: z.enum(["swim", "bike", "run"]).nullable().optional(),
  });
  app.post(
    "/api/plan",
    ...auth,
    route(async (req, res, userId) => {
      const b = planBody.parse(req.body);
      const { plan, generated, workoutCount } = await createPlanForUser(userId, b);
      res.json({ plan, phases: generated.phases, workoutCount });
    }),
  );

  app.post(
    "/api/plan/adapt",
    ...auth,
    route(async (req, res, userId) => {
      const b = z.object({ action: z.enum(["ease_next_days", "add_recovery_day"]), activityId: z.string().optional() }).parse(req.body);
      const r = await adaptUpcoming(userId, b.action);
      if (b.activityId) {
        const act = await getActivity(userId, b.activityId);
        if (act?.analysis) await patchActivity(userId, act.id, { analysis: { ...act.analysis, actionApplied: true } });
      }
      res.json(r);
    }),
  );

  // ─── Analytics ──────────────────────────────────────────────────────────────
  app.get(
    "/api/fitness",
    ...auth,
    route(async (req, res, userId) => {
      const q = z.object({ days: z.coerce.number().int().min(7).max(400).default(90), project: z.coerce.number().int().min(0).max(200).default(0) }).parse(req.query);
      const profile = await storage.getProfile(userId);
      res.json(await getFitness(userId, profile?.timezone ?? null, { historyDays: q.days, projectDays: q.project }));
    }),
  );

  app.get(
    "/api/progress",
    ...auth,
    route(async (_req, res, userId) => {
      const profile = await storage.getProfile(userId);
      const prefs = prefsFromProfile(profile);
      const today = todayInTz(prefs.tz);
      const first = weekStart(addDays(today, -7 * 15));
      const weeks = Array.from({ length: 16 }, (_, k) => addDays(first, k * 7));
      const [acts, plan, thState, yearActs] = await Promise.all([
        getActivitiesBetween(userId, first, today),
        getPlanWorkoutsBetween(userId, first, addDays(first, 16 * 7 - 1)),
        getThresholdState(userId),
        getActivitiesBetween(userId, addDays(today, -365), today),
      ]);
      const last4 = acts.filter((r) => r.date >= addDays(today, -28));
      const dist = Object.fromEntries((["all", "swim", "bike", "run"] as const).map((s) => [s, intensityDistribution(last4, s)]));
      // Best efforts over 90 days and all-time-in-window (1 year)
      const bests = (days: number) => {
        const out = { bike: {} as Record<string, number>, run: {} as Record<string, number> };
        for (const r of yearActs) {
          if (r.date < addDays(today, -days)) continue;
          const b = r.bestEfforts as Record<string, number> | null;
          const s = toSport(r.sportType);
          if (!b || (s !== "bike" && s !== "run")) continue;
          for (const [k, v] of Object.entries(b)) {
            out[s][k] = s === "bike" ? Math.max(out[s][k] ?? 0, v) : Math.min(out[s][k] ?? Infinity, v);
          }
        }
        return out;
      };
      const efTrend = yearActs
        .filter((r) => r.efficiencyFactor != null && r.date >= addDays(today, -120))
        .map((r) => ({ date: r.date, sport: toSport(r.sportType), ef: r.efficiencyFactor, decoupling: r.decoupling }))
        .reverse();
      const { getThresholdRows } = await import("./data");
      const history = (await getThresholdRows(userId)).filter((r) => r.status === "active").reverse();
      res.json({
        weeks: weeklyVolume(acts, plan, weeks),
        intensity: dist,
        bests90: bests(90),
        bests365: bests(365),
        efTrend,
        thresholds: thState.values,
        thresholdCurrent: thState.current,
        thresholdHistory: history,
        suggestions: thState.suggestions,
      });
    }),
  );

  // ─── Thresholds ─────────────────────────────────────────────────────────────
  app.get(
    "/api/thresholds",
    ...auth,
    route(async (_req, res, userId) => res.json(await getThresholdState(userId))),
  );

  app.post(
    "/api/thresholds",
    ...auth,
    route(async (req, res, userId) => {
      const input = thresholdInputSchema.parse(req.body);
      const writes = await applyThresholdInput(userId, input, input.cssTest || input.recentRace ? "test" : "manual");
      res.json({ writes, state: await getThresholdState(userId) });
    }),
  );

  app.post(
    "/api/thresholds/detect",
    ...auth,
    route(async (_req, res, userId) => {
      const profile = await storage.getProfile(userId);
      const written = await runThresholdDetection(userId, profile?.timezone ?? null);
      if (written.some((w) => w.status === "active")) {
        await recomputeLoads(userId, profile?.timezone ?? null, 400);
        await refreshPlannedMetrics(userId);
      }
      res.json({ written, state: await getThresholdState(userId) });
    }),
  );

  app.post(
    "/api/thresholds/:id/:decision",
    ...auth,
    route(async (req, res, userId) => {
      const decision = z.enum(["accept", "dismiss"]).parse(req.params.decision);
      const row = await setThresholdStatus(userId, req.params.id, decision === "accept" ? "active" : "dismissed");
      if (!row) return res.status(404).json({ message: "Not found" });
      if (decision === "accept") {
        const profile = await storage.getProfile(userId);
        await recomputeLoads(userId, profile?.timezone ?? null, 42);
        await refreshPlannedMetrics(userId);
      }
      res.json(await getThresholdState(userId));
    }),
  );

  // ─── Coach ──────────────────────────────────────────────────────────────────
  app.post("/api/coach/chat", ...auth, handleChatStream);
  app.get(
    "/api/coach/history",
    ...auth,
    route(async (req, res, userId) => res.json(await getChatHistory(userId, (req.query.threadId as string) || undefined))),
  );
  app.get(
    "/api/coach/threads",
    ...auth,
    route(async (_req, res, userId) => res.json(await listThreads(userId))),
  );
  app.post(
    "/api/coach/threads",
    ...auth,
    route(async (_req, res, userId) => res.json(await startNewThread(userId))),
  );

  app.get(
    "/api/coach/memory",
    ...auth,
    route(async (_req, res, userId) => res.json(await listMemories(userId))),
  );
  app.delete(
    "/api/coach/memory/:id",
    ...auth,
    route(async (req, res, userId) => {
      if (!(await archiveMemory(userId, req.params.id))) return res.status(404).json({ message: "Note not found" });
      res.json({ success: true });
    }),
  );

  // ─── Wellness (Apple Health) ────────────────────────────────────────────────
  app.post(
    "/api/wellness",
    ...auth,
    route(async (req, res, userId) => {
      const day = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hrvMs: z.number().positive().max(400).nullish(),
        restingHr: z.number().int().min(25).max(150).nullish(),
        sleepMin: z.number().int().min(0).max(1440).nullish(),
      });
      const { days } = z.object({ days: z.array(day).max(120) }).parse(req.body);
      res.json({ saved: await upsertWellness(userId, days) });
    }),
  );
  app.get(
    "/api/wellness",
    ...auth,
    route(async (_req, res, userId) => {
      const profile = await storage.getProfile(userId);
      res.json(await getWellness(userId, todayInTz(profile?.timezone)));
    }),
  );

  // ─── Health logs ────────────────────────────────────────────────────────────
  app.get(
    "/api/health-logs",
    ...auth,
    route(async (_req, res, userId) => res.json(await storage.getHealthLogs(userId, 120))),
  );
  app.post(
    "/api/health-logs",
    ...auth,
    route(async (req, res, userId) => res.json(await storage.createHealthLog(insertHealthLogSchema.parse(req.body), userId))),
  );
  app.post(
    "/api/health-logs/:id/resolve",
    ...auth,
    route(async (req, res, userId) => {
      const profile = await storage.getProfile(userId);
      res.json(await storage.resolveHealthLog(req.params.id, todayInTz(profile?.timezone), userId));
    }),
  );

  // ─── Strava ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/strava/auth",
    ...auth,
    route(async (req, res, userId) => {
      if (!process.env.STRAVA_CLIENT_ID) return res.status(503).json({ message: "Strava isn't configured on the server" });
      const mode = req.query.mode === "app" ? "app" : "web";
      res.json({ url: buildStravaAuthUrl(createStravaOAuthState(userId, mode), mode), mode });
    }),
  );

  app.post(
    "/api/strava/exchange",
    ...auth,
    route(async (req, res, userId) => {
      const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.body);
      const parsed = parseStravaOAuthState(state);
      if (parsed.userId !== userId) return res.status(403).json({ message: "OAuth state does not match signed-in user" });
      await finishStravaOAuth(userId, code);
      // History import (a year of activities + detail for recent ones) runs in the background;
      // the app refreshes as data lands.
      void syncUser(userId, { backlog: 25 });
      res.json({ success: true });
    }),
  );

  app.get("/api/strava/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query as Record<string, string | undefined>;
      if (error) return res.redirect(`/?strava=denied`);
      if (!code || !state) return res.status(400).send("Missing code or state");
      const { userId } = parseStravaOAuthState(state);
      await finishStravaOAuth(userId, code);
      void syncUser(userId, { backlog: 25 });
      res.redirect(`/?strava=connected`);
    } catch (err) {
      console.error("Strava callback error:", err);
      res.redirect(`/?strava=error`);
    }
  });

  // iOS: Strava → here → deep link back into the app with code/state.
  app.get("/api/strava/app-callback", (req, res) => {
    const params = new URLSearchParams();
    for (const k of ["code", "state", "error", "scope"]) {
      const v = req.query[k];
      if (typeof v === "string") params.set(k, v);
    }
    const target = `vistarunning://vistarunning/strava-oauth?${params}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${target}"><body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><a href="${target}" style="color:#0A84FF;font-size:18px">Return to Vista</a></body>`);
  });

  app.get(
    "/api/strava/status",
    ...auth,
    route(async (_req, res, userId) => {
      const integration = await storage.getIntegration(userId, "strava");
      res.json({
        connected: !!(integration?.isActive && integration?.accessToken),
        lastSynced: integration?.lastSyncedAt ?? null,
        athlete: (integration?.metadata as Record<string, unknown> | null)?.athlete ?? null,
        configured: !!process.env.STRAVA_CLIENT_ID,
      });
    }),
  );

  app.post(
    "/api/sync",
    ...auth,
    route(async (_req, res, userId) => {
      const integration = await storage.getIntegration(userId, "strava");
      if (!integration?.isActive) return res.json({ imported: 0, enriched: 0, analyzed: 0, thresholdChanges: [], skipped: "not_connected" });
      res.json(await syncUser(userId, { backlog: 5 }));
    }),
  );

  app.delete(
    "/api/strava",
    ...auth,
    route(async (_req, res, userId) => {
      await deauthorizeStrava(userId);
      res.json({ success: true });
    }),
  );

  // Strava webhook: subscription validation + events.
  app.get("/api/strava/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === webhookVerifyToken()) return res.json({ "hub.challenge": challenge });
    res.status(403).end();
  });

  app.post("/api/strava/webhook", async (req, res) => {
    // Acknowledge immediately (Strava requires < 2 s); process asynchronously.
    res.status(200).end();
    const ev = req.body as { object_type?: string; aspect_type?: string; object_id?: number; owner_id?: number; updates?: Record<string, string> };
    if (!ev?.owner_id || !ev.object_id) return;
    try {
      const userId = await findUserByStravaAthlete(String(ev.owner_id));
      if (!userId) return;
      if (ev.object_type === "athlete" && ev.updates?.authorized === "false") {
        await storage.upsertIntegration(userId, "strava", { isActive: false, accessToken: null, refreshToken: null });
        return;
      }
      if (ev.object_type !== "activity") return;
      if (ev.aspect_type === "create") await handleNewStravaActivity(userId, String(ev.object_id));
      else if (ev.aspect_type === "update") await updateStravaActivityFromWebhook(userId, String(ev.object_id), ev.updates ?? {});
      else if (ev.aspect_type === "delete") await deleteStravaActivityFromWebhook(userId, String(ev.object_id));
    } catch (err) {
      console.error("[strava webhook] failed", err);
    }
  });

  // ─── Account ────────────────────────────────────────────────────────────────
  app.delete(
    "/api/account",
    ...auth,
    route(async (_req, res, userId) => {
      await deauthorizeStrava(userId).catch(() => undefined);
      await deleteAllUserData(userId);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) console.error("[account] auth user delete failed", error.message);
      res.json({ success: true });
    }),
  );

  return createServer(app);
}

export { parseClock, METERS_PER_YARD };
