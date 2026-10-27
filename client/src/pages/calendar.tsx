import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { formatDuration } from "@shared/physiology";
import type { CalendarData } from "@/lib/types";
import { usePrefs, useThresholds, localToday, mondayOf, addDaysStr, fmtDate, SPORTS, sportKey } from "@/lib/vista";
import { PageHeader, Card, Segmented, Skeleton, SportBadge } from "@/components/kit";
import { WorkoutRow, ActivityRow } from "@/components/training";
import { IOSFeedbackManager } from "@/lib/ios-utils";

type View = "week" | "month";

export default function CalendarPage() {
  const today = localToday();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(mondayOf(today));
  const [monthAnchor, setMonthAnchor] = useState(today.slice(0, 7));
  const [, navigate] = useLocation();

  return (
    <div className="page">
      <PageHeader
        title="Calendar"
        right={
          <button type="button" onClick={() => navigate("/log")} className="press mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-ink-1" aria-label="Log activity">
            <Plus size={18} />
          </button>
        }
      />
      <div className="mb-3">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
      </div>
      {view === "week" ? (
        <WeekView anchor={anchor} setAnchor={setAnchor} today={today} />
      ) : (
        <MonthView
          month={monthAnchor}
          setMonth={setMonthAnchor}
          today={today}
          onPickDay={(d) => {
            setAnchor(mondayOf(d));
            setView("week");
          }}
        />
      )}
    </div>
  );
}

