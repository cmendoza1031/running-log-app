-- Up to 3 upcoming races (preset + label + optional date) and per-discipline peak weekly volume.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS upcoming_races JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS peak_weekly_volume JSONB;

COMMENT ON COLUMN public.profiles.upcoming_races IS 'Array of up to 3 { presetKey, label, date } for goal events';
COMMENT ON COLUMN public.profiles.peak_weekly_volume IS 'Optional { running, cycling, swimming } peak weekly volume hints';
