import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Sparkles, Loader2, Trash2 } from "lucide-react";
import {
  formatDistance,
  formatDuration,
  formatClock,
  formatSpeed,
  formatRunPace,
  formatSwimPace,
  HR_ZONE_DEFS,
  POWER_ZONE_DEFS,
  RUN_PACE_ZONE_DEFS,
  SWIM_ZONE_DEFS,
  type Sport,
} from "@shared/physiology";
import type { PlanWorkout, Run } from "@/lib/types";
import { apiJson } from "@/lib/queryClient";
import { usePrefs, sportKey, fmtDate, sportMeta } from "@/lib/vista";
import { PageHeader, Card, Stat, SectionTitle, Skeleton, Pill, PrimaryButton } from "@/components/kit";
import { ZoneBars } from "@/components/charts";
import { CoachNote, WorkoutRow, activitySeconds, activityPaceText } from "@/components/training";
import { useThresholds } from "@/lib/vista";
import { useToast } from "@/hooks/use-toast";
import { IOSFeedbackManager } from "@/lib/ios-utils";

const FEEL = ["Awful", "Bad", "OK", "Good", "Great"];

export default function ActivityPage() {
  const [, params] = useRoute("/activity/:id");
  const id = params?.id ?? "";
  const prefs = usePrefs();
  const { data: th } = useThresholds();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ activity: Run; planned: PlanWorkout | null }>({ queryKey: [`/api/activities/${id}`], enabled: !!id });
  const r = data?.activity;

  const [rpe, setRpe] = useState<number | null>(null);
  const [feel, setFeel] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!r) return;
    setRpe(r.perceivedEffort ?? null);
    setFeel(r.feel ?? null);
    setNotes(r.notes ?? "");
  }, [r?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => apiJson<Run>("PATCH", `/api/activities/${id}`, { perceivedEffort: rpe, feel, notes: notes || null, reanalyze: true }),
    onSuccess: () => {
      void IOSFeedbackManager.successNotification();
      void qc.invalidateQueries();
      toast({ title: "Saved", description: "Your coach updated the note with your feedback." });
    },
  });
  const analyze = useMutation({
    mutationFn: () => apiJson("POST", `/api/activities/${id}/analyze`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [`/api/activities/${id}`] }),
    onError: (e: Error) => toast({ title: "Analysis unavailable", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: () => apiJson("DELETE", `/api/activities/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries();
      navigate("/");
    },
  });

  if (isLoading || !r) {
    return (
      <div className="page page-top space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-36" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  const sport = sportKey(r.sportType) as Sport | null;
  const secs = activitySeconds(r);
  const meta = sportMeta(r.sportType);
  const pace = activityPaceText(r, prefs);
  const time = r.startTime ? new Date(r.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const elevUnit = prefs.units === "imperial" ? "ft" : "m";

  const stats: { label: string; value: string; unit?: string }[] = [
    { label: "Time", value: formatDuration(secs) },
    ...(r.distanceMeters ? [{ label: "Distance", value: formatDistance(r.distanceMeters, sport, prefs.units, prefs.pool) }] : []),
    ...(pace && sport !== "bike" ? [{ label: "Avg pace", value: pace }] : []),
    ...(sport === "bike" && r.distanceMeters ? [{ label: "Avg speed", value: formatSpeed(r.distanceMeters / secs, prefs.units) }] : []),
    ...(r.normalizedPower ? [{ label: "NP", value: `${r.normalizedPower}`, unit: "W" }] : []),
    ...(r.averagePower ? [{ label: "Avg power", value: `${r.averagePower}`, unit: "W" }] : []),
    ...(r.heartRateAvg ? [{ label: "Avg HR", value: `${r.heartRateAvg}`, unit: "bpm" }] : []),
    ...(r.heartRateMax ? [{ label: "Max HR", value: `${r.heartRateMax}`, unit: "bpm" }] : []),
    ...(r.elevationGainM ? [{ label: "Elevation", value: `${Math.round(prefs.units === "imperial" ? r.elevationGainM * 3.28084 : r.elevationGainM)}`, unit: elevUnit }] : []),
    ...(r.tss != null ? [{ label: "Load", value: `${Math.round(r.tss)}`, unit: "TSS" }] : []),
    ...(r.intensityFactor ? [{ label: "Intensity", value: r.intensityFactor.toFixed(2), unit: "IF" }] : []),
    ...(r.avgCadence ? [{ label: "Cadence", value: `${Math.round(sport === "run" ? r.avgCadence * 2 : r.avgCadence)}`, unit: sport === "run" ? "spm" : "rpm" }] : []),
    ...(r.kilojoules ? [{ label: "Work", value: `${Math.round(r.kilojoules)}`, unit: "kJ" }] : []),
  ];

  const zoneSets: { title: string; secs: number[]; names: string[] }[] = [];
  if (r.powerZoneSec?.some((s) => s > 0)) zoneSets.push({ title: "Power zones", secs: r.powerZoneSec, names: POWER_ZONE_DEFS.map((z) => z.name) });
  if (r.hrZoneSec?.some((s) => s > 0)) zoneSets.push({ title: "Heart-rate zones", secs: r.hrZoneSec, names: HR_ZONE_DEFS[sport === "bike" ? "bike" : "run"].map((z) => z.name) });
  if (r.paceZoneSec?.some((s) => s > 0)) zoneSets.push({ title: "Pace zones", secs: r.paceZoneSec, names: (sport === "swim" ? SWIM_ZONE_DEFS : RUN_PACE_ZONE_DEFS).map((z) => z.name) });

  const lapPace = (distanceM: number, movingSec: number, avgSpeed?: number | null) => {
    const v = avgSpeed ?? (movingSec ? distanceM / movingSec : 0);
    if (!v) return "—";
    if (sport === "run") return formatRunPace(1000 / v, prefs.units, false);
    if (sport === "swim") return formatSwimPace(100 / v, prefs.pool, false);
    return formatSpeed(v, prefs.units).replace(/ .*/, "");
  };

  return (
    <div className="page">
      <PageHeader back title={r.title ?? meta.label} subtitle={`${fmtDate(r.date, { weekday: "long", month: "long", day: "numeric" })}${time ? ` · ${time}` : ""}`} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Pill color={meta.tint}>{meta.label}</Pill>
        {r.trainer && <Pill>Indoor</Pill>}
        {r.deviceName && <Pill>{r.deviceName}</Pill>}
        {r.externalSource === "strava" && <Pill color="#FC4C02">Strava</Pill>}
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-3 gap-x-3 gap-y-4">
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} unit={s.unit} />
          ))}
        </div>
      </Card>

      <SectionTitle>Coach</SectionTitle>
      {r.analysis ? (
        <CoachNote analysis={r.analysis} activityId={r.id} />
      ) : (
        <Card className="flex items-center gap-3 p-4">
          <Sparkles size={18} className="text-primary" />
          <div className="flex-1 text-[14px] text-ink-2">Get your coach's take on this session.</div>
          <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="press rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white">
            {analyze.isPending ? <Loader2 size={14} className="animate-spin" /> : "Analyze"}
          </button>
        </Card>
      )}

      <SectionTitle>How did it feel?</SectionTitle>
      <Card className="p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[13px] text-ink-2">Effort (RPE)</span>
          <span className="num text-[15px] font-semibold text-ink-1">{rpe ?? "—"}/10</span>
        </div>
        <div className="mb-4 grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                void IOSFeedbackManager.lightImpact();
                setRpe(n);
              }}
              className={`press h-8 rounded-lg text-[13px] font-semibold ${rpe === n ? "bg-primary text-white" : "bg-white/[0.07] text-ink-2"}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mb-4 grid grid-cols-5 gap-1.5">
          {FEEL.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                void IOSFeedbackManager.lightImpact();
                setFeel(i + 1);
              }}
              className={`press rounded-lg py-2 text-[12px] font-semibold ${feel === i + 1 ? "bg-white/[0.18] text-ink-1" : "bg-white/[0.06] text-ink-3"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes — legs, sleep, fueling, niggles…"
          rows={2}
          className="mb-3 w-full resize-none rounded-xl bg-white/[0.06] px-3 py-2.5 text-[14px] text-ink-1 outline-none placeholder:text-ink-3"
        />
        <PrimaryButton className="w-full" variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : "Save & update coach note"}
        </PrimaryButton>
      </Card>

      {data.planned && (
        <>
          <SectionTitle>Planned session</SectionTitle>
          <WorkoutRow w={data.planned} thresholds={th?.values ?? {}} prefs={prefs} showProfile />
          <Card className="mt-2 grid grid-cols-2 gap-3 p-4">
            <Stat label="Duration vs plan" value={`${Math.round((secs / Math.max(1, data.planned.plannedDurationSec ?? secs)) * 100)}%`} sub={`${formatDuration(secs)} of ${formatDuration(data.planned.plannedDurationSec ?? 0)}`} />
            <Stat
              label="Load vs plan"
              value={r.tss != null && data.planned.plannedTss ? `${Math.round((r.tss / data.planned.plannedTss) * 100)}%` : "—"}
              sub={`${Math.round(r.tss ?? 0)} of ${Math.round(data.planned.plannedTss ?? 0)} TSS`}
            />
          </Card>
        </>
      )}

      {zoneSets.map((z) => (
        <div key={z.title}>
          <SectionTitle>{z.title}</SectionTitle>
          <Card className="p-4">
            <ZoneBars seconds={z.secs} names={z.names} />
          </Card>
        </div>
      ))}

      {(r.decoupling != null || r.efficiencyFactor != null) && (
        <>
          <SectionTitle>Aerobic efficiency</SectionTitle>
          <Card className="grid grid-cols-2 gap-3 p-4">
            {r.decoupling != null && (
              <Stat
                label="Decoupling"
                value={`${r.decoupling}%`}
                sub={<span style={{ color: r.decoupling < 5 ? "#30D158" : r.decoupling < 8 ? "#FFD60A" : "#FF453A" }}>{r.decoupling < 5 ? "Durable" : r.decoupling < 8 ? "Some drift" : "Faded"}</span>}
              />
            )}
            {r.efficiencyFactor != null && <Stat label="Efficiency factor" value={r.efficiencyFactor.toFixed(2)} sub={sport === "bike" ? "NP ÷ HR" : "speed ÷ HR"} />}
            <div className="col-span-2 text-[12px] leading-snug text-ink-3">
              {r.decoupling != null
                ? "Decoupling compares output-per-heartbeat in the first vs second half. Under 5% on long steady sessions means your aerobic engine is holding up."
                : "Efficiency factor is output per heartbeat. Compare it across similar sessions — a rising trend means your aerobic fitness is improving."}
            </div>
          </Card>
        </>
      )}

      {r.laps && r.laps.length > 1 && (
        <>
          <SectionTitle>Laps</SectionTitle>
          <Card className="overflow-hidden">
            <table className="num w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2 font-semibold">#</th>
                  <th className="py-2 font-semibold">Time</th>
                  <th className="py-2 font-semibold">{sport === "bike" ? "Power" : "Pace"}</th>
                  <th className="py-2 pr-4 text-right font-semibold">HR</th>
                </tr>
              </thead>
              <tbody>
                {r.laps.slice(0, 60).map((l, i) => (
                  <tr key={i} className="border-t border-hairline text-ink-1">
                    <td className="px-4 py-2 text-ink-3">{i + 1}</td>
                    <td className="py-2">{formatClock(l.movingSec)}</td>
                    <td className="py-2">{sport === "bike" ? (l.avgPower ? `${l.avgPower} W` : lapPace(l.distanceM, l.movingSec, l.avgSpeed)) : lapPace(l.distanceM, l.movingSec, l.avgSpeed)}</td>
                    <td className="py-2 pr-4 text-right">{l.avgHr ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {r.externalSource !== "strava" && (
        <button type="button" onClick={() => del.mutate()} className="press mt-6 flex w-full items-center justify-center gap-2 py-3 text-[14px] font-medium text-bad">
          <Trash2 size={16} /> Delete activity
        </button>
      )}
      <div className="h-6" />
    </div>
  );
}
