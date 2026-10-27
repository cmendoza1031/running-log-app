import { z } from "zod";
import type { SportType } from "./schema";

/** One saved upcoming race (max 3 per profile). */
export const upcomingRaceEntrySchema = z.object({
  presetKey: z.string().nullable(),
  label: z.string().max(200),
  date: z.string().nullable(),
});

export type UpcomingRaceEntry = z.infer<typeof upcomingRaceEntrySchema>;

export const upcomingRacesArraySchema = z.array(upcomingRaceEntrySchema).max(3);

const runBikePeakSchema = z.object({
  amount: z.string().max(24),
  unit: z.enum(["mi", "km"]),
});

const swimPeakSchema = z.object({
  amount: z.string().max(24),
  unit: z.enum(["yards", "meters", "hours"]),
});

/** Best / highest weekly volume the athlete has handled before (per discipline). */
export const peakWeeklyVolumeSchema = z
  .object({
    running: runBikePeakSchema.optional(),
    cycling: runBikePeakSchema.optional(),
    swimming: swimPeakSchema.optional(),
  })
  .optional()
  .nullable();

export type PeakWeeklyVolume = NonNullable<z.infer<typeof peakWeeklyVolumeSchema>>;

export type RacePreset = { key: string; label: string };

const TRI_PRESETS: RacePreset[] = [
  { key: "tri_sprint", label: "Sprint triathlon" },
  { key: "tri_olympic", label: "Olympic / international distance" },
  { key: "tri_703", label: "Ironman 70.3 / Half Ironman" },
  { key: "tri_full", label: "Full Ironman / 140.6" },
  { key: "tri_aquabike", label: "Aquabike" },
  { key: "tri_duathlon", label: "Duathlon" },
];

const RUN_PRESETS: RacePreset[] = [
  { key: "run_mile", label: "Mile / road mile" },
  { key: "run_5k", label: "5K" },
  { key: "run_10k", label: "10K" },
  { key: "run_10mi", label: "10 mile" },
  { key: "run_half", label: "Half marathon" },
  { key: "run_marathon", label: "Marathon" },
  { key: "run_ultra", label: "Ultra / trail race" },
];

const BIKE_PRESETS: RacePreset[] = [
  { key: "bike_crit", label: "Criterium" },
  { key: "bike_tt", label: "Time trial" },
  { key: "bike_granfondo", label: "Gran fondo" },
  { key: "bike_century", label: "Century (100 mi)" },
  { key: "bike_metric_century", label: "Metric century (100 km)" },
  { key: "bike_road_race", label: "Road race" },
];

const SWIM_PRESETS: RacePreset[] = [
  { key: "swim_pool_sprint", label: "Pool meet — sprint distances" },
  { key: "swim_pool_mid", label: "Pool meet — mid distance (400–1500m)" },
  { key: "swim_ow_short", label: "Open water — short (~1–2 mi)" },
  { key: "swim_ow_long", label: "Open water — long (5K+)" },
  { key: "swim_masters", label: "Masters meet" },
];

const OTHER_PRESET: RacePreset = { key: "other", label: "Other (describe)" };

/** Sentinel for "no preset chosen" in form state (must match Radix Select item value). */
export const RACE_SLOT_NONE = "__none__";

function mergePresets(groups: RacePreset[][]): RacePreset[] {
  const byLabel = new Map<string, RacePreset>();
  for (const group of groups) {
    for (const p of group) {
      if (!byLabel.has(p.label)) byLabel.set(p.label, p);
    }
  }
  return [...byLabel.values()];
}

/**
 * Dropdown options for upcoming races from the athlete's selected sports.
 * Triathlon adds common multisport events; each extra sport adds its race list (labels deduped).
 */
export function buildRacePresetsForSports(sports: SportType[]): RacePreset[] {
  const groups: RacePreset[][] = [];
  if (sports.includes("triathlon")) groups.push(TRI_PRESETS);
  if (sports.includes("running")) groups.push(RUN_PRESETS);
  if (sports.includes("cycling")) groups.push(BIKE_PRESETS);
  if (sports.includes("swimming")) groups.push(SWIM_PRESETS);
  const merged = mergePresets(groups);
  merged.sort((a, b) => a.label.localeCompare(b.label));
  return [...merged, OTHER_PRESET];
}

export function findRacePresetByKey(key: string | null | undefined, sports: SportType[]): RacePreset | undefined {
  if (!key || key === "other") return undefined;
  return buildRacePresetsForSports(sports).find((p) => p.key === key);
}

