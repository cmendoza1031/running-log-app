import type { TrainingDay } from "@shared/schema";
import { IOSFeedbackManager } from "@/lib/ios-utils";

// Mon-first display order
const DAY_DISPLAY = [
  { short: "M", label: "Mon", day: 1 },
  { short: "T", label: "Tue", day: 2 },
  { short: "W", label: "Wed", day: 3 },
  { short: "T", label: "Thu", day: 4 },
  { short: "F", label: "Fri", day: 5 },
  { short: "S", label: "Sat", day: 6 },
  { short: "S", label: "Sun", day: 0 },
];

const DURATION_OPTIONS = [
  { label: "45m", minutes: 45 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
  { label: "3h", minutes: 180 },
  { label: "4h", minutes: 240 },
  { label: "5h+", minutes: 330 },
];

// Mon → Sun sort order
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function WeeklySchedulePicker({
  schedule,
  onChange,
}: {
  schedule: TrainingDay[];
  onChange: (s: TrainingDay[]) => void;
}) {
  const toggleDay = (day: number) => {
    if (schedule.some((d) => d.day === day)) {
      onChange(schedule.filter((d) => d.day !== day));
    } else {
      onChange([...schedule, { day, maxMinutes: 60, isLongDay: false }]);
    }
    void IOSFeedbackManager.lightImpact();
  };

  const setDuration = (day: number, minutes: number) => {
    onChange(schedule.map((d) => (d.day === day ? { ...d, maxMinutes: minutes } : d)));
    void IOSFeedbackManager.lightImpact();
  };

  // Up to two long days (e.g. Sat long ride + Sun long run). Starring a third replaces one of the other two.
  const toggleLongDay = (day: number) => {
    const isCurrentlyLong = schedule.find((d) => d.day === day)?.isLongDay ?? false;
    const starred = schedule.filter((d) => d.isLongDay).map((d) => d.day);
    const keep = isCurrentlyLong ? starred.filter((d) => d !== day) : [...starred.slice(-1), day];
    onChange(schedule.map((d) => ({ ...d, isLongDay: keep.includes(d.day) })));
    void IOSFeedbackManager.mediumImpact();
  };
  const restDays = DAY_DISPLAY.filter(({ day }) => !schedule.some((d) => d.day === day));

  const sorted = [...schedule].sort(
    (a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)
  );

  return (
    <div>
      {/* Day selector row */}
      <div className="flex justify-between px-0.5 mb-5">
        {DAY_DISPLAY.map(({ short, label, day }) => {
          const isSelected = schedule.some((d) => d.day === day);
          const isLong = schedule.some((d) => d.day === day && d.isLongDay);
          return (
            <button
              type="button"
              key={`${day}-${label}`}
              onClick={() => toggleDay(day)}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all active:scale-90 ${
                  isLong
                    ? "bg-amber-500 text-white shadow-sm shadow-amber-500/30"
                    : isSelected
                    ? "bg-primary text-white"
                    : "bg-surface-raised text-muted-foreground"
                }`}
              >
                {isLong ? "★" : short}
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">{isSelected ? label : "Rest"}</span>
            </button>
          );
        })}
      </div>

      {/* Per-day duration cards */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-6 text-center">
          <p className="text-sm text-muted-foreground">Tap a day above to add it</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sorted.map(({ day, maxMinutes, isLongDay }) => {
            const info = DAY_DISPLAY.find((d) => d.day === day);
            return (
              <div
                key={day}
                className={`rounded-2xl border-2 p-3.5 transition-colors ${
                  isLongDay
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-white/[0.06] bg-[#0d0d0f]"
                }`}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <span
                    className={`text-sm font-semibold ${
                      isLongDay ? "text-amber-400" : "text-foreground"
                    }`}
                  >
                    {info?.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleLongDay(day)}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
                      isLongDay
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-surface-elevated text-muted-foreground"
                    }`}
                  >
                    {isLongDay ? "★ Long day" : "☆ Long day"}
                  </button>
                </div>
                <div className="flex gap-1.5">
                  {DURATION_OPTIONS.map(({ label, minutes }) => (
                    <button
                      type="button"
                      key={minutes}
                      onClick={() => setDuration(day, minutes)}
                      className={`flex-1 rounded-xl py-2 text-[11px] font-semibold transition-all active:scale-95 ${
                        maxMinutes === minutes
                          ? isLongDay
                            ? "bg-amber-500 text-white"
                            : "bg-primary text-white"
                          : "bg-surface-elevated text-muted-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center mt-4">
        Star up to 2 long days (e.g. Sat long ride, Sun long run). With one star, the long run goes on the day next to it.
      </p>
      <p className="text-xs text-muted-foreground text-center mt-1.5">
        {restDays.length
          ? `Rest: ${restDays.map((d) => d.label).join(", ")}. Days you don't pick get no training.`
          : "No rest day — most athletes adapt better with at least one full day off. Tap a day to make it a rest day."}
      </p>
    </div>
  );
}
