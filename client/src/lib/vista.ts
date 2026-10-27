import { useQuery } from "@tanstack/react-query";
import { Bike, Footprints, Waves, Activity, type LucideIcon } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { Profile } from "@shared/schema";
import type { Sport, UnitSystem, PoolUnit, Thresholds } from "@shared/physiology";
import { apiUrl, authHeaders } from "./queryClient";

// ─── Sports ───────────────────────────────────────────────────────────────────

export interface SportMeta {
  label: string;
  noun: string;
  icon: LucideIcon;
  color: string; // data mark
  tint: string; // icon / accent
}

export const SPORTS: Record<Sport, SportMeta> = {
  swim: { label: "Swim", noun: "swim", icon: Waves, color: "#1A9FD8", tint: "#5AC8FA" },
  bike: { label: "Bike", noun: "ride", icon: Bike, color: "#A45CF0", tint: "#C38BFF" },
  run: { label: "Run", noun: "run", icon: Footprints, color: "#E26A26", tint: "#FF8A47" },
};

export const OTHER_SPORT: SportMeta = { label: "Other", noun: "workout", icon: Activity, color: "#8E8E93", tint: "#AEAEB2" };

export function sportMeta(s: string | null | undefined): SportMeta {
  const key = s === "running" ? "run" : s === "cycling" ? "bike" : s === "swimming" ? "swim" : s;
  return SPORTS[key as Sport] ?? OTHER_SPORT;
}

export function sportKey(s: string | null | undefined): Sport | null {
  const key = s === "running" ? "run" : s === "cycling" ? "bike" : s === "swimming" ? "swim" : s;
  return key === "run" || key === "bike" || key === "swim" ? key : null;
}

/** Garmin-style zone colors (Z1..Z7). */
export const ZONE_COLORS = ["#8E8E93", "#3A86FF", "#2FA864", "#E07A1F", "#E0453A", "#C7307A", "#8E44D6"];
export const zoneColor = (z: number) => ZONE_COLORS[Math.max(0, Math.min(ZONE_COLORS.length - 1, z - 1))];

export const PMC_COLORS = { ctl: "#3A86FF", atl: "#E0457B", tsb: "#AA8A12" };

// ─── Profile / prefs ──────────────────────────────────────────────────────────

export interface Prefs {
  units: UnitSystem;
  pool: PoolUnit;
}

export function useProfile() {
  return useQuery<Profile | null>({ queryKey: ["/api/profile"] });
}

export function usePrefs(): Prefs {
  const { data } = useProfile();
  return { units: data?.unitSystem === "metric" ? "metric" : "imperial", pool: data?.poolUnit === "meters" ? "meters" : "yards" };
}

export interface ThresholdRow {
  id: string;
  metric: string;
  value: number;
  source: string;
  status: string;
  note: string | null;
  effectiveDate: string;
  activityId: string | null;
}

export interface ThresholdState {
  values: Thresholds;
  current: Record<string, ThresholdRow>;
  suggestions: ThresholdRow[];
}

export function useThresholds() {
  return useQuery<ThresholdState>({ queryKey: ["/api/thresholds"] });
}

/** "+5", "−15" (true minus sign), "0". */
export function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : "0";
}

// ─── Dates ────────────────────────────────────────────────────────────────────

export function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDaysStr(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const dow = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
  return addDaysStr(date, -dow);
}

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function relativeDay(date: string, today = localToday()): string {
  if (date === today) return "Today";
  if (date === addDaysStr(today, 1)) return "Tomorrow";
  if (date === addDaysStr(today, -1)) return "Yesterday";
  return fmtDate(date);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ─── Workout file export ──────────────────────────────────────────────────────

/** Download (web) or share (iOS share sheet → Files, AirDrop, Garmin Express, Zwift…) a workout file. */
export async function exportWorkoutFile(workoutId: string, kind: "fit" | "zwo", filenameHint: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/workouts/${workoutId}/${kind}`), { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? "Export failed");
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const filename = cd.match(/filename="([^"]+)"/)?.[1] ?? `${filenameHint}.${kind}`;
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, files: [written.uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
