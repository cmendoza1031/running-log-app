import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { RefreshCw, Flag, Moon, Plus, ChevronRight, Zap } from "lucide-react";
import { formatDuration, formatClock, formatRunPace, formatSwimPace, THRESHOLD_LABELS, type ThresholdMetric } from "@shared/physiology";
import type { Dashboard } from "@/lib/types";
import { signed, usePrefs, useProfile, relativeDay, addDaysStr, timeAgo, SPORTS, PMC_COLORS, fmtDate } from "@/lib/vista";
import { Card, SectionTitle, Stat, Skeleton, EmptyState, Pill, SportBadge } from "@/components/kit";
import { PmcChart } from "@/components/charts";
import { WorkoutRow, ActivityRow, CoachNote, ThresholdSuggestion, formatThreshold } from "@/components/training";
import { useSync } from "@/hooks/use-sync";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const FORM_COLOR: Record<string, string> = {
  fresh: "#30D158",
  neutral: "#A1A1A6",
  productive: "#3A86FF",
  overreaching: "#FF453A",
  detraining: "#FFD60A",
};

export default function Today() {
  const prefs = usePrefs();
  const { data: profile } = useProfile();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<Dashboard>({ queryKey: ["/api/dashboard"] });
  const sync = useSync();

  const firstName = profile?.fullName?.split(" ")[0];
  const todays = useMemo(() => (data ? data.planned.filter((w) => w.date === data.today) : []), [data]);
  const upcoming = useMemo(
    () => (data ? data.planned.filter((w) => w.date > data.today && w.date <= addDaysStr(data.today, 3) && w.status !== "skipped") : []),
    [data],
  );
  const latest = data?.activities.find((a) => a.analysis) ?? null;
  const todayActs = data?.activities.filter((a) => a.date === data.today && !a.planWorkoutId) ?? [];

  if (isLoading || !data) {
    return (
      <div className="page page-top space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const f = data.fitness;
  const weekDone = data.week.totalSec;
  const weekPlanned = data.week.planned.sec;

  return (
    <div className="page" data-testid="today-page">
      <div className="page-top mb-4 flex items-start justify-between">
        <div>
          <div className="text-[13px] font-medium text-ink-3">{fmtDate(data.today, { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink-1">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        {data.strava.connected && (
          <button
            type="button"
            onClick={() => sync.run(true)}
            className="press mt-1 flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-[12px] text-ink-2"
            aria-label="Sync now"
          >
            <RefreshCw size={13} className={sync.syncing ? "animate-spin" : ""} />
            {sync.syncing ? "Syncing" : timeAgo(data.strava.lastSynced)}
          </button>
        )}
      </div>

      {data.race && (
        <Card className="mb-3 flex items-center gap-3 px-4 py-3" onClick={() => navigate("/progress")}>
          <Flag size={18} className="text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold text-ink-1">{data.race.name || data.race.label}</div>
            <div className="text-[12px] text-ink-2">
              {fmtDate(data.race.date, { month: "short", day: "numeric", year: "numeric" })}
              {data.race.pacing?.totalSec ? ` · predicted ${formatClock(data.race.pacing.totalSec)}` : ""}
              {!data.race.pacing?.totalSec && data.race.pacing?.run ? ` · predicted ${formatClock(data.race.pacing.run.timeSec)}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="num text-[22px] font-bold leading-none text-ink-1">{data.race.daysOut}</div>
            <div className="text-[11px] text-ink-3">days</div>
          </div>
        </Card>
      )}

      {!data.strava.connected && (
        <Card className="mb-3 p-4" onClick={() => navigate("/profile")}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FC4C02]">
              <Zap size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-ink-1">Connect Strava</div>
              <div className="text-[12px] text-ink-2">Auto-import from Garmin, COROS, Wahoo & Apple Watch</div>
            </div>
            <ChevronRight size={16} className="text-ink-3" />
          </div>
        </Card>
      )}

      {data.thresholdSuggestions.map((s) => (
        <div key={s.id} className="mb-3">
          <ThresholdSuggestion row={s} prefs={prefs} current={(data.thresholds as Record<string, number | null>)[metricKey(s.metric)] ?? null} />
        </div>
      ))}

      {/* Today */}
      <SectionTitle>
        Today
        {data.planWeek && <span className="ml-2 text-[12px] font-medium capitalize text-ink-3">{data.planWeek.phase} · week {data.planWeek.index + 1}</span>}
      </SectionTitle>
      <div className="space-y-2">
        {todays.map((w) => (
          <WorkoutRow key={w.id} w={w} thresholds={data.thresholds} prefs={prefs} showProfile />
        ))}
        {todayActs.map((a) => (
          <ActivityRow key={a.id} r={a} prefs={prefs} showDate={false} />
        ))}
        {!todays.length && !todayActs.length && (
          <Card className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
              <Moon size={18} className="text-ink-2" />
            </div>
            <div className="flex-1">
              <div className="text-[15px] font-semibold text-ink-1">{data.plan ? "Rest day" : "No plan yet"}</div>
              <div className="text-[12px] text-ink-2">{data.plan ? "Recovery is where adaptation happens." : "Ask your coach to build one — it takes a minute."}</div>
            </div>
            {!data.plan && (
              <button type="button" onClick={() => navigate("/coach?prompt=plan")} className="press rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-white">
                Build plan
              </button>
            )}
          </Card>
        )}
      </div>

      {latest?.analysis && (
        <>
          <SectionTitle
            action={
              <button type="button" className="text-[13px] font-medium text-primary" onClick={() => navigate(`/activity/${latest.id}`)}>
                {relativeDay(latest.date, data.today)} · {latest.title}
              </button>
            }
          >
            Latest session
          </SectionTitle>
          <CoachNote analysis={latest.analysis} activityId={latest.id} compact />
        </>
      )}

      {/* Form */}
      <SectionTitle
        action={
          <button type="button" className="text-[13px] font-medium text-primary" onClick={() => navigate("/progress")}>
            Trends
          </button>
        }
      >
        Fitness & form
      </SectionTitle>
      <Card className="p-4">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Stat label="Fitness" value={Math.round(f.ctl)} color={PMC_COLORS.ctl} sub={f.rampRate != null ? `${f.rampRate > 0 ? "+" : ""}${f.rampRate}/wk` : undefined} />
          <Stat label="Fatigue" value={Math.round(f.atl)} color={PMC_COLORS.atl} />
          <Stat label="Form" value={signed(f.tsb)} color={PMC_COLORS.tsb} sub={<span style={{ color: FORM_COLOR[f.form.state] }}>{f.form.label}</span>} />
        </div>
        <PmcChart series={f.series} height={140} />
        <div className="mt-2 text-[12px] leading-snug text-ink-2">{f.form.advice}</div>
      </Card>

      {/* Week */}
      <SectionTitle
        action={
          <button type="button" className="text-[13px] font-medium text-primary" onClick={() => navigate("/calendar")}>
            Calendar
          </button>
        }
      >
        This week
      </SectionTitle>
      <Card className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <div className="num text-[22px] font-semibold text-ink-1">
            {formatDuration(weekDone)}
            {weekPlanned > 0 && <span className="text-[14px] font-medium text-ink-3"> / {formatDuration(weekPlanned)}</span>}
          </div>
          <div className="text-[12px] text-ink-2">
            {data.week.planned.count > 0 ? `${data.week.planned.completed}/${data.week.planned.count} sessions · ` : ""}
            <span className="num">{Math.round(data.week.totalTss)}</span> TSS
          </div>
        </div>
        <div className="space-y-2.5">
          {(["swim", "bike", "run"] as const).map((s) => {
            const done = data.week.sports[s].sec;
            const planned = data.planned
              .filter((w) => w.sport === s && w.date >= data.week.week && w.date <= addDaysStr(data.week.week, 6))
              .reduce((a, w) => a + (w.plannedDurationSec ?? 0), 0);
            const target = Math.max(planned, done, 1);
            if (!done && !planned) return null;
            return (
              <div key={s} className="flex items-center gap-3">
                <SportBadge sport={s} size={26} />
                <div className="flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (done / target) * 100)}%`, background: SPORTS[s].color }} />
                  </div>
                </div>
                <div className="num w-[92px] text-right text-[12px] text-ink-2">
                  {formatDuration(done)}
                  {planned > 0 && <span className="text-ink-3"> / {formatDuration(planned)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {upcoming.length > 0 && (
        <>
          <SectionTitle>Coming up</SectionTitle>
          <div className="space-y-2">
            {upcoming.map((w) => (
              <div key={w.id}>
                <div className="mb-1 px-1 text-[12px] font-medium text-ink-3">{relativeDay(w.date, data.today)}</div>
                <WorkoutRow w={w} thresholds={data.thresholds} prefs={prefs} />
              </div>
            ))}
          </div>
        </>
      )}

      {data.race?.pacing && (
        <>
          <SectionTitle>Race-day targets</SectionTitle>
          <Card className="p-4">
            <div className="space-y-2.5">
              {data.race.pacing.swim && (
                <PaceRow sport="swim" label={`${formatSwimPace(data.race.pacing.swim.paceSec, prefs.pool)}`} time={data.race.pacing.swim.timeSec} />
              )}
              {data.race.pacing.bike && (
                <PaceRow sport="bike" label={`${data.race.pacing.bike.powerLow}–${data.race.pacing.bike.powerHigh} W`} time={data.race.pacing.bike.timeSec} />
              )}
              {data.race.pacing.run && <PaceRow sport="run" label={formatRunPace(data.race.pacing.run.paceSec, prefs.units)} time={data.race.pacing.run.timeSec} />}
            </div>
            <div className="mt-3 text-[12px] leading-snug text-ink-3">From your current thresholds. These sharpen automatically as your fitness changes.</div>
          </Card>
        </>
      )}

      {data.thresholdUpdates.length > 0 && (
        <>
          <SectionTitle>Recent updates</SectionTitle>
          <Card className="divide-y divide-hairline" onClick={() => navigate("/progress")}>
            {data.thresholdUpdates.slice(0, 4).map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[14px] font-medium text-ink-1">{THRESHOLD_LABELS[u.metric as ThresholdMetric] ?? u.metric}</div>
                  <div className="text-[12px] text-ink-3">Auto-detected {fmtDate(u.effectiveDate, { month: "short", day: "numeric" })}</div>
                </div>
                <div className="num text-[15px] font-semibold text-ink-1">{formatThreshold(u.metric, u.value, prefs)}</div>
              </div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle
        action={
          <button type="button" className="flex items-center gap-1 text-[13px] font-medium text-primary" onClick={() => navigate("/log")}>
            <Plus size={14} /> Log
          </button>
        }
      >
        Recent activity
      </SectionTitle>
      {data.activities.length ? (
        <div className="space-y-2">
          {data.activities.slice(0, 6).map((a) => (
            <ActivityRow key={a.id} r={a} prefs={prefs} />
          ))}
        </div>
      ) : (
        <EmptyState title="No activities yet" body="Connect Strava in Profile, or log a workout manually." />
      )}
      <div className="h-4" />
    </div>
  );
}

function PaceRow({ sport, label, time }: { sport: "swim" | "bike" | "run"; label: string; time: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <SportBadge sport={sport} size={28} />
      <div className="flex-1 text-[14px] font-medium text-ink-1">{label}</div>
      {time ? <Pill>{formatClock(time)}</Pill> : null}
    </div>
  );
}

function metricKey(metric: string): string {
  const map: Record<string, string> = {
    ftp: "ftp",
    run_threshold_pace: "runThresholdPace",
    swim_css: "swimCss",
    lthr_run: "lthrRun",
    lthr_bike: "lthrBike",
    max_hr: "maxHr",
    resting_hr: "restingHr",
    weight_kg: "weightKg",
    vo2max: "vo2max",
  };
  return map[metric] ?? metric;
}

export { metricKey };
