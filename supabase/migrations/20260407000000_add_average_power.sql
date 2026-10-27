-- 003 — average_power
-- Run once in Supabase SQL Editor. Adds average power (watts) for cycling activities.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS average_power INTEGER;
