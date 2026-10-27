import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Info } from "lucide-react";
import {
  formatDuration,
  formatClock,
  formatRunPace,
  powerZones,
  runPaceZones,
  swimZones,
  hrZones,
  effectiveLthr,
  vdotFromThresholdPace,
  predictRaceSeconds,
  THRESHOLD_LABELS,
  METERS_PER_MILE,
  type ThresholdMetric,
  type ZoneBand,
  type Sport,
} from "@shared/physiology";
import type { ProgressData, Fitness } from "@/lib/types";
import { apiJson } from "@/lib/queryClient";
import { signed, usePrefs, useProfile, fmtDate, SPORTS, PMC_COLORS, zoneColor, type Prefs, type ThresholdRow } from "@/lib/vista";
import { PageHeader, Card, SectionTitle, Segmented, Stat, Sheet, PrimaryButton, Skeleton, Pill, SportBadge } from "@/components/kit";
import { PmcChart, VolumeChart, IntensityStrip, PowerCurve, Sparkline, Legend } from "@/components/charts";
import { formatThreshold, thresholdDelta, ThresholdSuggestion } from "@/components/training";
import { useToast } from "@/hooks/use-toast";

type Tab = "overview" | Sport;

const RANGE_OPTIONS = [
  { value: "90", label: "3M" },
  { value: "180", label: "6M" },
  { value: "365", label: "1Y" },
];

export default function ProgressPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const prefs = usePrefs();
  const { data, isLoading } = useQuery<ProgressData>({ queryKey: ["/api/progress"] });
  const [sheet, setSheet] = useState<ThresholdMetric | null>(null);

  return (
    <div className="page">
      <PageHeader title="Progress" />
      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "overview", label: "Overview" },
            { value: "swim", label: "Swim" },
            { value: "bike", label: "Bike" },
            { value: "run", label: "Run" },
          ]}
        />
      </div>
      {isLoading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-56" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          {data.suggestions.map((s) => (
            <div key={s.id} className="mb-3">
              <ThresholdSuggestion row={s} prefs={prefs} />
            </div>
          ))}
          {tab === "overview" && <Overview data={data} prefs={prefs} onOpen={setSheet} />}
          {tab === "swim" && <SwimTab data={data} prefs={prefs} onOpen={setSheet} />}
          {tab === "bike" && <BikeTab data={data} prefs={prefs} onOpen={setSheet} />}
          {tab === "run" && <RunTab data={data} prefs={prefs} onOpen={setSheet} />}
          <ThresholdSheet metric={sheet} onClose={() => setSheet(null)} data={data} prefs={prefs} />
        </>
      )}
      <div className="h-6" />
    </div>
  );
}

// ─── Threshold cards ──────────────────────────────────────────────────────────

function historyFor(data: ProgressData, metric: string): ThresholdRow[] {
  return data.thresholdHistory.filter((r) => r.metric === metric);
}

function sourceText(row: ThresholdRow | undefined): string {
  if (!row) return "Not set — tap to add";
  const when = fmtDate(row.effectiveDate, { month: "short", day: "numeric" });
  if (row.source === "auto") return `Auto-detected · ${when}`;
  if (row.source === "test") return `From test · ${when}`;
  return `Set by you · ${when}`;
}

