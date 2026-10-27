import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, Zap, Sparkles } from "lucide-react";
import type { Profile, TrainingDay } from "@shared/schema";
import { RACES, METERS_PER_MILE, type RaceType } from "@shared/physiology";
import { apiJson } from "@/lib/queryClient";
import { SportBadge, PrimaryButton, Segmented, ClockInput, isValidClock } from "@/components/kit";
import { WeeklySchedulePicker } from "@/components/weekly-schedule-picker";
import { connectStravaFlow, type StravaConnectPhase } from "@/lib/strava-oauth";
import { formatThreshold } from "@/components/training";
import { localToday, type ThresholdState } from "@/lib/vista";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { useToast } from "@/hooks/use-toast";

type Discipline = "tri" | "run" | "bike" | "swim";
const STORAGE_KEY = "vista.onboarding";

interface State {
  step: number;
  name: string;
  discipline: Discipline;
  race: RaceType;
  raceDate: string;
  raceName: string;
  level: string;
  hours: number;
  limiter: string;
  schedule: TrainingDay[];
  units: "imperial" | "metric";
  pool: "yards" | "meters";
}

const DEFAULT_SCHEDULE: TrainingDay[] = [
  { day: 1, maxMinutes: 60, isLongDay: false },
  { day: 2, maxMinutes: 90, isLongDay: false },
  { day: 3, maxMinutes: 90, isLongDay: false },
  { day: 4, maxMinutes: 90, isLongDay: false },
  { day: 6, maxMinutes: 180, isLongDay: true },
  { day: 0, maxMinutes: 120, isLongDay: false },
];

const RACES_BY_DISCIPLINE: Record<Discipline, RaceType[]> = {
  tri: ["tri_full", "tri_703", "tri_olympic", "tri_sprint"],
  run: ["run_marathon", "run_half", "run_10k", "run_5k"],
  bike: ["bike_event"],
  swim: ["swim_event"],
};

const STEPS = ["Sport", "Goal", "You", "Schedule", "Connect", "Thresholds", "Plan"];
const HOURS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20];

