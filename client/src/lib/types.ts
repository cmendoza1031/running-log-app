import type { PlanWorkout, Run, TrainingPlan } from "@shared/schema";
import type { RacePacing, Thresholds } from "@shared/physiology";
import type { PmcPoint } from "@/components/charts";
import type { ThresholdRow } from "./vista";

export type { PlanWorkout, Run, TrainingPlan };

export interface SportVolume {
  sec: number;
  meters: number;
  tss: number;
  count: number;
}

export interface WeekVolume {
  week: string;
  sports: { swim: SportVolume; bike: SportVolume; run: SportVolume; other: SportVolume };
  totalSec: number;
  totalTss: number;
  planned: { sec: number; tss: number; count: number; completed: number };
}

export interface FormInfo {
  state: string;
  label: string;
  advice: string;
}

export interface Fitness {
  today: string;
  ctl: number;
  atl: number;
  tsb: number;
  form: FormInfo;
  rampRate: number | null;
  bySport: Record<"swim" | "bike" | "run", { ctl: number; atl: number }>;
  series: PmcPoint[];
}

export interface Dashboard {
  today: string;
  fitness: Fitness;
  planned: PlanWorkout[];
  activities: Run[];
  week: WeekVolume;
  planWeek: { index: number; start: string; phase: string; targetHours: number } | null;
  plan: { id: string; title: string; startDate: string; endDate: string } | null;
  race: { type: string; label: string; name: string | null; date: string; daysOut: number; pacing: RacePacing | null } | null;
  thresholds: Thresholds;
  thresholdUpdates: ThresholdRow[];
  thresholdSuggestions: ThresholdRow[];
  strava: { connected: boolean; lastSynced: string | null };
}

export interface CalendarData {
  workouts: PlanWorkout[];
  activities: Run[];
  weeks: WeekVolume[];
}

export interface IntensityDist {
  low: number;
  moderate: number;
  high: number;
  totalSec: number;
  source: string;
}

export interface ProgressData {
  weeks: WeekVolume[];
  intensity: Record<"all" | "swim" | "bike" | "run", IntensityDist>;
  bests90: { bike: Record<string, number>; run: Record<string, number> };
  bests365: { bike: Record<string, number>; run: Record<string, number> };
  efTrend: { date: string; sport: string; ef: number; decoupling: number | null }[];
  thresholds: Thresholds;
  thresholdCurrent: Record<string, ThresholdRow>;
  thresholdHistory: ThresholdRow[];
  suggestions: ThresholdRow[];
}

export interface SyncResult {
  imported: number;
  enriched: number;
  analyzed: number;
  thresholdChanges: { metric: string; value: number; status: string }[];
  error?: string;
  skipped?: string;
}
