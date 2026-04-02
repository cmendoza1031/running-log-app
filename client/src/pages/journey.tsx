import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import RunDayPopup from "@/components/run-day-popup";
import RunDetailModal from "@/components/run-detail-modal";
import type { Run, PlanWorkout } from "@shared/schema";
import { IOSFeedbackManager } from "@/lib/ios-utils";

const RUN_TYPE_CLASSES: Record<string, string> = {
  easy: "run-type-easy",
  tempo: "run-type-tempo",
  long: "run-type-long",
  interval: "run-type-interval",
  trail: "run-type-trail",
  threshold: "run-type-threshold",
  race: "run-type-race",
  recovery: "bg-gradient-to-br from-teal-50 to-teal-100",
  other: "bg-gradient-to-br from-gray-100 to-gray-200",
};

const PLAN_WORKOUT_DOT: Record<string, string> = {
  easy: "bg-blue-300",
  tempo: "bg-orange-400",
  long: "bg-purple-400",
  interval: "bg-red-400",
  threshold: "bg-yellow-400",
  trail: "bg-green-400",
  race: "bg-pink-500",
  recovery: "bg-teal-400",
  rest: "bg-gray-300",
  other: "bg-gray-400",
};

export default function Journey() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedRuns, setSelectedRuns] = useState<Run[]>([]);
  const [showDayPopup, setShowDayPopup] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [, setLocation] = useLocation();

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const { data: runs = [], isLoading: runsLoading } = useQuery<Run[]>({
    queryKey: ["/api/runs/month", currentYear, currentMonth],
  });

  const { data: planWorkouts = [] } = useQuery<PlanWorkout[]>({
    queryKey: ["/api/plans/workouts/month", currentYear, currentMonth],
  });

  const monthlyMiles = runs.reduce((total, run) => total + parseFloat(run.distance), 0);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const navigateMonth = (direction: "prev" | "next") => {
    const newDate = new Date(currentDate);
    newDate.setMonth(newDate.getMonth() + (direction === "next" ? 1 : -1));
    setCurrentDate(newDate);
    IOSFeedbackManager.lightImpact();
  };

  const handleDayClick = (date: string, runs: Run[]) => {
    setSelectedDate(date);
    setSelectedRuns(runs);
    setShowDayPopup(true);
    IOSFeedbackManager.lightImpact();
  };

  const handleRunClick = (run: Run) => {
    setShowDayPopup(false);
    setSelectedRun(run);
    setShowDetailModal(true);
  };

  const handleEditRun = (run: Run) => {
    setShowDetailModal(false);
    setLocation(`/log?edit=${run.id}`);
  };

  // Build lookup maps
  const runsByDate: Record<string, Run[]> = {};
  runs.forEach((r) => {
    const date = new Date(r.date);
    const day = date.getDate();
    if (!runsByDate[day]) runsByDate[day] = [];
    runsByDate[day].push(r);
  });

  const planByDate: Record<string, PlanWorkout> = {};
  planWorkouts.forEach((w) => {
    const date = new Date(w.date);
    planByDate[date.getDate()] = w;
  });

  // Calendar grid
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1).getDay();
  const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const today = new Date();

  if (runsLoading) {
    return (
      <div className="px-6 pt-14">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-gray-800 mb-2">Journey</h1>
          <p className="text-skyblue text-lg font-medium">Monthly Progress</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded mb-4" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-28" data-testid="journey-page">
      {/* Header */}
      <div className="pt-14 pb-4">
        <h1 className="text-2xl font-bold text-gray-900" data-testid="text-page-title">Journey</h1>
        <p className="text-skyblue text-sm font-medium mt-0.5" data-testid="text-page-subtitle">Monthly Progress</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
        {/* Miles stat */}
        <div className="text-center mb-5">
          <div className="text-4xl font-bold text-skyblue" data-testid="text-monthly-miles">
            {monthlyMiles.toFixed(1)}
          </div>
          <div className="text-gray-500 text-sm">Miles this month</div>
        </div>

        {/* Calendar navigation */}
        <div className="flex justify-between items-center mb-4">
          <button className="p-2 text-skyblue active:scale-90 transition-transform" onClick={() => navigateMonth("prev")} data-testid="button-prev-month">
            <ChevronLeft size={20} />
          </button>
          <h3 className="text-base font-semibold text-gray-800" data-testid="text-current-month">
            {monthNames[currentMonth - 1]} {currentYear}
          </h3>
          <button className="p-2 text-skyblue active:scale-90 transition-transform" onClick={() => navigateMonth("next")} data-testid="button-next-month">
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i} className="text-center text-xs text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1" data-testid="monthly-calendar">
          {Array.from({ length: adjustedFirstDay }, (_, i) => (
            <div key={`pad-${i}`} className="h-10" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dayRuns = runsByDate[day] ?? [];
            const planWorkout = planByDate[day];
            const hasRun = dayRuns.length > 0;
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = today.getFullYear() === currentYear && today.getMonth() + 1 === currentMonth && today.getDate() === day;
            const runType = hasRun ? dayRuns[0].runType : null;

            return (
              <div
                key={day}
                className={`relative h-12 flex flex-col items-center justify-center text-sm rounded-xl cursor-pointer active:scale-90 transition-all ${
                  hasRun ? (RUN_TYPE_CLASSES[runType!] ?? "bg-gray-100") : "hover:bg-gray-50"
                } ${isToday ? "ring-2 ring-skyblue ring-offset-1" : ""}`}
                onClick={() => {
                  if (hasRun) handleDayClick(dateStr, dayRuns);
                  else if (planWorkout) IOSFeedbackManager.lightImpact();
                }}
                data-testid={`calendar-day-${day}`}
              >
                <span className={`text-xs font-semibold ${isToday ? "text-skyblue" : hasRun ? "text-gray-700" : "text-gray-400"}`}>
                  {day}
                </span>
                {/* Plan workout indicator (when no actual run logged yet) */}
                {!hasRun && planWorkout && !planWorkout.isCompleted && (
                  <div className={`w-1.5 h-1.5 rounded-full mt-0.5 ${PLAN_WORKOUT_DOT[planWorkout.workoutType] ?? "bg-gray-400"} opacity-60`} />
                )}
                {/* Multiple runs indicator */}
                {dayRuns.length > 1 && (
                  <div className="absolute top-1 right-1 w-3.5 h-3.5 bg-white/80 rounded-full flex items-center justify-center">
                    <span className="text-[8px] font-bold text-gray-700">{dayRuns.length}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-xl p-4 shadow-sm mb-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Run Types</h4>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: "easy", label: "Easy" },
            { key: "tempo", label: "Tempo" },
            { key: "long", label: "Long" },
            { key: "interval", label: "Interval" },
            { key: "trail", label: "Trail" },
            { key: "threshold", label: "Threshold" },
            { key: "race", label: "Race" },
            { key: "recovery", label: "Recovery" },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${PLAN_WORKOUT_DOT[key]}`} />
              <span className="text-xs text-gray-600">{label}</span>
            </div>
          ))}
        </div>
        {planWorkouts.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-50 flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-300 opacity-60" />
            <span className="text-xs text-gray-500">Planned workout (not yet logged)</span>
          </div>
        )}
      </div>

      <RunDayPopup
        runs={selectedRuns}
        date={selectedDate}
        isOpen={showDayPopup}
        onClose={() => { setShowDayPopup(false); setSelectedDate(""); setSelectedRuns([]); }}
        onRunClick={handleRunClick}
      />

      <RunDetailModal
        run={selectedRun}
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedRun(null); }}
        onEdit={handleEditRun}
      />
    </div>
  );
}
