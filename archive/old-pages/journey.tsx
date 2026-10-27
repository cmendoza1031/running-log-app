import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import RunDayPopup from "@/components/run-day-popup";
import RunDetailModal from "@/components/run-detail-modal";
import type { Run, PlanWorkout } from "@shared/schema";
import { IOSFeedbackManager } from "@/lib/ios-utils";

// ─── Sport config ──────────────────────────────────────────────────────────────

const SPORT_BG: Record<string, string> = {
  running:   "bg-skyblue/20 border border-skyblue/40",
  cycling:   "bg-amber-400/20 border border-amber-400/40",
  swimming:  "bg-teal-400/20 border border-teal-400/40",
  triathlon: "bg-purple-400/20 border border-purple-400/40",
  other:     "bg-slate-400/15 border border-slate-400/25",
};

const SPORT_DOT: Record<string, string> = {
  running:   "bg-skyblue",
  cycling:   "bg-amber-400",
  swimming:  "bg-teal-400",
  triathlon: "bg-purple-400",
  other:     "bg-slate-400",
};

const SPORT_TEXT: Record<string, string> = {
  running:   "text-skyblue",
  cycling:   "text-amber-400",
  swimming:  "text-teal-400",
  triathlon: "text-purple-400",
  other:     "text-slate-400",
};

const SPORT_EMOJI: Record<string, string> = {
  running:   "🏃",
  cycling:   "🚴",
  swimming:  "🏊",
  triathlon: "🏅",
};

const SPORT_LABEL: Record<string, string> = {
  running:   "Run",
  cycling:   "Ride",
  swimming:  "Swim",
  triathlon: "Tri",
};

