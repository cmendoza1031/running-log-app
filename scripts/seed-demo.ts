/**
 * Seed a demo triathlete with ~4 months of realistic training (for local development/testing).
 *
 *   ENV_FILE=.env.localdev npx tsx scripts/seed-demo.ts demo@vista.local password123
 *
 * Creates the auth user if needed (local Supabase only), a completed profile, and activities
 * shaped like enriched Strava imports (NP, laps, zone seconds, best efforts, decoupling).
 */
import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_FILE || ".env" });

const [, , email = "demo@vista.local", password = "password123"] = process.argv;

async function main() {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Refusing to seed a non-local database");
  }
  const { supabaseAdmin } = await import("../server/supabase");
  const { storage, pool } = await import("../server/storage");
  const { insertActivity, deleteAllUserData } = await import("../server/data");
  const { addDays } = await import("../shared/training-load");
  const { runThresholdDetection } = await import("../server/analytics/thresholds");
  const { recomputeLoads } = await import("../server/analytics/load");
  const { METERS_PER_MILE } = await import("../shared/physiology");

  // ── user
  const { data: list } = await supabaseAdmin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Alex Rivera" } });
    if (error) throw error;
    user = data.user!;
  }
  const userId = user.id;
  await deleteAllUserData(userId);

  const tz = "America/Los_Angeles";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const raceDate = addDays(today, 7 * 26);
  await storage.upsertProfile(userId, {
    fullName: "Alex Rivera",
    sports: ["triathlon"],
    primarySport: "triathlon",
    fitnessLevel: "intermediate",
    age: 31,
    weeklyHoursBucket: "ten_to_fifteen",
    weeklySchedule: [
      { day: 1, maxMinutes: 60, isLongDay: false },
      { day: 2, maxMinutes: 90, isLongDay: false },
      { day: 3, maxMinutes: 90, isLongDay: false },
      { day: 4, maxMinutes: 90, isLongDay: false },
      { day: 5, maxMinutes: 60, isLongDay: false },
      { day: 6, maxMinutes: 360, isLongDay: true },
      { day: 0, maxMinutes: 180, isLongDay: false },
    ],
    goalRaceType: "tri_full",
    targetRace: "Ironman California",
    targetRaceDate: raceDate,
    upcomingRaces: [{ presetKey: "tri_full", label: "Ironman California", date: raceDate }],
    unitSystem: "imperial",
    poolUnit: "yards",
    timezone: tz,
    onboardingComplete: true,
  } as never);

  // ── deterministic pseudo-random
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jitter = (x: number, pct: number) => x * (1 + (rnd() * 2 - 1) * pct);

  const FTP0 = 232;
  const TP0 = 285; // sec/km at start (improves over time)
  const CSS0 = 112; // sec/100m
  const LTHR = 168;
  const MAXHR = 187;
  const days = 120;
  let n = 0;

  const zones = (total: number, dist: number[]) => dist.map((f) => Math.round(total * f));

  for (let i = days; i >= 0; i--) {
    const date = addDays(today, -i);
    const dow = new Date(date + "T12:00:00Z").getUTCDay(); // 0 Sun
    const progress = (days - i) / days; // 0 → 1
    const ftp = FTP0 + 14 * progress;
    const tp = TP0 - 10 * progress;
    const css = CSS0 - 4 * progress;
    const recoveryWeek = Math.floor((days - i) / 7) % 4 === 3;
    const vol = (recoveryWeek ? 0.65 : 1) * (0.8 + 0.3 * progress);
    if (i === 0 && dow !== 6 && dow !== 0) continue; // leave today open for a planned session

    const sessions: Array<() => Record<string, unknown>> = [];
    const swim = (kind: "css" | "easy") => () => {
      const meters = Math.round(jitter(kind === "css" ? 2600 : 2200, 0.1) * vol / 50) * 50;
      const pace = kind === "css" ? css * 1.06 : css * 1.14;
      const secs = Math.round((meters / 100) * jitter(pace, 0.03));
      return {
        sport: "swim",
        title: kind === "css" ? "CSS 10x100" : "Aerobic swim",
        runType: kind === "css" ? "threshold_swim" : "easy_swim",
        secs,
        meters,
        hr: kind === "css" ? 150 : 138,
        paceZone: zones(secs, kind === "css" ? [0.15, 0.35, 0.15, 0.35, 0] : [0.3, 0.6, 0.1, 0, 0]),
      };
    };
    const bike = (kind: "ss" | "endurance" | "long") => () => {
      const mins = kind === "long" ? 150 + 110 * progress : kind === "ss" ? 75 : 60;
      const secs = Math.round(jitter(mins * 60 * vol, 0.08));
      const IF = kind === "ss" ? jitter(0.84, 0.03) : kind === "long" ? jitter(0.72, 0.03) : jitter(0.66, 0.04);
      const np = Math.round(ftp * IF);
      const avg = Math.round(np * (kind === "ss" ? 0.93 : 0.96));
      const speed = 6.5 + IF * 3.3;
      const curve: Record<string, number> = {
        "5": Math.round(ftp * 3.1),
        "60": Math.round(ftp * 1.55),
        "300": Math.round(ftp * (kind === "ss" ? 1.08 : 0.95)),
        "1200": Math.round(ftp * (kind === "ss" ? jitter(1.0, 0.02) : 0.86)),
        "3600": Math.round(ftp * (kind === "long" ? 0.82 : 0.78)),
      };
      const laps =
        kind === "ss"
          ? [
              { name: "WU", distanceM: 7000, movingSec: 900, avgSpeed: 7.8, avgHr: 128, avgPower: Math.round(ftp * 0.62) },
              ...[1, 2, 3].map((k) => ({ name: `SS ${k}`, distanceM: 7200, movingSec: 720, avgSpeed: 10, avgHr: 152 + k * 2, avgPower: Math.round(ftp * jitter(0.9, 0.015)) })),
              { name: "CD", distanceM: 5000, movingSec: 900, avgSpeed: 7, avgHr: 130, avgPower: Math.round(ftp * 0.55) },
            ]
          : null;
      return {
        sport: "bike",
        title: kind === "ss" ? "Sweet Spot 3x12" : kind === "long" ? "Long Ride" : "Endurance Ride",
        runType: kind === "ss" ? "sweet_spot" : kind === "long" ? "long_ride" : "easy_ride",
        secs,
        meters: Math.round(secs * speed),
        hr: kind === "ss" ? 148 : kind === "long" ? 138 : 132,
        np,
        avg,
        curve,
        laps,
        trainer: kind === "ss",
        powerZone: zones(secs, kind === "ss" ? [0.1, 0.35, 0.15, 0.38, 0.02, 0, 0] : [0.12, 0.7, 0.15, 0.03, 0, 0, 0]),
        decoupling: kind === "long" ? +jitter(4.5 - 2 * progress, 0.3).toFixed(1) : null,
        ef: +(np / (kind === "ss" ? 148 : 136)).toFixed(2),
      };
    };
    const run = (kind: "easy" | "tempo" | "long" | "brick") => () => {
      const mins = kind === "long" ? 75 + 45 * progress : kind === "brick" ? 20 : kind === "tempo" ? 55 : 45;
      const secs = Math.round(jitter(mins * 60 * vol, 0.08));
      const pace = kind === "tempo" ? tp * 1.07 : kind === "brick" ? tp * 1.15 : tp * jitter(1.3, 0.03);
      const meters = Math.round(secs / pace * 1000);
      const bests: Record<string, number> = {
        "1000": Math.round(tp * (kind === "tempo" ? 0.95 : 1.15)),
        "1609": Math.round(tp * 1.609 * (kind === "tempo" ? 0.97 : 1.18)),
      };
      if (meters >= 5000) bests["5000"] = Math.round(tp * 5 * (kind === "tempo" ? 1.02 : 1.22));
      if (meters >= 10000) bests["10000"] = Math.round(tp * 10 * (kind === "tempo" ? 1.06 : 1.25));
      return {
        sport: "run",
        title: kind === "tempo" ? "Threshold 3x10" : kind === "long" ? "Long Run" : kind === "brick" ? "Brick Run" : "Easy Run",
        runType: kind === "tempo" ? "threshold" : kind === "long" ? "long" : kind === "brick" ? "brick" : "easy",
        secs,
        meters,
        hr: kind === "tempo" ? 158 : kind === "long" ? 145 : 141,
        bests,
        hrZone: zones(secs, kind === "tempo" ? [0.2, 0.25, 0.15, 0.35, 0.05] : [0.35, 0.55, 0.1, 0, 0]),
        decoupling: kind === "long" ? +jitter(6 - 2.5 * progress, 0.3).toFixed(1) : null,
        ef: +((meters / secs) * 60 / (kind === "tempo" ? 158 : 142)).toFixed(2),
        elev: Math.round(jitter(meters / 1000 * 8, 0.5)),
      };
    };

    if (dow === 1) sessions.push(swim("easy"));
    if (dow === 2) sessions.push(bike("ss"), run("easy"));
    if (dow === 3) sessions.push(swim("css"), run("tempo"));
    if (dow === 4) sessions.push(bike("endurance"));
    if (dow === 5) sessions.push(swim("easy"));
    if (dow === 6) sessions.push(bike("long"), run("brick"));
    if (dow === 0) sessions.push(run("long"));
    if (rnd() < 0.08) sessions.pop(); // life happens

    for (const [k, make] of sessions.entries()) {
      const s = make() as Record<string, any>;
      const sport = s.sport as "swim" | "bike" | "run";
      const sportType = sport === "run" ? "running" : sport === "bike" ? "cycling" : "swimming";
      const start = new Date(`${date}T${k === 0 ? "13" : "15"}:30:00Z`);
      const perUnit = sport === "swim" ? (s.secs / s.meters) * 100 : s.secs / (s.meters / METERS_PER_MILE);
      await insertActivity({
        userId,
        date,
        startTime: start,
        sportType,
        distance: String(sport === "swim" ? s.meters : Math.round((s.meters / METERS_PER_MILE) * 100) / 100),
        distanceUnit: sport === "swim" ? "meters" : "mi",
        timeHours: Math.floor(s.secs / 3600),
        timeMinutes: Math.floor((s.secs % 3600) / 60),
        paceMinutes: sport === "bike" ? 0 : Math.floor(perUnit / 60),
        paceSeconds: sport === "bike" ? 0 : Math.round(perUnit % 60) % 60,
        runType: s.runType,
        title: s.title,
        heartRateAvg: Math.round(jitter(s.hr, 0.02)),
        heartRateMax: Math.round(Math.min(MAXHR, s.hr + 12 + rnd() * 10)),
        averagePower: s.avg ?? null,
        normalizedPower: s.np ?? null,
        hasPowerMeter: sport === "bike",
        trainer: s.trainer ?? false,
        externalId: `seed-${date}-${k}`,
        externalSource: "strava",
        movingTimeSec: s.secs,
        elapsedTimeSec: Math.round(s.secs * 1.05),
        distanceMeters: s.meters,
        elevationGainM: s.elev ?? (sport === "bike" ? Math.round(s.meters / 1000 * 6) : null),
        avgSpeed: s.meters / s.secs,
        hrZoneSec: s.hrZone ?? null,
        powerZoneSec: s.powerZone ?? null,
        paceZoneSec: s.paceZone ?? null,
        bestEfforts: s.curve ?? s.bests ?? null,
        decoupling: s.decoupling ?? null,
        efficiencyFactor: s.ef ?? null,
        laps: s.laps ?? null,
        detailFetched: true,
        streamsFetched: true,
        deviceName: sport === "bike" ? "Garmin Edge 840" : "Garmin Forerunner 965",
        providerSportType: sport === "bike" ? (s.trainer ? "VirtualRide" : "Ride") : sport === "run" ? "Run" : "Swim",
      });
      n++;
    }
  }
  console.log(`Inserted ${n} activities for ${email} (${userId})`);
  const written = await runThresholdDetection(userId, tz);
  console.log("Detected thresholds:", written.map((w) => `${w.metric}=${w.value} (${w.status})`).join(", "));
  // Resting HR and LTHR the athlete "knows"
  const { addThreshold } = await import("../server/data");
  await addThreshold(userId, { metric: "resting_hr", value: 48, source: "manual", effectiveDate: today });
  await addThreshold(userId, { metric: "weight_kg", value: 72, source: "manual", effectiveDate: today });
  console.log("Recomputed loads:", await recomputeLoads(userId, tz, 400));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
