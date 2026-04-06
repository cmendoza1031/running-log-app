-- ============================================================
-- Vista Running — Supabase Schema Migration
-- Run this in your Supabase SQL Editor at:
-- https://supabase.com/dashboard/project/hzlirplpjpllpwddonxz/sql/new
-- ============================================================

-- ── Enable UUID extension ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Profiles (extends auth.users) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  sports JSONB DEFAULT '["running"]'::jsonb,   -- array of sport types
  primary_sport TEXT DEFAULT 'running',
  target_race TEXT,
  target_race_date DATE,
  target_race_distance TEXT,
  weekly_hours_goal DECIMAL(4,1),
  weekly_mileage_goal DECIMAL(5,2),
  fitness_level TEXT DEFAULT 'intermediate' CHECK (fitness_level IN ('beginner','intermediate','advanced','elite')),
  years_training INTEGER,
  age INTEGER,
  bio TEXT,
  onboarding_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── Runs / Activities ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  sport_type TEXT NOT NULL DEFAULT 'running',
  distance DECIMAL(6,2) NOT NULL,
  distance_unit TEXT DEFAULT 'mi',
  time_hours INTEGER NOT NULL DEFAULT 0,
  time_minutes INTEGER NOT NULL,
  pace_minutes INTEGER NOT NULL,
  pace_seconds INTEGER NOT NULL,
  run_type TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  perceived_effort INTEGER CHECK (perceived_effort BETWEEN 1 AND 10),
  heart_rate_avg INTEGER,
  heart_rate_max INTEGER,
  elevation_gain INTEGER,
  external_id TEXT,
  external_source TEXT,
  weather JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── Training Plans ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  goal TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  race_date DATE,
  race_name TEXT,
  race_distance TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by_agent BOOLEAN DEFAULT false,
  plan_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── Plan Workouts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES training_plans(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  workout_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  target_distance DECIMAL(5,2),
  target_pace_min INTEGER,
  target_pace_sec INTEGER,
  target_duration_minutes INTEGER,
  notes TEXT,
  is_completed BOOLEAN DEFAULT false,
  completed_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── Chat Messages ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  thread_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  tool_results JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── Fitness Integrations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fitness_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('strava','garmin','apple_health','coros')),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  athlete_id TEXT,
  metadata JSONB,
  is_active BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, provider)
);

-- ── Health Logs (injury, illness, fatigue tracking for agent context) ────────
CREATE TABLE IF NOT EXISTS health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('injury','illness','fatigue','life_stress')),
  description TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  body_part TEXT,
  date DATE NOT NULL,
  resolved_date DATE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS health_logs_user_date_idx ON health_logs(user_id, date DESC);
ALTER TABLE health_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "health_logs_own" ON health_logs FOR ALL USING (auth.uid() = user_id);

-- ── LangGraph Checkpoint Tables (created automatically by LangGraph) ───────
-- These are created automatically by PostgresSaver.setup() but you can
-- pre-create them here if needed:
-- checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS runs_user_id_date_idx ON runs(user_id, date DESC);
CREATE INDEX IF NOT EXISTS runs_user_id_idx ON runs(user_id);
CREATE INDEX IF NOT EXISTS plan_workouts_user_id_date_idx ON plan_workouts(user_id, date);
CREATE INDEX IF NOT EXISTS plan_workouts_plan_id_idx ON plan_workouts(plan_id);
CREATE INDEX IF NOT EXISTS chat_messages_user_thread_idx ON chat_messages(user_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS training_plans_user_active_idx ON training_plans(user_id, is_active);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE fitness_integrations ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own
CREATE POLICY "profiles_own" ON profiles FOR ALL USING (auth.uid() = id);

-- Runs: users can only see/edit their own
CREATE POLICY "runs_own" ON runs FOR ALL USING (auth.uid() = user_id);

-- Training Plans: users can only see/edit their own
CREATE POLICY "plans_own" ON training_plans FOR ALL USING (auth.uid() = user_id);

-- Plan Workouts: users can only see/edit their own
CREATE POLICY "plan_workouts_own" ON plan_workouts FOR ALL USING (auth.uid() = user_id);

-- Chat Messages: users can only see/edit their own
CREATE POLICY "chat_messages_own" ON chat_messages FOR ALL USING (auth.uid() = user_id);

-- Fitness Integrations: users can only see/edit their own
CREATE POLICY "fitness_integrations_own" ON fitness_integrations FOR ALL USING (auth.uid() = user_id);

-- ── Auto-create profile on signup ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ============================================================
-- Done! Your Vista Running schema is ready.
-- ============================================================