export type RaceSlotForm = { presetKey: string; label: string; date: string };

export function emptyRaceSlot(): RaceSlotForm {
  return { presetKey: RACE_SLOT_NONE, label: "", date: "" };
}

/** Match legacy free-text labels (e.g. onboarding) to a preset so the dropdown is enough without a second field. */
function tryResolvePresetFromFreeTextLabel(label: string, sports: SportType[]): RacePreset | undefined {
  const t = label.trim().toLowerCase();
  if (t.length < 2) return undefined;
  const options = buildRacePresetsForSports(sports).filter((p) => p.key !== "other");
  const exact = options.find((p) => p.label.toLowerCase() === t);
  if (exact) return exact;
  if (t.length >= 4) {
    const prefix = options.find((p) => p.label.toLowerCase().startsWith(t));
    if (prefix) return prefix;
    const userPrefix = options.find((p) => t.startsWith(p.label.toLowerCase().split("/")[0]!.trim()));
    if (userPrefix) return userPrefix;
  }
  return undefined;
}

export function raceSlotHasContent(slot: RaceSlotForm): boolean {
  return (
    slot.presetKey !== RACE_SLOT_NONE ||
    slot.label.trim() !== "" ||
    slot.date.trim() !== ""
  );
}

/** How many race rows to show initially (1–3): at least one; more if lower slots have data. */
export function initialVisibleRaceSlotCount(slots: [RaceSlotForm, RaceSlotForm, RaceSlotForm]): number {
  let last = -1;
  for (let i = 0; i < 3; i++) {
    if (raceSlotHasContent(slots[i]!)) last = i;
  }
  return last < 0 ? 1 : Math.min(3, last + 1);
}

/** Three slots for forms; partial profile data is merged in order. */
export function initialRaceSlotsFromProfile(
  profile: {
    upcomingRaces?: unknown;
    targetRace?: string | null;
    targetRaceDate?: string | null;
    sports?: unknown;
  } | null | undefined,
  sportsFilter?: SportType[]
): [RaceSlotForm, RaceSlotForm, RaceSlotForm] {
  const base: [RaceSlotForm, RaceSlotForm, RaceSlotForm] = [
    emptyRaceSlot(),
    emptyRaceSlot(),
    emptyRaceSlot(),
  ];
  let list: UpcomingRaceEntry[] = [];
  const raw = profile?.upcomingRaces;
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label : "";
      if (!label.trim()) continue;
      list.push({
        presetKey: typeof o.presetKey === "string" ? o.presetKey : null,
        label,
        date: typeof o.date === "string" ? o.date : o.date === null ? null : null,
      });
    }
  }
  if (list.length === 0 && profile?.targetRace?.trim()) {
    list = [
      {
        presetKey: null,
        label: profile.targetRace.trim(),
        date: profile.targetRaceDate ?? null,
      },
    ];
  }
  list = list.slice(0, 3);
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    let pk = RACE_SLOT_NONE;
    if (e.presetKey === "other") pk = "other";
    else if (e.presetKey) pk = e.presetKey;
    base[i] = {
      presetKey: pk,
      label: e.label,
      date: e.date ?? "",
    };
  }

  const sports =
    sportsFilter ??
    (Array.isArray(profile?.sports)
      ? (profile!.sports as SportType[]).filter((s): s is SportType =>
          ["running", "cycling", "swimming", "triathlon"].includes(s)
        )
      : undefined);
  if (sports?.length) {
    for (let i = 0; i < 3; i++) {
      const s = base[i]!;
      if (s.presetKey === RACE_SLOT_NONE && s.label.trim()) {
        const hit = tryResolvePresetFromFreeTextLabel(s.label, sports);
        if (hit) base[i] = { presetKey: hit.key, label: hit.label, date: s.date };
      }
    }
  }

  return base;
}

/** Build API payload entries from three form slots (drops empties, max 3). */
export function raceSlotsToEntries(slots: RaceSlotForm[], sports: SportType[]): UpcomingRaceEntry[] {
  const presets = buildRacePresetsForSports(sports);
  const byKey = new Map(presets.map((p) => [p.key, p]));
  const out: UpcomingRaceEntry[] = [];
  for (const s of slots) {
    if (s.presetKey === RACE_SLOT_NONE) {
      if (s.label.trim()) {
        out.push({ presetKey: null, label: s.label.trim(), date: s.date.trim() || null });
      }
      continue;
    }
    if (s.presetKey === "other") {
      if (s.label.trim()) {
        out.push({ presetKey: "other", label: s.label.trim(), date: s.date.trim() || null });
      }
      continue;
    }
    const preset = byKey.get(s.presetKey);
    if (preset) {
      out.push({
        presetKey: preset.key,
        label: preset.label,
        date: s.date.trim() || null,
      });
    }
  }
  return out.slice(0, 3);
}

