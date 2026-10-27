/**
 * Weekly training time from onboarding: store the athlete's chosen *range* explicitly,
 * and derive a numeric planning default for any code that needs a single hours/week anchor.
 */

export const WEEKLY_HOURS_BUCKETS = ["under_5", "five_to_ten", "ten_to_fifteen", "fifteen_plus"] as const;
export type WeeklyHoursBucket = (typeof WEEKLY_HOURS_BUCKETS)[number];

export const WEEKLY_HOURS_BUCKET_LABELS: Record<WeeklyHoursBucket, string> = {
  under_5: "< 5 hrs/week",
  five_to_ten: "5–10 hrs/week",
  ten_to_fifteen: "10–15 hrs/week",
  fifteen_plus: "15+ hrs/week",
};

export function isWeeklyHoursBucket(v: string): v is WeeklyHoursBucket {
  return (WEEKLY_HOURS_BUCKETS as readonly string[]).includes(v);
}

/** Decimal string for `profiles.weekly_hours_goal` (midpoint / planning default). */
export function planningHoursStringForBucket(bucket: WeeklyHoursBucket): string {
  const m: Record<WeeklyHoursBucket, string> = {
    under_5: "3.5",
    five_to_ten: "7.5",
    ten_to_fifteen: "12.5",
    fifteen_plus: "18.0",
  };
  return m[bucket];
}

/** Infer bucket from legacy numeric anchors (3, 7, 12, 18) or similar. */
export function weeklyHoursBucketFromLegacyGoal(goalStr: string): WeeklyHoursBucket | null {
  const n = parseFloat(goalStr);
  if (!Number.isFinite(n)) return null;
  if (n <= 4) return "under_5";
  if (n <= 9) return "five_to_ten";
  if (n <= 14) return "ten_to_fifteen";
  return "fifteen_plus";
}

/** UI cards / selects (onboarding + settings). */
export const WEEKLY_HOURS_UI_OPTIONS: { value: WeeklyHoursBucket; label: string; sub: string }[] = [
  { value: "under_5", label: "< 5 hrs/week", sub: "Casual" },
  { value: "five_to_ten", label: "5–10 hrs/week", sub: "Moderate" },
  { value: "ten_to_fifteen", label: "10–15 hrs/week", sub: "Serious" },
  { value: "fifteen_plus", label: "15+ hrs/week", sub: "High volume" },
];

export function weeklyTimeCommitmentDisplay(profile: {
  weeklyHoursBucket?: string | null;
  weeklyHoursGoal?: string | null;
}): string {
  if (profile.weeklyHoursBucket && isWeeklyHoursBucket(profile.weeklyHoursBucket)) {
    return WEEKLY_HOURS_BUCKET_LABELS[profile.weeklyHoursBucket];
  }
  if (profile.weeklyHoursGoal != null && String(profile.weeklyHoursGoal).trim() !== "") {
    return `~${profile.weeklyHoursGoal} hrs/week`;
  }
  return "Not set";
}