function loadState(profile: Profile | null | undefined): State {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* ignore */
  }
  const usLocale = (navigator.language || "en-US").startsWith("en-US");
  return {
    step: 0,
    name: profile?.fullName ?? "",
    discipline: "tri",
    race: "tri_703",
    raceDate: "",
    raceName: "",
    level: profile?.fitnessLevel ?? "intermediate",
    hours: 8,
    limiter: "none",
    schedule: DEFAULT_SCHEDULE,
    units: usLocale ? "imperial" : "metric",
    pool: usLocale ? "yards" : "meters",
  };
}

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: profile } = useQuery<Profile | null>({ queryKey: ["/api/profile"] });
  const [s, setS] = useState<State>(() => loadState(profile));
  const [building, setBuilding] = useState(false);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);

  const go = (d: number) => {
    void IOSFeedbackManager.lightImpact();
    set({ step: Math.max(0, Math.min(STEPS.length - 1, s.step + d)) });
  };

  const saveProfile = async (extra: Partial<Profile> = {}) => {
    const sports = s.discipline === "tri" ? ["triathlon"] : [s.discipline === "run" ? "running" : s.discipline === "bike" ? "cycling" : "swimming"];
    await apiJson("PUT", "/api/profile", {
      fullName: s.name || undefined,
      sports,
      primarySport: sports[0],
      goalRaceType: s.race,
      targetRaceDate: s.race === "general" ? null : s.raceDate || null,
      targetRace: s.race === "general" ? null : s.raceName || RACES[s.race].label,
      fitnessLevel: s.level,
      weeklyHoursGoal: String(s.hours),
      weeklyHoursBucket: s.hours < 5 ? "under_5" : s.hours < 10 ? "five_to_ten" : s.hours < 15 ? "ten_to_fifteen" : "fifteen_plus",
      weeklySchedule: s.schedule,
      limiter: s.limiter === "none" ? null : s.limiter,
      unitSystem: s.units,
      poolUnit: s.pool,
      ...extra,
    });
  };

  const finish = async () => {
    setBuilding(true);
    try {
      await saveProfile();
      await apiJson("POST", "/api/plan", {});
      await saveProfile({ onboardingComplete: true });
      sessionStorage.removeItem(STORAGE_KEY);
      void IOSFeedbackManager.successNotification();
      await qc.invalidateQueries();
      onComplete();
    } catch (e) {
      toast({ title: "Couldn't build your plan", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBuilding(false);
    }
  };

  const raceValid = s.race === "general" || (s.raceDate && s.raceDate > localToday());
  const canNext = [true, raceValid, true, s.schedule.length >= 2, true, true, true][s.step];

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className="page-top shrink-0 px-5">
        <div className="mb-4 flex items-center gap-3">
          {s.step > 0 ? (
            <button type="button" onClick={() => go(-1)} className="press -ml-1 rounded-full p-1.5 text-ink-2" aria-label="Back">
              <ArrowLeft size={20} />
            </button>
          ) : (
            <div className="h-8 w-8" />
          )}
          <div className="flex flex-1 gap-1">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full ${i <= s.step ? "bg-primary" : "bg-white/[0.1]"}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <AnimatePresence mode="wait">
          <motion.div key={s.step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
            {s.step === 0 && <StepSport s={s} set={set} />}
            {s.step === 1 && <StepGoal s={s} set={set} />}
            {s.step === 2 && <StepYou s={s} set={set} />}
            {s.step === 3 && <StepSchedule s={s} set={set} />}
            {s.step === 4 && <StepConnect onBeforeConnect={() => saveProfile()} />}
            {s.step === 5 && <StepThresholds s={s} beforeSave={() => saveProfile()} />}
            {s.step === 6 && <StepPlan s={s} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2">
        {s.step < STEPS.length - 1 ? (
          <PrimaryButton className="w-full" onClick={() => go(1)} disabled={!canNext}>
            Continue
          </PrimaryButton>
        ) : (
          <PrimaryButton className="w-full" onClick={() => void finish()} disabled={building}>
            {building ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Building your plan…
              </>
            ) : (
              <>
                <Sparkles size={16} /> Build my plan
              </>
            )}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink-1">{children}</h1>
      {sub && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{sub}</p>}
    </div>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        void IOSFeedbackManager.lightImpact();
        onClick();
      }}
      className={`press flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors ${
        selected ? "border-primary/70 bg-primary/10" : "border-hairline bg-[#0d0d0f]"
      }`}
    >
      {children}
      <div className={`ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? "bg-primary" : "border border-white/20"}`}>{selected && <Check size={13} className="text-white" />}</div>
    </button>
  );
}

type StepProps = { s: State; set: (p: Partial<State>) => void };

function StepSport({ s, set }: StepProps) {
  const opts: { id: Discipline; label: string; sub: string; badges: string[] }[] = [
    { id: "tri", label: "Triathlon", sub: "Sprint to Ironman", badges: ["swim", "bike", "run"] },
    { id: "run", label: "Running", sub: "5K to marathon", badges: ["run"] },
    { id: "bike", label: "Cycling", sub: "Road, gravel, indoor", badges: ["bike"] },
    { id: "swim", label: "Swimming", sub: "Pool & open water", badges: ["swim"] },
  ];
  return (
    <>
      <Title sub="Your coach, plan and analytics adapt to what you train for.">What do you train for?</Title>
      <input
        value={s.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Your first name"
        className="mb-4 w-full rounded-2xl border border-hairline bg-[#0d0d0f] px-4 py-3.5 text-ink-1 outline-none placeholder:text-ink-3"
      />
      <div className="space-y-2">
        {opts.map((o) => (
          <Choice key={o.id} selected={s.discipline === o.id} onClick={() => set({ discipline: o.id, race: RACES_BY_DISCIPLINE[o.id][o.id === "tri" ? 1 : 0] })}>
            <div className="flex -space-x-1.5">
              {o.badges.map((b) => (
                <SportBadge key={b} sport={b} size={32} className="ring-2 ring-black" />
              ))}
            </div>
            <div>
              <div className="text-[16px] font-semibold text-ink-1">{o.label}</div>
              <div className="text-[13px] text-ink-3">{o.sub}</div>
            </div>
          </Choice>
        ))}
      </div>
    </>
  );
}

function StepGoal({ s, set }: StepProps) {
  const options = [...RACES_BY_DISCIPLINE[s.discipline], "general" as RaceType];
  const input = "w-full rounded-2xl border border-hairline bg-[#0d0d0f] px-4 py-3.5 text-ink-1 outline-none placeholder:text-ink-3";
  return (
    <>
      <Title sub="Plans are periodized backward from race day — base, build, peak, taper.">What's your goal?</Title>
      <div className="space-y-2">
        {options.map((r) => (
          <Choice key={r} selected={s.race === r} onClick={() => set({ race: r })}>
            <div className="text-[16px] font-semibold text-ink-1">{r === "general" ? "No race — get fitter" : r === "bike_event" ? "A cycling event" : r === "swim_event" ? "A swim event" : RACES[r].label}</div>
          </Choice>
        ))}
      </div>
      {s.race !== "general" && (
        <div className="mt-4 space-y-2">
          <label className="block text-[13px] font-medium text-ink-2">Race date</label>
          <input type="date" min={localToday()} value={s.raceDate} onChange={(e) => set({ raceDate: e.target.value })} className={input} />
          <input value={s.raceName} onChange={(e) => set({ raceName: e.target.value })} placeholder="Race name (optional), e.g. Ironman Arizona" className={input} />
        </div>
      )}
    </>
  );
}

function StepYou({ s, set }: StepProps) {
  const levels = [
    { id: "beginner", label: "Just starting", sub: "Under a year of consistent training" },
    { id: "intermediate", label: "Consistent", sub: "1–3 years, some races" },
    { id: "advanced", label: "Experienced", sub: "3+ years, structured training" },
    { id: "elite", label: "Competitive", sub: "Podiums, qualifying, high volume" },
  ];
  return (
    <>
      <Title sub="This sets starting volume and how hard sessions progress.">A bit about you</Title>
      <div className="space-y-2">
        {levels.map((l) => (
          <Choice key={l.id} selected={s.level === l.id} onClick={() => set({ level: l.id })}>
            <div>
              <div className="text-[16px] font-semibold text-ink-1">{l.label}</div>
              <div className="text-[13px] text-ink-3">{l.sub}</div>
            </div>
          </Choice>
        ))}
      </div>
      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[14px] font-medium text-ink-2">Hours per week at peak</span>
          <span className="num text-[22px] font-bold text-ink-1">{s.hours} h</span>
        </div>
        <input type="range" min={0} max={HOURS.length - 1} value={Math.max(0, HOURS.indexOf(s.hours))} onChange={(e) => set({ hours: HOURS[Number(e.target.value)] })} className="w-full accent-[#0A84FF]" />
        <p className="mt-1 text-[12px] text-ink-3">
          {s.race === "tri_full" ? "Most age-group Ironman athletes peak at 10–16 h." : s.race === "tri_703" ? "Most 70.3 athletes peak at 8–12 h." : "Be realistic — consistency beats heroic weeks."}
        </p>
      </div>
      {s.discipline === "tri" && (
        <div className="mt-6">
          <div className="mb-2 text-[14px] font-medium text-ink-2">Weakest discipline</div>
          <Segmented
            value={s.limiter}
            onChange={(v) => set({ limiter: v })}
            options={[
              { value: "none", label: "None" },
              { value: "swim", label: "Swim" },
              { value: "bike", label: "Bike" },
              { value: "run", label: "Run" },
            ]}
          />
        </div>
      )}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-2 text-[14px] font-medium text-ink-2">Units</div>
          <Segmented
            value={s.units}
            onChange={(v) => set({ units: v })}
            options={[
              { value: "imperial", label: "mi" },
              { value: "metric", label: "km" },
            ]}
          />
        </div>
        {(s.discipline === "tri" || s.discipline === "swim") && (
          <div>
            <div className="mb-2 text-[14px] font-medium text-ink-2">Pool</div>
            <Segmented
              value={s.pool}
              onChange={(v) => set({ pool: v })}
              options={[
                { value: "yards", label: "yd" },
                { value: "meters", label: "m" },
              ]}
            />
          </div>
        )}
      </div>
    </>
  );
}

function StepSchedule({ s, set }: StepProps) {
  return (
    <>
      <Title sub="Tap days you can train, set how long you have, and mark your long day (usually Saturday).">When can you train?</Title>
      <WeeklySchedulePicker schedule={s.schedule} onChange={(schedule) => set({ schedule })} />
    </>
  );
}

function StepConnect({ onBeforeConnect }: { onBeforeConnect: () => Promise<void> }) {
  const qc = useQueryClient();
  const { data: status } = useQuery<{ connected: boolean; configured: boolean }>({ queryKey: ["/api/strava/status"] });
  const [phase, setPhase] = useState<StravaConnectPhase>("idle");
  const busy = phase === "opening" || phase === "browser" || phase === "exchanging";
  useEffect(() => {
    if (phase === "success") void qc.invalidateQueries();
  }, [phase, qc]);
  return (
    <>
      <Title sub="Every workout from your watch lands here automatically — then your coach reviews it.">Connect your data</Title>
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FC4C02]">
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <div className="text-[17px] font-semibold text-ink-1">Strava</div>
            <div className="text-[13px] text-ink-3">Works with Garmin, COROS, Wahoo, Apple Watch, Zwift</div>
          </div>
        </div>
        {status?.connected ? (
          <div className="flex items-center gap-2 rounded-xl bg-good/10 px-4 py-3 text-[14px] font-semibold text-good">
            <Check size={18} /> Connected — importing your history
          </div>
        ) : (
          <PrimaryButton
            className="w-full !bg-[#FC4C02] !shadow-none"
            disabled={busy || status?.configured === false}
            onClick={async () => {
              await onBeforeConnect();
              await connectStravaFlow({ onPhase: setPhase });
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : "Connect Strava"}
          </PrimaryButton>
        )}
        <ul className="mt-4 space-y-2 text-[13px] leading-snug text-ink-2">
          <li>• We import a year of history to measure your fitness and detect FTP, threshold pace, CSS and heart-rate zones.</li>
          <li>• Garmin user? In Garmin Connect: Settings → Connected Apps → Strava. Done once, forever.</li>
        </ul>
      </div>
      <p className="mt-4 text-center text-[13px] text-ink-3">You can skip this and connect later in Profile.</p>
    </>
  );
}

function StepThresholds({ s, beforeSave }: { s: State; beforeSave: () => Promise<void> }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: th, refetch } = useQuery<ThresholdState>({ queryKey: ["/api/thresholds"] });
  const [ftp, setFtp] = useState("");
  const [raceDist, setRaceDist] = useState("5000");
  const [raceTime, setRaceTime] = useState("");
  const [css, setCss] = useState("");
  const [maxHr, setMaxHr] = useState("");
  const [saving, setSaving] = useState(false);
  const prefs = { units: s.units, pool: s.pool };
  const showBike = s.discipline === "tri" || s.discipline === "bike";
  const showRun = s.discipline === "tri" || s.discipline === "run";
  const showSwim = s.discipline === "tri" || s.discipline === "swim";
  const cur = th?.current ?? {};

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (ftp) body.ftp = Number(ftp);
    if (raceTime && !isValidClock(raceTime)) {
      toast({ title: "Check the race time", description: "Use mm:ss or h:mm:ss.", variant: "destructive" });
      return;
    }
    if (css && !isValidClock(css)) {
      toast({ title: "Check the swim pace", description: "Use m:ss, e.g. 1:50.", variant: "destructive" });
      return;
    }
    if (raceTime) body.recentRace = { distanceMeters: Number(raceDist), time: raceTime };
    if (css) body.swimCss = `${css}/${s.pool === "yards" ? "100yd" : "100m"}`;
    if (maxHr) body.maxHr = Number(maxHr);
    if (!Object.keys(body).length) return;
    setSaving(true);
    try {
      await beforeSave();
      await apiJson("POST", "/api/thresholds", body);
      await refetch();
      void qc.invalidateQueries();
      toast({ title: "Saved" });
    } catch (e) {
      toast({ title: "Check your numbers", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full rounded-xl border border-hairline bg-[#0d0d0f] px-4 py-3 text-ink-1 outline-none placeholder:text-ink-3";
  const Known = ({ metric }: { metric: string }) =>
    cur[metric] ? (
      <div className="mb-2 flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2 text-[13px]">
        <span className="text-ink-2">{cur[metric].source === "auto" ? "Detected from your data" : "Current"}</span>
        <span className="num font-semibold text-ink-1">{formatThreshold(metric, cur[metric].value, prefs)}</span>
      </div>
    ) : null;

  return (
    <>
      <Title sub="These set every target in your plan. Skip anything you don't know — we'll estimate and refine from your workouts.">Your numbers</Title>
      <div className="space-y-5">
        {showBike && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <SportBadge sport="bike" size={24} />
              <span className="text-[14px] font-semibold text-ink-1">FTP</span>
              <span className="text-[12px] text-ink-3">best ~1-hour power</span>
            </div>
            <Known metric="ftp" />
            <input className={input} inputMode="numeric" placeholder="Watts (optional)" value={ftp} onChange={(e) => setFtp(e.target.value.replace(/\D/g, ""))} />
          </div>
        )}
        {showRun && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <SportBadge sport="run" size={24} />
              <span className="text-[14px] font-semibold text-ink-1">A recent race or time trial</span>
            </div>
            <Known metric="run_threshold_pace" />
            <div className="flex gap-2">
              <select className={`${input} w-28`} value={raceDist} onChange={(e) => { setRaceDist(e.target.value); setRaceTime(""); }}>
                <option value="5000">5K</option>
                <option value="10000">10K</option>
                <option value={String(METERS_PER_MILE)}>Mile</option>
                <option value="21097.5">Half</option>
                <option value="42195">Marathon</option>
              </select>
              <ClockInput className={input} withHours={Number(raceDist) > 10000} placeholder={Number(raceDist) > 10000 ? "h:mm:ss, e.g. 1:45:30" : "mm:ss, e.g. 24:30"} value={raceTime} onChange={setRaceTime} />
            </div>
          </div>
        )}
        {showSwim && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <SportBadge sport="swim" size={24} />
              <span className="text-[14px] font-semibold text-ink-1">Swim threshold pace</span>
              <span className="text-[12px] text-ink-3">per 100{s.pool === "yards" ? "yd" : "m"}</span>
            </div>
            <Known metric="swim_css" />
            <ClockInput className={input} placeholder="m:ss, e.g. 1:50 (optional)" value={css} onChange={setCss} />
          </div>
        )}
        <div>
          <div className="mb-2 text-[14px] font-semibold text-ink-1">Max heart rate</div>
          <Known metric="max_hr" />
          <input className={input} inputMode="numeric" placeholder="bpm (optional)" value={maxHr} onChange={(e) => setMaxHr(e.target.value.replace(/\D/g, ""))} />
        </div>
        <PrimaryButton className="w-full" variant="secondary" onClick={() => void save()} disabled={saving || (!ftp && !raceTime && !css && !maxHr)}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : "Save numbers"}
        </PrimaryButton>
      </div>
    </>
  );
}

function StepPlan({ s }: { s: State }) {
  const label = s.race === "general" ? "a 12-week fitness block" : `your ${RACES[s.race].label}`;
  const days = s.raceDate ? Math.round((new Date(s.raceDate).getTime() - Date.now()) / 86_400_000) : null;
  return (
    <>
      <Title sub={`We'll build ${label}${days ? ` — ${Math.ceil(days / 7)} weeks out` : ""} around your ${s.hours} hours and ${s.schedule.length} training days.`}>Ready to build your plan</Title>
      <div className="card space-y-4 p-5">
        {[
          ["Periodized", "Base → build → peak → taper, with recovery every 4th week."],
          ["Your numbers", "Every interval targets your watts, paces and heart rates — and updates as you get fitter."],
          ["Sends to your watch", "Export any session as a structured .FIT (Garmin/COROS) or .ZWO (Zwift)."],
          ["Coached daily", "After every workout your coach reviews how it went and adjusts what's next."],
        ].map(([t, d]) => (
          <div key={t} className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20">
              <Check size={14} className="text-primary" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-ink-1">{t}</div>
              <div className="text-[13px] leading-snug text-ink-2">{d}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
