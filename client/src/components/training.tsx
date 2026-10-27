import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Sparkles, TrendingUp, Loader2, SkipForward } from "lucide-react";
import type { PlanWorkout, Run, WorkoutAnalysis } from "@shared/schema";
import {
  formatDistance,
  formatDuration,
  formatRunPace,
  formatSwimPace,
  formatSpeed,
  THRESHOLD_LABELS,
  type ThresholdMetric,
  type Thresholds,
  formatClock,
  runPaceToDisplaySec,
  swimPaceToDisplaySec,
} from "@shared/physiology";
import { isValidStructure, flattenWorkout, compactTime, type WorkoutStructure } from "@shared/workout-structure";
import { apiJson } from "@/lib/queryClient";
import { sportKey, fmtDate, type Prefs, type ThresholdRow } from "@/lib/vista";
import { SportBadge, Pill, Card } from "./kit";
import { WorkoutProfile } from "./charts";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { useToast } from "@/hooks/use-toast";

export function activitySeconds(r: Run): number {
  return r.movingTimeSec ?? r.timeHours * 3600 + r.timeMinutes * 60;
}

/** Headline number for an activity: pace for run/swim, NP/avg power or speed for bike. */
export function activityPaceText(r: Run, prefs: Prefs): string | null {
  const s = sportKey(r.sportType);
  const secs = activitySeconds(r);
  const dist = r.distanceMeters ?? 0;
  if (s === "run" && dist > 0) return formatRunPace(secs / (dist / 1000), prefs.units);
  if (s === "swim" && dist > 0) return formatSwimPace((secs / dist) * 100, prefs.pool);
  if (s === "bike") {
    if (r.normalizedPower) return `${r.normalizedPower} W NP`;
    if (r.averagePower) return `${r.averagePower} W`;
    if (dist > 0) return formatSpeed(dist / secs, prefs.units);
  }
  return null;
}

