-- Coach v1: long-term memory, Apple Health wellness, fueling profile.

-- Durable facts the coach keeps about the athlete across conversations.
CREATE TABLE IF NOT EXISTS public.coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('injury', 'preference', 'life', 'goal', 'race_history', 'equipment', 'other')),
  note TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS coach_memory_user_idx ON public.coach_memory (user_id, archived);

-- One row per athlete per day, read from Apple Health on the device.
CREATE TABLE IF NOT EXISTS public.daily_wellness (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  hrv_ms DOUBLE PRECISION, -- HealthKit HRV (SDNN, ms)
  resting_hr INTEGER,
  sleep_min INTEGER,
  source TEXT NOT NULL DEFAULT 'apple_health',
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.coach_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_wellness ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "coach_memory_own" ON public.coach_memory FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "daily_wellness_own" ON public.daily_wellness FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fueling profile (all optional; planner falls back to population defaults).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sweat_rate_ml_per_h INTEGER;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sweat_sodium_mg_per_l INTEGER;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS carb_tolerance_g_per_h INTEGER;
