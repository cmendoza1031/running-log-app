# Vista — AI coach for swim, bike & run

Vista builds periodized training plans (5K → Ironman), targets every interval at *your* watts, paces and heart rates, exports structured workouts to your watch, imports every session from Strava automatically, and has an AI coach review each workout and adapt what's next.

## What's in the box

| Area | How it works |
|---|---|
| **Plans** | `server/planning/` — deterministic periodization engine (base → build → peak → taper → race, 3:1 recovery weeks, ≤10%/week ramps, race-specific long sessions, bricks, CSS sets, race-week template, race-day pacing). The coach calls it and then customizes sessions. |
| **Workouts** | `shared/workout-structure.ts` — structured workouts stored *relative to thresholds* (zones, %FTP, %threshold pace, %CSS). Change FTP → every future workout re-targets. Text DSL: `4x(8min 95-100% FTP, 3min Z1)`. |
| **Devices** | `server/fit-export.ts` — Garmin/COROS `.fit` (repeats, power/pace/HR ranges, pool length) and Zwift `.zwo`. On iOS the share sheet opens (AirDrop / Files / Garmin Express). |
| **Data** | `server/integrations/strava.ts` — OAuth, 1-year backfill, detail + streams (laps, zones, NP, power curve, best efforts, decoupling, EF), webhooks for instant import, rate-limit aware. Garmin/COROS/Wahoo/Apple Watch reach Vista through their Strava sync. |
| **Physiology** | `shared/physiology.ts`, `server/analytics/` — VDOT/race predictions, Coggan/Friel/CSS zones, TSS (power, pace, swim, HR, RPE fallbacks), CTL/ATL/TSB with plan projection, intensity distribution, **automatic threshold detection** (only raises on evidence; suggests instead of overwriting values you set). |
| **Coach** | `server/coach/agent.ts` — Claude Opus 5.5 tool-use loop (15 tools: overview, trends, plan create/edit, thresholds, health…), streamed over SSE, append-only history with prompt caching. |
| **Workout notes** | `server/coach/analysis.ts` — Claude Haiku 5.5 writes a short note after every synced workout (≈$0.003 each) with a guarded, one-tap plan adjustment. |
| **App** | `client/` — React + Capacitor iOS. Tabs: Today · Calendar · Coach · Progress · Profile. |

## Run it locally

```bash
npm install
supabase start                       # local auth + Postgres (Docker); migrations in supabase/migrations
cp .env.example .env.localdev        # fill with `supabase status -o env` values + your API keys
npm run dev:local                    # http://localhost:3003
npm run seed:demo                    # optional: demo triathlete demo@vista.local / password123
```

Against the hosted Supabase project use `npm run dev` (reads `.env`).

## iOS

```bash
# Development (live reload from your running dev server)
npm run ios:dev                                   # CAP_SERVER_URL=http://<mac-ip>:3003 for a real device

# App Store build (bundled web app + deployed API)
VITE_API_URL=https://your-api-host npm run ios:release
# then in Xcode: Product → Archive → Distribute App → App Store Connect
```

## Deploy the API

The iOS app needs a public HTTPS API (Strava webhooks need it too). `render.yaml` + `Dockerfile` deploy it on Render (or any Docker host):

1. Render → New → Blueprint → this repo. Fill the env vars (see `.env.example`). Use Supabase's **Session pooler** connection string for `DATABASE_URL`.
2. Set `APP_URL` to the service URL. On boot the server registers the Strava webhook automatically.
3. In Strava API settings set *Authorization Callback Domain* to that host. Both web and iOS return there (iOS bounces back into the app via `vistarunning://`).

## Database migrations

`supabase/migrations/*.sql` are additive and idempotent. Apply with `supabase db push` or paste into the SQL editor.

## Hosting on the free plan (current setup)

The API runs on Render's **free** instance (`plan: free` in `render.yaml`). Render rules that matter ([render.com/docs/free](https://render.com/docs/free)):

- **Spins down after 15 min with no inbound HTTP traffic.** Any request wakes it in about 1 minute; browsers see Render's loading page meanwhile. Opening the web app is enough — no need to touch the Render dashboard.
- While asleep, nothing runs: Strava webhooks fail (the server can't answer in time), the background sync poller is stopped, and in-flight workout notes can be cut off. The app syncs Strava each time it opens, so workouts still arrive — just later.
- **750 free instance hours per workspace per month.** One always-on service uses ~744 h, so it fits — but only one. A second free service on 24/7 would exhaust the hours and Render suspends *all* free services until the next month.
- Render may restart a free instance at any time. No local disk is kept (fine: all data is in Supabase).

**Keep-awake monitor (external — not in this repo):** an UptimeRobot (or cron-job.org) HTTP monitor calls `GET https://vista-api-wy0l.onrender.com/api/health` every 5–14 min so the service never sleeps. A self-ping from inside the app can't work (a sleeping server can't wake itself), and a GitHub Actions cron would burn Actions minutes once the repo is private.
→ **When moving to a paid plan ($7 Starter), delete that monitor and set `plan: starter` here.**

## AI cost tracking

Every Claude response (coach turns and workout notes) writes a row to `ai_usage` with tokens and computed USD cost (`server/analytics/ai-usage.ts`; update `PRICES` there if Anthropic changes pricing). Profile → About shows the signed-in user's month total. All users, in the Supabase SQL editor:

```sql
select date_trunc('day', created_at) as day, kind, model, count(*) as calls, round(sum(cost_usd)::numeric, 4) as usd
from ai_usage group by 1, 2, 3 order by 1 desc;
```
