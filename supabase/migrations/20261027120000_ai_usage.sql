-- One row per Claude API response (coach turns and workout notes), with its computed cost.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('coach', 'analysis')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON public.ai_usage (user_id, created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "ai_usage_own_read" ON public.ai_usage FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