function WeekView({ anchor, setAnchor, today }: { anchor: string; setAnchor: (s: string) => void; today: string }) {
  const prefs = usePrefs();
  const { data: th } = useThresholds();
  const end = addDaysStr(anchor, 6);
  const { data, isLoading } = useQuery<CalendarData>({ queryKey: ["/api/calendar", { start: anchor, end }] });
  const week = data?.weeks[0];
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(anchor, i));
  const nav = (n: number) => {
    void IOSFeedbackManager.lightImpact();
    setAnchor(addDaysStr(anchor, n * 7));
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => nav(-1)} className="press rounded-full p-2 text-ink-2" aria-label="Previous week">
          <ChevronLeft size={20} />
        </button>
        <button type="button" onClick={() => setAnchor(mondayOf(today))} className="text-center">
          <div className="text-[15px] font-semibold text-ink-1">
            {fmtDate(anchor, { month: "short", day: "numeric" })} – {fmtDate(end, { month: "short", day: "numeric" })}
          </div>
          {anchor !== mondayOf(today) && <div className="text-[11px] text-primary">Back to this week</div>}
        </button>
        <button type="button" onClick={() => nav(1)} className="press rounded-full p-2 text-ink-2" aria-label="Next week">
          <ChevronRight size={20} />
        </button>
      </div>

      {week && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <div className="eyebrow">Completed</div>
              <div className="num text-[22px] font-semibold text-ink-1">{formatDuration(week.totalSec)}</div>
            </div>
            <div className="text-right">
              <div className="eyebrow">Planned</div>
              <div className="num text-[22px] font-semibold text-ink-3">{formatDuration(week.planned.sec)}</div>
            </div>
          </div>
          <div className="flex gap-2">
            {(["swim", "bike", "run"] as const).map((s) => (
              <div key={s} className="flex flex-1 items-center gap-2 rounded-xl bg-white/[0.05] px-2.5 py-2">
                <span className="h-2 w-2 rounded-full" style={{ background: SPORTS[s].color }} />
                <span className="num text-[13px] font-semibold text-ink-1">{formatDuration(week.sports[s].sec)}</span>
              </div>
            ))}
          </div>
          <div className="num mt-2 text-[12px] text-ink-3">
            {Math.round(week.totalTss)} of {Math.round(week.planned.tss)} planned TSS · {week.planned.completed}/{week.planned.count} sessions
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((d) => {
            const planned = data?.workouts.filter((w) => w.date === d) ?? [];
            const acts = data?.activities.filter((a) => a.date === d && !planned.some((p) => p.completedRunId === a.id)) ?? [];
            const isToday = d === today;
            return (
              <div key={d}>
                <div className={`mb-1.5 flex items-center gap-2 px-1 text-[13px] font-semibold ${isToday ? "text-primary" : "text-ink-2"}`}>
                  {fmtDate(d, { weekday: "long", month: "short", day: "numeric" })}
                  {isToday && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-wide">Today</span>}
                </div>
                {planned.length || acts.length ? (
                  <div className="space-y-2">
                    {planned.map((w) => (
                      <WorkoutRow key={w.id} w={w} thresholds={th?.values ?? {}} prefs={prefs} showProfile={d >= today && !w.isCompleted} />
                    ))}
                    {acts.map((a) => (
                      <ActivityRow key={a.id} r={a} prefs={prefs} showDate={false} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-3 text-[13px] text-ink-3">Rest</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function MonthView({ month, setMonth, today, onPickDay }: { month: string; setMonth: (m: string) => void; today: string; onPickDay: (d: string) => void }) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(daysIn).padStart(2, "0")}`;
  const gridStart = mondayOf(first);
  const gridEnd = addDaysStr(mondayOf(last), 6);
  const { data } = useQuery<CalendarData>({ queryKey: ["/api/calendar", { start: gridStart, end: gridEnd }] });
  const cells = useMemo(() => {
    const out: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDaysStr(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthTotals = useMemo(() => {
    const acts = data?.activities.filter((a) => a.date.startsWith(month)) ?? [];
    const out = { swim: 0, bike: 0, run: 0 } as Record<"swim" | "bike" | "run", number>;
    for (const a of acts) {
      const s = sportKey(a.sportType);
      if (s) out[s] += a.movingTimeSec ?? a.timeHours * 3600 + a.timeMinutes * 60;
    }
    return out;
  }, [data, month]);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} className="press rounded-full p-2 text-ink-2" aria-label="Previous month">
          <ChevronLeft size={20} />
        </button>
        <div className="text-[15px] font-semibold text-ink-1">{new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
        <button type="button" onClick={() => shift(1)} className="press rounded-full p-2 text-ink-2" aria-label="Next month">
          <ChevronRight size={20} />
        </button>
      </div>
      <Card className="p-3">
        <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-ink-3">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const inMonth = d.startsWith(month);
            const acts = data?.activities.filter((a) => a.date === d) ?? [];
            const planned = data?.workouts.filter((w) => w.date === d && !w.isCompleted && w.status !== "skipped") ?? [];
            const sports = Array.from(new Set(acts.map((a) => sportKey(a.sportType)).filter(Boolean))) as ("swim" | "bike" | "run")[];
            const plannedSports = Array.from(new Set(planned.map((w) => w.sport as "swim" | "bike" | "run")));
            return (
              <button
                key={d}
                type="button"
                onClick={() => onPickDay(d)}
                className={`press flex h-12 flex-col items-center justify-center rounded-xl ${d === today ? "bg-primary/20 ring-1 ring-primary/60" : acts.length ? "bg-white/[0.06]" : ""} ${inMonth ? "" : "opacity-30"}`}
              >
                <span className={`text-[13px] font-semibold ${d === today ? "text-primary" : "text-ink-1"}`}>{Number(d.slice(8))}</span>
                <div className="mt-1 flex h-1.5 gap-0.5">
                  {sports.map((s) => (
                    <span key={s} className="h-1.5 w-1.5 rounded-full" style={{ background: SPORTS[s].color }} />
                  ))}
                  {!sports.length &&
                    plannedSports.map((s) => (
                      <span key={s} className="h-1.5 w-1.5 rounded-full border" style={{ borderColor: SPORTS[s]?.color ?? "#888" }} />
                    ))}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-hairline px-1 pt-3 text-[12px] text-ink-2">
          {(["swim", "bike", "run"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <SportBadge sport={s} size={22} />
              <span className="num font-semibold text-ink-1">{formatDuration(monthTotals[s])}</span>
            </span>
          ))}
        </div>
        <div className="mt-2 px-1 text-[11px] text-ink-3">Filled dot = completed · ring = planned</div>
      </Card>
    </>
  );
}
