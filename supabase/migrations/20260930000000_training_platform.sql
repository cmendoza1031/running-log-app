-- Training platform: canonical activity metrics, training load, structured workouts,
-- athlete thresholds history, and append-only coach conversations.
-- Additive and idempotent — safe to run more than once.

-- ── Profiles ────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS unit_system TEXT DEFAULT 'imperial';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pool_unit TEXT DEFAULT 'yards';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sex TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS goal_race_type TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS limiter TEXT;

-- ── Activities (table keeps its historical name "runs") ─────────────────────
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS moving_time_sec INTEGER;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS elapsed_time_sec INTEGER;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS elevation_gain_m DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS avg_speed DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS max_speed DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS avg_cadence DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS normalized_power INTEGER;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS max_power INTEGER;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS kilojoules DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS has_power_meter BOOLEAN;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS trainer BOOLEAN;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS provider_sport_type TEXT;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS calories INTEGER;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS tss DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS intensity_factor DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS load_source TEXT;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS hr_zone_sec JSONB;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS power_zone_sec JSONB;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS pace_zone_sec JSONB;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS best_efforts JSONB;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS decoupling DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS efficiency_factor DOUBLE PRECISION;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS laps JSONB;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS detail_fetched BOOLEAN DEFAULT false;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS streams_fetched BOOLEAN DEFAULT false;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS plan_workout_id UUID;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS feel INTEGER;
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS analysis JSONB;

-- One row per provider activity (webhooks can race the poller).
CREATE UNIQUE INDEX IF NOT EXISTS runs_user_external_uidx
  ON public.runs (user_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Backfill canonical metrics for legacy manually-logged rows.
UPDATE public.runs SET
  moving_time_sec = COALESCE(moving_time_sec, time_hours * 3600 + time_minutes * 60),
  distance_meters = COALESCE(distance_meters, CASE distance_unit
    WHEN 'mi' THEN distance * 1609.344
    WHEN 'km' THEN distance * 1000
    WHEN 'yards' THEN distance * 0.9144
    ELSE distance END),
  elevation_gain_m = COALESCE(elevation_gain_m, elevation_gain * 0.3048)
WHERE moving_time_sec IS NULL OR distance_meters IS NULL;

-- ── Plan workouts ───────────────────────────────────────────────────────────
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS sport TEXT;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS structure JSONB;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS planned_tss DOUBLE PRECISION;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS planned_duration_sec INTEGER;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS planned_distance_m DOUBLE PRECISION;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS week_number INTEGER;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS is_key BOOLEAN DEFAULT false;
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'planned';
ALTER TABLE public.plan_workouts ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
-- target_distance was DECIMAL(5,2): too small for meters; widen.
ALTER TABLE public.plan_workouts ALTER COLUMN target_distance TYPE DECIMAL(9,2);

-- ── Athlete thresholds ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.athlete_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  activity_id UUID REFERENCES public.runs(id) ON DELETE SET NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS athlete_thresholds_user_metric_idx
  ON public.athlete_thresholds (user_id, metric, effective_date DESC, created_at DESC);
ALTER TABLE public.athlete_thresholds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "athlete_thresholds_own" ON public.athlete_thresholds FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Coach conversations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS coach_threads_user_idx ON public.coach_threads (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES public.coach_threads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content JSONB NOT NULL,
  display_text TEXT,
  visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT clock_timestamp() NOT NULL
);
CREATE INDEX IF NOT EXISTS coach_messages_thread_idx ON public.coach_messages (thread_id, created_at);

ALTER TABLE public.coach_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "coach_threads_own" ON public.coach_threads FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "coach_messages_own" ON public.coach_messages FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- fitness_integrations: provider list grows (garmin reserved for the Garmin Connect API).
CREATE INDEX IF NOT EXISTS fitness_integrations_athlete_idx ON public.fitness_integrations (provider, athlete_id);
