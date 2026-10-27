-- 002 — weekly_hours_bucket
-- Run once in Supabase SQL Editor after the initial Vista Running migration.
-- Athlete-selected time *range*; weekly_hours_goal remains the derived planning midpoint.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weekly_hours_bucket TEXT
  CHECK (
    weekly_hours_bucket IS NULL
    OR weekly_hours_bucket IN ('under_5', 'five_to_ten', 'ten_to_fifteen', 'fifteen_plus')
  );

-- Backfill bucket from legacy numeric anchors (3, 7, 12, 18, etc.)
UPDATE profiles SET weekly_hours_bucket = CASE
  WHEN weekly_hours_goal IS NULL THEN NULL
  WHEN weekly_hours_goal::numeric <= 4 THEN 'under_5'
  WHEN weekly_hours_goal::numeric <= 9 THEN 'five_to_ten'
  WHEN weekly_hours_goal::numeric <= 14 THEN 'ten_to_fifteen'
  ELSE 'fifteen_plus'
END
WHERE weekly_hours_bucket IS NULL AND weekly_hours_goal IS NOT NULL;

-- Normalize planning midpoints to match app (shared/weekly-hours-bucket.ts)
UPDATE profiles SET weekly_hours_goal = CASE weekly_hours_bucket
  WHEN 'under_5' THEN 3.5
  WHEN 'five_to_ten' THEN 7.5
  WHEN 'ten_to_fifteen' THEN 12.5
  WHEN 'fifteen_plus' THEN 18.0
END
WHERE weekly_hours_bucket IS NOT NULL;