function ThresholdCard({ metric, data, prefs, onOpen, extra }: { metric: ThresholdMetric; data: ProgressData; prefs: Prefs; onOpen: (m: ThresholdMetric) => void; extra?: React.ReactNode }) {
  const row = data.thresholdCurrent[metric];
  const hist = historyFor(data, metric);
  const prev = hist.length > 1 ? hist[hist.length - 2].value : null;
  const delta = row && prev != null ? thresholdDelta(metric, prev, row.value, prefs) : null;
  const improving = row && prev != null ? (metric === "run_threshold_pace" || metric === "swim_css" ? row.value < prev : row.value > prev) : false;
  const spark = hist.map((h) => (metric === "run_threshold_pace" || metric === "swim_css" ? -h.value : h.value));
  return (
    <Card className="p-4" onClick={() => onOpen(metric)}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="eyebrow mb-1">{THRESHOLD_LABELS[metric]}</div>
          <div className="num text-[30px] font-bold leading-none text-ink-1">{row ? formatThreshold(metric, row.value, prefs) : "—"}</div>
          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-2">
            {delta && <span style={{ color: improving ? "#30D158" : "#FF9F0A" }}>{delta}</span>}
            <span className="truncate">{sourceText(row)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {spark.length > 1 && <Sparkline values={spark} color="#3A86FF" width={72} />}
          <span className="flex items-center gap-0.5 text-[12px] font-medium text-primary">
            Zones <ChevronRight size={14} />
          </span>
        </div>
      </div>
      {extra}
    </Card>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({ data, prefs, onOpen }: { data: ProgressData; prefs: Prefs; onOpen: (m: ThresholdMetric) => void }) {
  const { data: profile } = useProfile();
  const [range, setRange] = useState("90");
  const raceDays = profile?.targetRaceDate ? Math.max(0, Math.round((new Date(profile.targetRaceDate).getTime() - Date.now()) / 86_400_000) + 1) : 0;
  const { data: fitness } = useQuery<Fitness>({ queryKey: ["/api/fitness", { days: range, project: Math.min(200, raceDays || 28) }] });
  const volume = data.weeks.map((w) => ({
    week: w.week,
    swim: +(w.sports.swim.sec / 3600).toFixed(2),
    bike: +(w.sports.bike.sec / 3600).toFixed(2),
    run: +(w.sports.run.sec / 3600).toFixed(2),
    planned: w.planned.sec / 3600,
  }));
  const raceDayPoint = fitness?.series.find((p) => p.date === profile?.targetRaceDate);
  const avgHours = volume.slice(-4).reduce((a, w) => a + w.swim + w.bike + w.run, 0) / 4;

  return (
    <>
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="eyebrow">Fitness · Fatigue · Form</div>
          <div className="w-[132px]">
            <Segmented value={range} onChange={setRange} options={RANGE_OPTIONS} />
          </div>
        </div>
        {fitness ? (
          <>
            <div className="mb-3 grid grid-cols-3 gap-3">
              <Stat label="Fitness" value={Math.round(fitness.ctl)} color={PMC_COLORS.ctl} sub={fitness.rampRate != null ? `${fitness.rampRate > 0 ? "+" : ""}${fitness.rampRate} / week` : undefined} />
              <Stat label="Fatigue" value={Math.round(fitness.atl)} color={PMC_COLORS.atl} />
              <Stat label="Form" value={signed(fitness.tsb)} color={PMC_COLORS.tsb} sub={fitness.form.label} />
            </div>
            <PmcChart series={fitness.series} height={190} />
            <div className="mt-2">
              <Legend
                items={[
                  { color: PMC_COLORS.ctl, label: "Fitness (CTL)" },
                  { color: PMC_COLORS.atl, label: "Fatigue (ATL)" },
                  { color: PMC_COLORS.tsb, label: "Form (TSB)" },
                ]}
              />
            </div>
            {raceDayPoint && (
              <div className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2.5 text-[13px] leading-snug text-ink-2">
                If you follow the plan: race-day fitness <span className="num font-semibold text-ink-1">{Math.round(raceDayPoint.ctl)}</span>, form{" "}
                <span className="num font-semibold text-ink-1">
                  {signed(raceDayPoint.tsb)}
                </span>{" "}
                {raceDayPoint.tsb >= 5 ? "— fresh and ready." : "— the taper should lift this further."}
              </div>
            )}
            <details className="mt-3 text-[12px] leading-relaxed text-ink-3">
              <summary className="flex cursor-pointer items-center gap-1 text-ink-2">
                <Info size={12} /> What do these mean?
              </summary>
              <p className="mt-1">
                <b className="text-ink-2">Fitness</b> is your 6-week average training load; it rises slowly with consistent work. <b className="text-ink-2">Fatigue</b> is your 1-week average — it
                spikes after hard days. <b className="text-ink-2">Form</b> = fitness − fatigue: negative while building, positive when fresh. Aim to arrive at races with form around +5 to +20. Dashed
                lines are projections from your planned workouts.
              </p>
            </details>
          </>
        ) : (
          <Skeleton className="h-52" />
        )}
      </Card>

      <SectionTitle>Weekly volume</SectionTitle>
      <Card className="p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="num text-[20px] font-semibold text-ink-1">{formatDuration(avgHours * 3600)}</span>
          <span className="text-[12px] text-ink-3">avg last 4 weeks</span>
        </div>
        <VolumeChart data={volume} />
        <div className="mt-2">
          <Legend items={(["swim", "bike", "run"] as const).map((s) => ({ color: SPORTS[s].color, label: SPORTS[s].label }))} />
        </div>
      </Card>

      <SectionTitle>Intensity balance · 4 weeks</SectionTitle>
      <Card className="p-4">
        <IntensityStrip {...data.intensity.all} />
        <p className="mt-3 text-[12px] leading-snug text-ink-3">
          {data.intensity.all.low >= 0.75
            ? "Great polarization — most of your time is easy, which lets the hard sessions count."
            : "Target ~80% low intensity. Too much moderate work builds fatigue faster than fitness — slow the easy days down."}
        </p>
      </Card>

      <SectionTitle>Thresholds</SectionTitle>
      <div className="grid grid-cols-1 gap-2">
        <ThresholdCard metric="ftp" data={data} prefs={prefs} onOpen={onOpen} />
        <ThresholdCard metric="run_threshold_pace" data={data} prefs={prefs} onOpen={onOpen} />
        <ThresholdCard metric="swim_css" data={data} prefs={prefs} onOpen={onOpen} />
      </div>

      <SectionTitle>Fitness by sport</SectionTitle>
      <SportFitness />
    </>
  );
}

function SportFitness() {
  const { data } = useQuery<Fitness>({ queryKey: ["/api/fitness", { days: 7, project: 0 }] });
  if (!data) return <Skeleton className="h-20" />;
  const max = Math.max(1, ...Object.values(data.bySport).map((s) => s.ctl));
  return (
    <Card className="space-y-3 p-4">
      {(["swim", "bike", "run"] as const).map((s) => (
        <div key={s} className="flex items-center gap-3">
          <SportBadge sport={s} size={28} />
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full" style={{ width: `${(data.bySport[s].ctl / max) * 100}%`, background: SPORTS[s].color }} />
          </div>
          <span className="num w-10 text-right text-[14px] font-semibold text-ink-1">{Math.round(data.bySport[s].ctl)}</span>
        </div>
      ))}
    </Card>
  );
}

// ─── Sport tabs ───────────────────────────────────────────────────────────────

function SportVolume({ data, sport }: { data: ProgressData; sport: Sport }) {
  const volume = data.weeks.map((w) => ({ week: w.week, swim: 0, bike: 0, run: 0, [sport]: +(w.sports[sport].sec / 3600).toFixed(2) }));
  const last4 = data.weeks.slice(-4);
  const meters = last4.reduce((a, w) => a + w.sports[sport].meters, 0) / 4;
  return (
    <>
      <SectionTitle>Weekly {SPORTS[sport].label.toLowerCase()} volume</SectionTitle>
      <Card className="p-4">
        <div className="num mb-2 text-[13px] text-ink-2">
          Avg {formatDuration(last4.reduce((a, w) => a + w.sports[sport].sec, 0) / 4)} ·{" "}
          {sport === "swim" ? `${Math.round(meters / (0.9144)).toLocaleString()} yd` : sport === "bike" ? `${Math.round(meters / 1609.344)} mi` : `${(meters / 1609.344).toFixed(1)} mi`} per week
        </div>
        <VolumeChart data={volume} sports={[sport]} height={130} />
      </Card>
      <SectionTitle>Intensity · 4 weeks</SectionTitle>
      <Card className="p-4">
        <IntensityStrip {...data.intensity[sport]} />
      </Card>
    </>
  );
}

function SwimTab({ data, prefs, onOpen }: { data: ProgressData; prefs: Prefs; onOpen: (m: ThresholdMetric) => void }) {
  return (
    <>
      <ThresholdCard metric="swim_css" data={data} prefs={prefs} onOpen={onOpen} />
      <p className="mt-2 px-1 text-[12px] leading-snug text-ink-3">
        CSS (Critical Swim Speed) is the pace you could hold for ~30 minutes — your swimming threshold. Test it with a 400 and a 200 time trial; tap the card to enter them.
      </p>
      <SportVolume data={data} sport="swim" />
    </>
  );
}

function BikeTab({ data, prefs, onOpen }: { data: ProgressData; prefs: Prefs; onOpen: (m: ThresholdMetric) => void }) {
  const w = data.thresholds.weightKg;
  const ftp = data.thresholds.ftp;
  const efBike = data.efTrend.filter((e) => e.sport === "bike");
  return (
    <>
      <ThresholdCard
        metric="ftp"
        data={data}
        prefs={prefs}
        onOpen={onOpen}
        extra={
          ftp && w ? (
            <div className="mt-3 flex gap-2">
              <Pill color="#64a8ff">{(ftp / w).toFixed(2)} W/kg</Pill>
            </div>
          ) : null
        }
      />
      {Object.keys(data.bests90.bike).length > 1 && (
        <>
          <SectionTitle>Power curve</SectionTitle>
          <Card className="p-4">
            <PowerCurve recent={data.bests90.bike} year={data.bests365.bike} />
            <div className="mt-2">
              <Legend
                items={[
                  { color: SPORTS.bike.color, label: "Last 90 days" },
                  { color: "#8E8E93", label: "Last 12 months" },
                ]}
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {["5", "60", "300", "1200"].map((s) =>
                data.bests90.bike[s] ? (
                  <div key={s} className="rounded-xl bg-white/[0.05] px-2 py-2 text-center">
                    <div className="num text-[15px] font-semibold text-ink-1">{data.bests90.bike[s]}</div>
                    <div className="text-[10px] text-ink-3">{+s < 60 ? `${s}s` : `${+s / 60}min`}</div>
                  </div>
                ) : null,
              )}
            </div>
          </Card>
        </>
      )}
      {efBike.length > 2 && <EfCard points={efBike} label="Efficiency factor (NP ÷ HR)" />}
      <SportVolume data={data} sport="bike" />
    </>
  );
}

function RunTab({ data, prefs, onOpen }: { data: ProgressData; prefs: Prefs; onOpen: (m: ThresholdMetric) => void }) {
  const tp = data.thresholds.runThresholdPace;
  const vdot = tp ? vdotFromThresholdPace(tp) : null;
  const efRun = data.efTrend.filter((e) => e.sport === "run");
  const bestNames: Record<string, string> = { "1000": "1K", "1609": "Mile", "5000": "5K", "10000": "10K", "21097": "Half" };
  return (
    <>
      <ThresholdCard
        metric="run_threshold_pace"
        data={data}
        prefs={prefs}
        onOpen={onOpen}
        extra={
          vdot ? (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2.5">
              <div>
                <div className="eyebrow">VO2max (VDOT)</div>
                <div className="num text-[20px] font-semibold text-ink-1">{vdot.toFixed(1)}</div>
              </div>
              <div className="text-right text-[12px] text-ink-3">Running-specific aerobic capacity</div>
            </div>
          ) : null
        }
      />
      {vdot && (
        <>
          <SectionTitle>Race predictions</SectionTitle>
          <Card className="grid grid-cols-2 gap-3 p-4">
            {[
              ["5K", 5000],
              ["10K", 10000],
              ["Half", 21097.5],
              ["Marathon", 42195],
            ].map(([l, m]) => {
              const t = predictRaceSeconds(vdot, m as number);
              return (
                <Stat
                  key={l as string}
                  label={l as string}
                  value={formatClock(t)}
                  sub={formatRunPace(t / ((m as number) / 1000), prefs.units)}
                />
              );
            })}
            <div className="col-span-2 text-[12px] leading-snug text-ink-3">Open-race predictions when fresh and tapered (Daniels VDOT).</div>
          </Card>
        </>
      )}
      {Object.keys(data.bests90.run).length > 0 && (
        <>
          <SectionTitle>Best efforts · 90 days</SectionTitle>
          <Card className="divide-y divide-hairline">
            {Object.entries(data.bests90.run)
              .filter(([m]) => bestNames[m])
              .map(([m, s]) => (
                <div key={m} className="flex items-center justify-between px-4 py-3">
                  <span className="text-[14px] text-ink-1">{bestNames[m]}</span>
                  <span className="num text-[14px] font-semibold text-ink-1">
                    {formatClock(s)} <span className="font-normal text-ink-3">· {formatRunPace(s / (Number(m) / 1000), prefs.units)}</span>
                  </span>
                </div>
              ))}
          </Card>
        </>
      )}
      {efRun.length > 2 && <EfCard points={efRun} label="Efficiency factor (speed ÷ HR)" />}
      <SportVolume data={data} sport="run" />
    </>
  );
}

function EfCard({ points, label }: { points: { date: string; ef: number; decoupling: number | null }[]; label: string }) {
  const first = points.slice(0, 5).reduce((a, p) => a + p.ef, 0) / Math.min(5, points.length);
  const last = points.slice(-5).reduce((a, p) => a + p.ef, 0) / Math.min(5, points.length);
  const change = ((last - first) / first) * 100;
  const dec = points.filter((p) => p.decoupling != null).slice(-5);
  return (
    <>
      <SectionTitle>Aerobic efficiency</SectionTitle>
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <Stat label={label} value={last.toFixed(2)} sub={<span style={{ color: change >= 0 ? "#30D158" : "#FF9F0A" }}>{`${change >= 0 ? "+" : ""}${change.toFixed(1)}% over 4 months`}</span>} />
          <Sparkline values={points.map((p) => p.ef)} color="#3A86FF" width={100} height={36} />
        </div>
        {dec.length > 0 && (
          <div className="mt-3 text-[12px] text-ink-2">
            Recent decoupling on long sessions: <span className="num font-semibold text-ink-1">{dec.map((d) => `${d.decoupling}%`).join(" · ")}</span>
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Zones + edit sheet ───────────────────────────────────────────────────────

function ZoneTable({ zones }: { zones: ZoneBand[] }) {
  return (
    <div className="space-y-1.5">
      {zones.map((z) => (
        <div key={z.zone} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
          <div className="h-8 w-1.5 rounded-full" style={{ background: zoneColor(z.zone) }} />
          <div className="w-7 text-[13px] font-bold text-ink-1">Z{z.zone}</div>
          <div className="flex-1 text-[13px] text-ink-2">{z.name}</div>
          <div className="num text-right text-[13px] font-semibold text-ink-1">{z.label}</div>
        </div>
      ))}
    </div>
  );
}

function ThresholdSheet({ metric, onClose, data, prefs }: { metric: ThresholdMetric | null; onClose: () => void; data: ProgressData; prefs: Prefs }) {
  const th = data.thresholds;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [t400, setT400] = useState("");
  const [t200, setT200] = useState("");
  const [raceDist, setRaceDist] = useState("5000");
  const [raceTime, setRaceTime] = useState("");
  const [hrTab, setHrTab] = useState<"pace" | "hr">("pace");

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiJson("POST", "/api/thresholds", body),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast({ title: "Updated", description: "Every future workout now uses the new targets." });
      setValue("");
      setT400("");
      setT200("");
      setRaceTime("");
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const zones = useMemo(() => {
    if (!metric) return null;
    if (metric === "ftp" && th.ftp) return { main: powerZones(th.ftp), hr: effectiveLthr(th, "bike") ? hrZones(effectiveLthr(th, "bike")!, "bike") : null };
    if (metric === "run_threshold_pace" && th.runThresholdPace)
      return { main: runPaceZones(th.runThresholdPace, prefs.units), hr: effectiveLthr(th, "run") ? hrZones(effectiveLthr(th, "run")!, "run") : null };
    if (metric === "swim_css" && th.swimCss) return { main: swimZones(th.swimCss, prefs.pool), hr: null };
    return null;
  }, [metric, th, prefs]);

  if (!metric) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const hist = historyFor(data, metric).slice().reverse();

  const input = "w-full rounded-xl bg-white/[0.08] px-4 py-3 text-ink-1 outline-none placeholder:text-ink-3";
  return (
    <Sheet open={!!metric} onClose={onClose} title={THRESHOLD_LABELS[metric]}>
      {zones ? (
        <>
          {zones.hr && (
            <div className="mb-3">
              <Segmented
                value={hrTab}
                onChange={setHrTab}
                options={[
                  { value: "pace", label: metric === "ftp" ? "Power" : "Pace" },
                  { value: "hr", label: "Heart rate" },
                ]}
              />
            </div>
          )}
          <ZoneTable zones={hrTab === "hr" && zones.hr ? zones.hr : zones.main} />
        </>
      ) : (
        <p className="mb-2 text-[14px] text-ink-2">Set a value to see your zones.</p>
      )}

      <div className="mt-5 eyebrow mb-2">Update</div>
      {metric === "ftp" && (
        <div className="flex gap-2">
          <input className={input} inputMode="numeric" placeholder="FTP in watts" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} />
          <PrimaryButton onClick={() => save.mutate({ ftp: Number(value) })} disabled={!value || save.isPending}>
            Save
          </PrimaryButton>
        </div>
      )}
      {metric === "run_threshold_pace" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={input} placeholder={`Threshold pace, e.g. ${prefs.units === "imperial" ? "7:15" : "4:30"}`} value={value} onChange={(e) => setValue(e.target.value)} />
            <PrimaryButton onClick={() => save.mutate({ runThresholdPace: `${value}/${prefs.units === "imperial" ? "mi" : "km"}` })} disabled={!/^\d{1,2}:\d{2}$/.test(value) || save.isPending}>
              Save
            </PrimaryButton>
          </div>
          <div className="pt-2 text-[12px] text-ink-3">…or from a recent race / time trial:</div>
          <div className="flex gap-2">
            <select className={`${input} w-28`} value={raceDist} onChange={(e) => setRaceDist(e.target.value)}>
              <option value="5000">5K</option>
              <option value="10000">10K</option>
              <option value={String(METERS_PER_MILE)}>1 mile</option>
              <option value="21097.5">Half</option>
              <option value="42195">Marathon</option>
            </select>
            <input className={input} placeholder="Time, e.g. 21:30" value={raceTime} onChange={(e) => setRaceTime(e.target.value)} />
          </div>
          <PrimaryButton
            className="w-full"
            variant="secondary"
            onClick={() => save.mutate({ recentRace: { distanceMeters: Number(raceDist), time: raceTime } })}
            disabled={!/^\d{1,2}(:\d{2}){1,2}$/.test(raceTime) || save.isPending}
          >
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : "Calculate from race"}
          </PrimaryButton>
        </div>
      )}
      {metric === "swim_css" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={input} placeholder={`CSS per 100${prefs.pool === "yards" ? "yd" : "m"}, e.g. 1:45`} value={value} onChange={(e) => setValue(e.target.value)} />
            <PrimaryButton onClick={() => save.mutate({ swimCss: `${value}/${prefs.pool === "yards" ? "100yd" : "100m"}` })} disabled={!/^\d{1,2}:\d{2}$/.test(value) || save.isPending}>
              Save
            </PrimaryButton>
          </div>
          <div className="pt-2 text-[12px] text-ink-3">…or from a CSS test (all-out 400, rest, all-out 200):</div>
          <div className="flex gap-2">
            <input className={input} placeholder="400 time" value={t400} onChange={(e) => setT400(e.target.value)} />
            <input className={input} placeholder="200 time" value={t200} onChange={(e) => setT200(e.target.value)} />
          </div>
          <PrimaryButton className="w-full" variant="secondary" onClick={() => save.mutate({ cssTest: { t400, t200 } })} disabled={!t400 || !t200 || save.isPending}>
            Calculate CSS
          </PrimaryButton>
        </div>
      )}
      {["lthr_run", "lthr_bike", "max_hr", "resting_hr"].includes(metric) && (
        <div className="flex gap-2">
          <input className={input} inputMode="numeric" placeholder="bpm" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} />
          <PrimaryButton
            onClick={() =>
              save.mutate({ [({ lthr_run: "lthrRun", lthr_bike: "lthrBike", max_hr: "maxHr", resting_hr: "restingHr" } as Record<string, string>)[metric]]: Number(value) })
            }
            disabled={!value || save.isPending}
          >
            Save
          </PrimaryButton>
        </div>
      )}

      {hist.length > 0 && (
        <>
          <div className="mt-5 eyebrow mb-2">History</div>
          <div className="divide-y divide-hairline rounded-xl bg-white/[0.04]">
            {hist.slice(0, 8).map((h) => (
              <div key={h.id} className="flex items-center justify-between px-3 py-2.5 text-[13px]">
                <div>
                  <div className="text-ink-1">{fmtDate(h.effectiveDate, { month: "short", day: "numeric", year: "numeric" })}</div>
                  {h.note && <div className="text-[11px] text-ink-3">{h.note}</div>}
                </div>
                <span className="num font-semibold text-ink-1">{formatThreshold(metric, h.value, prefs)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

export { ThresholdSheet };