export function WorkoutRow({ w, thresholds, prefs, showDate, showProfile }: { w: PlanWorkout; thresholds: Thresholds; prefs: Prefs; showDate?: boolean; showProfile?: boolean }) {
  const [, navigate] = useLocation();
  const structure = isValidStructure(w.structure) ? (w.structure as WorkoutStructure) : null;
  const done = w.isCompleted;
  const skipped = w.status === "skipped";
  return (
    <Card onClick={() => navigate(`/workout/${w.id}`)} className={`p-3.5 ${skipped ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-3">
        <SportBadge sport={w.sport ?? w.workoutType} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate text-[15px] font-semibold ${skipped ? "text-ink-3 line-through" : "text-ink-1"}`}>{w.title}</span>
            {w.isKey && !done && !skipped && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Key session" />}
          </div>
          <div className="num mt-0.5 text-[12px] text-ink-2">
            {showDate && <>{fmtDate(w.date)} · </>}
            {formatDuration(w.plannedDurationSec ?? 0)}
            {w.plannedDistanceM && w.sport !== "bike" ? ` · ${formatDistance(w.plannedDistanceM, (w.sport as "run") ?? null, prefs.units, prefs.pool)}` : ""}
            {w.plannedTss ? ` · ${Math.round(w.plannedTss)} TSS` : ""}
          </div>
        </div>
        {done ? (
          <Pill color="#30D158">
            <Check size={12} /> Done
          </Pill>
        ) : skipped ? (
          <Pill>
            <SkipForward size={11} /> Skipped
          </Pill>
        ) : (
          <ChevronRight size={16} className="text-ink-3" />
        )}
      </div>
      {showProfile && structure && (
        <>
          <MainSet structure={structure} thresholds={thresholds} prefs={prefs} />
          <div className="mt-2.5">
            <WorkoutProfile structure={structure} thresholds={thresholds} prefs={prefs} height={36} />
          </div>
        </>
      )}
    </Card>
  );
}

/** The hardest work step's target, e.g. "3×12min @ 211–223 W". */
function MainSet({ structure, thresholds, prefs }: { structure: WorkoutStructure; thresholds: Thresholds; prefs: Prefs }) {
  const flat = flattenWorkout(structure, thresholds, prefs);
  const work = flat.filter((f) => f.intent === "work");
  if (!work.length) return null;
  const top = work.reduce((a, b) => (b.resolved.intensity > a.resolved.intensity ? b : a));
  const reps = top.repeatIndex ? `${top.repeatIndex.of}× ` : "";
  const dur = top.duration.type === "time" ? compactTime(top.duration.sec) : top.duration.type === "distance" ? formatDistance(top.duration.m, structure.sport, prefs.units, prefs.pool) : "";
  return (
    <div className="num mt-2.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[12px] text-ink-2">
      <span className="font-semibold text-ink-1">
        {reps}
        {dur}
      </span>{" "}
      @ {top.targetText}
    </div>
  );
}

export function ActivityRow({ r, prefs, showDate = true }: { r: Run; prefs: Prefs; showDate?: boolean }) {
  const [, navigate] = useLocation();
  const s = sportKey(r.sportType);
  const pace = activityPaceText(r, prefs);
  return (
    <Card onClick={() => navigate(`/activity/${r.id}`)} className="p-3.5">
      <div className="flex items-center gap-3">
        <SportBadge sport={r.sportType} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-ink-1">{r.title ?? r.runType}</div>
          <div className="num mt-0.5 truncate text-[12px] text-ink-2">
            {showDate && <>{fmtDate(r.date)} · </>}
            {formatDuration(activitySeconds(r))}
            {r.distanceMeters ? ` · ${formatDistance(r.distanceMeters, s, prefs.units, prefs.pool)}` : ""}
            {pace ? ` · ${pace}` : ""}
          </div>
        </div>
        {r.tss != null && (
          <div className="text-right">
            <div className="num text-[15px] font-semibold text-ink-1">{Math.round(r.tss)}</div>
            <div className="text-[10px] text-ink-3">TSS</div>
          </div>
        )}
      </div>
      {r.analysis && (
        <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[13px] leading-snug text-ink-2">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-primary" />
          <span className="line-clamp-2">{r.analysis.headline}</span>
        </div>
      )}
    </Card>
  );
}

const ACTION_COPY: Record<string, { label: string; cta: string }> = {
  ease_next_days: { label: "Ease the next 3 days", cta: "Apply" },
  add_recovery_day: { label: "Make tomorrow a recovery day", cta: "Apply" },
  raise_threshold: { label: "Your threshold may be higher", cta: "Review" },
  lower_threshold: { label: "Your threshold may be set too high", cta: "Review" },
};

export function CoachNote({ analysis, activityId, compact }: { analysis: WorkoutAnalysis; activityId: string; compact?: boolean }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const apply = useMutation({
    mutationFn: () => apiJson<{ summary: string }>("POST", "/api/plan/adapt", { action: analysis.suggestedAction, activityId }),
    onSuccess: (r) => {
      void IOSFeedbackManager.successNotification();
      toast({ title: "Plan adjusted", description: r.summary });
      void qc.invalidateQueries();
    },
  });
  const action = analysis.suggestedAction !== "none" ? ACTION_COPY[analysis.suggestedAction] : null;
  return (
    <div className="card-glow p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/20">
          <Sparkles size={13} className="text-primary" />
        </div>
        <span className="eyebrow !text-[#64a8ff]">Coach note</span>
        {analysis.executionScore != null && (
          <span className="ml-auto text-[12px] text-ink-2">
            Execution <span className="num font-semibold text-ink-1">{analysis.executionScore}</span>
          </span>
        )}
      </div>
      <div className="text-[16px] font-semibold leading-snug text-ink-1">{analysis.headline}</div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{analysis.summary}</p>
      {!compact && analysis.keyPoints.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {analysis.keyPoints.map((k, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
              {k}
            </li>
          ))}
        </ul>
      )}
      {!compact && analysis.nextTime && (
        <div className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2.5 text-[13px] leading-snug text-ink-2">
          <span className="font-semibold text-ink-1">Next time: </span>
          {analysis.nextTime}
        </div>
      )}
      {action && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5">
          <TrendingUp size={16} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-1">{action.label}</div>
            {analysis.actionReason && <div className="text-[12px] leading-snug text-ink-2">{analysis.actionReason}</div>}
          </div>
          {analysis.actionApplied ? (
            <Pill color="#30D158">
              <Check size={12} /> Applied
            </Pill>
          ) : analysis.suggestedAction === "raise_threshold" || analysis.suggestedAction === "lower_threshold" ? (
            <button type="button" className="press rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white" onClick={() => navigate("/progress")}>
              {action.cta}
            </button>
          ) : (
            <button
              type="button"
              disabled={apply.isPending}
              className="press rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? <Loader2 size={14} className="animate-spin" /> : action.cta}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export function formatThreshold(metric: string, value: number, prefs: Prefs): string {
  switch (metric) {
    case "ftp":
      return `${Math.round(value)} W`;
    case "run_threshold_pace":
      return formatRunPace(value, prefs.units);
    case "swim_css":
      return formatSwimPace(value, prefs.pool);
    case "weight_kg":
      return prefs.units === "imperial" ? `${Math.round(value * 2.20462)} lb` : `${value} kg`;
    case "vo2max":
      return value.toFixed(1);
    default:
      return `${Math.round(value)} bpm`;
  }
}

/** Human delta between two values of a metric ("↑ 6 W", "6 s/mi faster"). */
export function thresholdDelta(metric: string, prev: number, next: number, prefs: Prefs): string | null {
  const d = next - prev;
  if (Math.abs(d) < 0.5) return null;
  if (metric === "run_threshold_pace") {
    const s = Math.round(Math.abs(runPaceToDisplaySec(next, prefs.units) - runPaceToDisplaySec(prev, prefs.units)));
    return `${s}s/${prefs.units === "imperial" ? "mi" : "km"} ${d < 0 ? "faster" : "slower"}`;
  }
  if (metric === "swim_css") {
    const s = Math.round(Math.abs(swimPaceToDisplaySec(next, prefs.pool) - swimPaceToDisplaySec(prev, prefs.pool)));
    return `${s}s/100 ${d < 0 ? "faster" : "slower"}`;
  }
  return `${d > 0 ? "↑" : "↓"} ${Math.abs(Math.round(d * 10) / 10)}${metric === "ftp" ? " W" : ""}`;
}

export function ThresholdSuggestion({ row, prefs, current }: { row: ThresholdRow; prefs: Prefs; current?: number | null }) {
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (d: "accept" | "dismiss") => apiJson("POST", `/api/thresholds/${row.id}/${d}`),
    onSuccess: () => {
      void IOSFeedbackManager.successNotification();
      void qc.invalidateQueries();
    },
  });
  const label = THRESHOLD_LABELS[row.metric as ThresholdMetric] ?? row.metric;
  return (
    <div className="card-glow p-4">
      <div className="eyebrow mb-1 !text-[#64a8ff]">New {label} detected</div>
      <div className="flex items-baseline gap-2">
        <span className="num text-[26px] font-bold text-ink-1">{formatThreshold(row.metric, row.value, prefs)}</span>
        {current != null && <span className="text-[13px] text-ink-2">from {formatThreshold(row.metric, current, prefs)}</span>}
      </div>
      {row.note && <div className="mt-1 text-[13px] leading-snug text-ink-2">{row.note}</div>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => decide.mutate("accept")} className="press flex-1 rounded-xl bg-primary py-2.5 text-[14px] font-semibold text-white">
          Update zones
        </button>
        <button type="button" onClick={() => decide.mutate("dismiss")} className="press rounded-xl bg-white/[0.08] px-4 py-2.5 text-[14px] font-semibold text-ink-2">
          Not now
        </button>
      </div>
    </div>
  );
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export { formatClock, useState };