export function formatUpcomingRacesSummary(
  profile: {
    upcomingRaces?: unknown;
    targetRace?: string | null;
    targetRaceDate?: string | null;
    sports?: unknown;
  } | null | undefined
): string {
  const sports =
    (Array.isArray(profile?.sports)
      ? (profile!.sports as SportType[]).filter((s): s is SportType =>
          ["running", "cycling", "swimming", "triathlon"].includes(s)
        )
      : null) ?? ["running"];
  const slots = initialRaceSlotsFromProfile(profile, sports);
  const parts = slots
    .map((s) => {
      if (s.presetKey === RACE_SLOT_NONE && !s.label.trim()) return null;
      const line = s.label.trim() || "(event)";
      const d = s.date?.trim();
      return d ? `${line} (${d})` : line;
    })
    .filter(Boolean) as string[];
  if (parts.length) return parts.join(" · ");
  return "Not set";
}

export function formatPeakWeeklyVolumeSummary(
  peak: PeakWeeklyVolume | null | undefined,
  sports: SportType[]
): string {
  if (!peak || typeof peak !== "object") return "Not set";
  const bits: string[] = [];
  if (sports.includes("running") && peak.running?.amount?.trim()) {
    bits.push(`Run ${peak.running.amount.trim()} ${peak.running.unit}/wk peak`);
  }
  if (sports.includes("cycling") && peak.cycling?.amount?.trim()) {
    bits.push(`Bike ${peak.cycling.amount.trim()} ${peak.cycling.unit}/wk peak`);
  }
  if (sports.includes("swimming") && peak.swimming?.amount?.trim()) {
    const u = peak.swimming.unit;
    const suf = u === "hours" ? "hr/wk peak" : `${u}/wk peak`;
    bits.push(`Swim ${peak.swimming.amount.trim()} ${suf}`);
  }
  return bits.length ? bits.join(" · ") : "Not set";
}

export function defaultPeakForm(): PeakWeeklyVolume {
  return {
    running: { amount: "", unit: "mi" },
    cycling: { amount: "", unit: "mi" },
    swimming: { amount: "", unit: "yards" },
  };
}

export function peakFromProfile(
  peak: PeakWeeklyVolume | null | undefined,
  weeklyMileageGoal?: string | null
): PeakWeeklyVolume {
  const d = defaultPeakForm();
  if (peak && typeof peak === "object") {
    if (peak.running?.amount) d.running = { ...d.running!, ...peak.running };
    if (peak.cycling?.amount) d.cycling = { ...d.cycling!, ...peak.cycling };
    if (peak.swimming?.amount) d.swimming = { ...d.swimming!, ...peak.swimming };
  }
  if (!peak?.running?.amount?.trim() && weeklyMileageGoal != null && String(weeklyMileageGoal).trim() !== "") {
    d.running = { amount: String(weeklyMileageGoal).trim(), unit: "mi" };
  }
  return d;
}

/** Strip to selected sports; omit empty amounts. */
export function peakFormToPayload(peak: PeakWeeklyVolume, sports: SportType[]): PeakWeeklyVolume | null {
  const out: PeakWeeklyVolume = {};
  if (sports.includes("running") && peak.running?.amount?.trim()) {
    out.running = {
      amount: peak.running.amount.trim(),
      unit: peak.running.unit === "km" ? "km" : "mi",
    };
  }
  if (sports.includes("cycling") && peak.cycling?.amount?.trim()) {
    out.cycling = {
      amount: peak.cycling.amount.trim(),
      unit: peak.cycling.unit === "km" ? "km" : "mi",
    };
  }
  if (sports.includes("swimming") && peak.swimming?.amount?.trim()) {
    const u = peak.swimming.unit;
    out.swimming = {
      amount: peak.swimming.amount.trim(),
      unit: u === "meters" || u === "hours" ? u : "yards",
    };
  }
  return Object.keys(out).length ? out : null;
}
