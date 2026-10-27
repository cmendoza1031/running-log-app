import "./env";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startSyncScheduler } from "./sync";
import { ensureStravaWebhook } from "./integrations/strava";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// CORS: the iOS app loads from capacitor://localhost and calls this API cross-origin.
const allowedOrigins = new Set(
  ["capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost", process.env.APP_URL ?? ""]
    .concat((process.env.CORS_ORIGINS ?? "").split(","))
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Timezone");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api")) log(`${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`);
  });
  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: { status?: number; statusCode?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error("Unhandled error:", err);
    if (!res.headersSent) res.status(status).json({ message: status === 500 ? "Internal Server Error" : err.message });
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3003", 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on 0.0.0.0:${port} (db: ${new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname})`);
    if (process.env.DISABLE_SYNC_SCHEDULER !== "1") startSyncScheduler();
    ensureStravaWebhook()
      .then((m) => log(`strava webhook: ${m}`))
      .catch((e) => console.warn("strava webhook setup failed", e));
  });
})();