const PLAN_DOT: Record<string, string> = {
  easy:      "bg-skyblue/60",
  tempo:     "bg-orange-400/60",
  long:      "bg-purple-400/60",
  interval:  "bg-red-400/60",
  threshold: "bg-yellow-400/60",
  trail:     "bg-green-400/60",
  race:      "bg-pink-500/60",
  recovery:  "bg-teal-400/60",
  rest:      "bg-border",
  other:     "bg-muted-foreground/40",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDistanceStat(total: number, unit: string): string {
  if (unit === "meters") return `${Math.round(total).toLocaleString()} m`;
  if (unit === "yards")  return `${Math.round(total).toLocaleString()} yd`;
  return `${total.toFixed(1)} ${unit}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Journey() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedRuns, setSelectedRuns] = useState<Run[]>([]);
  const [showDayPopup, setShowDayPopup] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [, setLocation] = useLocation();

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear  = currentDate.getFullYear();

  const { data: runs = [], isLoading: runsLoading } = useQuery<Run[]>({
    queryKey: ["/api/runs/month", currentYear, currentMonth],
  });

  const { data: planWorkouts = [] } = useQuery<PlanWorkout[]>({
    queryKey: ["/api/plans/workouts/month", currentYear, currentMonth],
  });

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];

  const navigateMonth = (direction: "prev" | "next") => {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + (direction === "next" ? 1 : -1));
    setCurrentDate(d);
    void IOSFeedbackManager.lightImpact();
  };

  // ─── Per-discipline stats ──────────────────────────────────────────────────
  const disciplineStats = useMemo(() => {
    const groups: Record<string, { total: number; unit: string; count: number }> = {};
    runs.forEach((run) => {
      const sport = run.sportType ?? "running";
      const unit  = run.distanceUnit ?? "mi";
      if (!groups[sport]) groups[sport] = { total: 0, unit, count: 0 };
      groups[sport].total  += parseFloat(String(run.distance));
      groups[sport].count  += 1;
    });
    const order = ["running", "cycling", "swimming", "triathlon"];
    return order.filter((s) => groups[s]).map((s) => ({ sport: s, ...groups[s] }));
  }, [runs]);

  // ─── Calendar lookups ─────────────────────────────────────────────────────
  const runsByDay: Record<number, Run[]> = {};
  runs.forEach((r) => {
    const d = new Date(r.date + "T12:00:00").getDate();
    if (!runsByDay[d]) runsByDay[d] = [];
    runsByDay[d].push(r);
  });

  const planByDay: Record<number, PlanWorkout> = {};
  planWorkouts.forEach((w) => {
    planByDay[new Date(w.date + "T12:00:00").getDate()] = w;
  });

  const daysInMonth     = new Date(currentYear, currentMonth, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1).getDay();
  const adjustedFirst   = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const today           = new Date();

  if (runsLoading) {
    return (
      <div className="px-5 pt-14">
        <div className="h-8 w-48 bg-border rounded-xl mb-2 animate-pulse" />
        <div className="flex gap-3 mb-4">
          {[1, 2].map((i) => <div key={i} className="h-20 w-28 bg-surface-raised rounded-2xl animate-pulse" />)}
        </div>
        <div className="h-80 bg-surface-raised rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-5 pb-28" data-testid="journey-page">
      <div className="pt-14 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Journey</h1>
        <p className="text-skyblue text-sm font-medium mt-0.5">Monthly Progress</p>
      </div>

      {/* Per-discipline stats */}
      {disciplineStats.length > 0 ? (
        <div className="flex gap-3 mb-4 overflow-x-auto pb-1 no-scrollbar">
          {disciplineStats.map(({ sport, total, unit, count }) => (
            <div key={sport} className="flex-shrink-0 bg-surface-raised rounded-2xl px-4 py-3 shadow-sm min-w-[100px]">
              <p className="text-lg mb-0.5">{SPORT_EMOJI[sport] ?? "⚡"}</p>
              <p className={`text-xl font-bold leading-tight ${SPORT_TEXT[sport] ?? "text-foreground"}`}>
                {formatDistanceStat(total, unit)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {count} {SPORT_LABEL[sport] ?? sport}{count !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-4 rounded-2xl bg-surface-raised px-4 py-3 shadow-sm text-sm text-muted-foreground">
          No activities yet — connect Strava to import your workouts.
        </div>
      )}

      {/* Calendar card */}
      <div className="bg-surface-raised rounded-2xl shadow-sm p-5 mb-4">
        <div className="flex justify-between items-center mb-4">
          <button className="p-2 text-skyblue active:scale-90 transition-transform" onClick={() => navigateMonth("prev")}>
            <ChevronLeft size={20} />
          </button>
          <h3 className="text-base font-semibold text-foreground">
            {monthNames[currentMonth - 1]} {currentYear}
          </h3>
          <button className="p-2 text-skyblue active:scale-90 transition-transform" onClick={() => navigateMonth("next")}>
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="text-center text-xs text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: adjustedFirst }, (_, i) => <div key={`pad-${i}`} className="h-12" />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day      = i + 1;
            const dayRuns  = runsByDay[day] ?? [];
            const plan     = planByDay[day];
            const hasRuns  = dayRuns.length > 0;
            const dateStr  = `${currentYear}-${String(currentMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const isToday  = today.getFullYear() === currentYear && today.getMonth() + 1 === currentMonth && today.getDate() === day;
            const primary  = hasRuns ? (dayRuns[0].sportType ?? "running") : null;
            const sports   = hasRuns ? Array.from(new Set(dayRuns.map((r) => r.sportType ?? "running"))) : [];
            const multi    = sports.length > 1;

            return (
              <div
                key={day}
                onClick={() => { if (hasRuns) { setSelectedDate(dateStr); setSelectedRuns(dayRuns); setShowDayPopup(true); void IOSFeedbackManager.lightImpact(); } }}
                className={`relative h-12 flex flex-col items-center justify-center rounded-xl transition-all active:scale-90 ${
                  hasRuns ? `cursor-pointer ${SPORT_BG[primary!] ?? "bg-surface-elevated"}` : "cursor-default"
                } ${isToday ? "ring-2 ring-skyblue ring-offset-1 ring-offset-surface-raised" : ""}`}
              >
                <span className={`text-xs font-semibold ${isToday ? "text-skyblue" : hasRuns ? "text-foreground" : "text-muted-foreground"}`}>
                  {day}
                </span>

                {/* Multi-sport dots */}
                {multi && (
                  <div className="flex gap-0.5 mt-0.5">
                    {sports.slice(0, 3).map((s) => (
                      <div key={s} className={`w-1 h-1 rounded-full ${SPORT_DOT[s] ?? "bg-muted-foreground"}`} />
                    ))}
                  </div>
                )}

                {/* Planned (unlogged) dot */}
                {!hasRuns && plan && !plan.isCompleted && (
                  <div className={`w-1.5 h-1.5 rounded-full mt-0.5 opacity-60 ${PLAN_DOT[plan.workoutType] ?? "bg-muted-foreground/40"}`} />
                )}

                {/* Multiple activities badge */}
                {dayRuns.length > 1 && (
                  <div className="absolute top-1 right-1 w-3.5 h-3.5 bg-surface-raised/80 rounded-full flex items-center justify-center">
                    <span className="text-[8px] font-bold text-foreground">{dayRuns.length}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-surface-raised rounded-xl p-4 shadow-sm mb-4">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Activity Types</h4>
        <div className="grid grid-cols-2 gap-2">
          {(["running", "cycling", "swimming", "triathlon"] as const).map((sport) => (
            <div key={sport} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-sm ${SPORT_BG[sport].split(" ")[0]}`} />
              <span className="text-xs text-muted-foreground">
                {SPORT_EMOJI[sport]} {SPORT_LABEL[sport]}
              </span>
            </div>
          ))}
        </div>
        {planWorkouts.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-border" />
            <span className="text-xs text-muted-foreground">Planned (not yet logged)</span>
          </div>
        )}
      </div>

      <RunDayPopup
        runs={selectedRuns}
        date={selectedDate}
        isOpen={showDayPopup}
        onClose={() => { setShowDayPopup(false); setSelectedDate(""); setSelectedRuns([]); }}
        onRunClick={(run) => { setShowDayPopup(false); setSelectedRun(run); setShowDetailModal(true); }}
      />

      <RunDetailModal
        run={selectedRun}
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedRun(null); }}
        onEdit={(run) => { setShowDetailModal(false); setLocation(`/log?edit=${run.id}`); }}
      />
    </div>
  );
}
