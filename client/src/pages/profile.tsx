import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ChevronRight, Loader2, LogOut, RefreshCw, Unlink, Zap, Watch, HeartPulse, Shield, Trash2, CalendarRange, Flag, Heart, Droplets, Brain, X } from "lucide-react";
import type { Profile, TrainingDay, HealthLog, CoachMemory } from "@shared/schema";
import { RACES, THRESHOLD_LABELS, type RaceType, type ThresholdMetric } from "@shared/physiology";
import { apiJson } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { usePrefs, useProfile, useThresholds, timeAgo, fmtDate, localToday } from "@/lib/vista";
import { PageHeader, Card, SectionTitle, Segmented, Sheet, PrimaryButton, Pill, ClockInput, isValidClock } from "@/components/kit";
import { WeeklySchedulePicker } from "@/components/weekly-schedule-picker";
import { formatThreshold } from "@/components/training";
import { connectStravaFlow, openGarminStravaHelpArticle, type StravaConnectPhase } from "@/lib/strava-oauth";
import { useToast } from "@/hooks/use-toast";
import { useSync } from "@/hooks/use-sync";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { connectAppleHealth, disconnectAppleHealth, healthEnabled, healthSupported } from "@/lib/health";

interface StravaStatus {
  connected: boolean;
  lastSynced: string | null;
  athlete: { firstname?: string; lastname?: string } | null;
  configured: boolean;
}

export const RACE_CHOICES: { value: RaceType; label: string }[] = [
  { value: "tri_full", label: RACES.tri_full.label },
  { value: "tri_703", label: RACES.tri_703.label },
  { value: "tri_olympic", label: RACES.tri_olympic.label },
  { value: "tri_sprint", label: RACES.tri_sprint.label },
  { value: "run_marathon", label: RACES.run_marathon.label },
  { value: "run_half", label: RACES.run_half.label },
  { value: "run_10k", label: RACES.run_10k.label },
  { value: "run_5k", label: RACES.run_5k.label },
  { value: "bike_event", label: "Cycling event (gran fondo, century, TT)" },
  { value: "swim_event", label: "Swim event" },
  { value: "general", label: "No race — build fitness" },
];

const HOURS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20];

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const prefs = usePrefs();
  const { data: th } = useThresholds();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const sync = useSync();
  const [goalOpen, setGoalOpen] = useState(false);
  const [editMetric, setEditMetric] = useState<ThresholdMetric | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [stravaPhase, setStravaPhase] = useState<StravaConnectPhase>("idle");
  const [fuelOpen, setFuelOpen] = useState(false);
  const [appleHealthOn, setAppleHealthOn] = useState(healthEnabled());

  const { data: strava } = useQuery<StravaStatus>({ queryKey: ["/api/strava/status"] });
  const { data: plan } = useQuery<{ id: string; title: string; startDate: string; endDate: string } | null>({ queryKey: ["/api/plan"] });
  const { data: health } = useQuery<HealthLog[]>({ queryKey: ["/api/health-logs"] });
  const { data: memories } = useQuery<CoachMemory[]>({ queryKey: ["/api/coach/memory"] });

  const forgetNote = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/coach/memory/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/coach/memory"] }),
  });

  const appleHealth = useMutation({
    mutationFn: connectAppleHealth,
    onSuccess: (n) => {
      setAppleHealthOn(true);
      void qc.invalidateQueries({ queryKey: ["/api/wellness"] });
      toast(
        n
          ? { title: "Apple Health connected", description: `Imported ${n} days of recovery data.` }
          : { title: "No Health data found", description: "Check Settings → Health → Data Access → Vista, and wear your watch to sleep." },
      );
    },
    onError: (e: Error) => toast({ title: "Apple Health", description: e.message, variant: "destructive" }),
  });

  const updateProfile = useMutation({
    mutationFn: (data: Partial<Profile>) => apiJson<Profile>("PUT", "/api/profile", data),
    onSuccess: () => {
      void qc.invalidateQueries();
      void IOSFeedbackManager.successNotification();
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const rebuild = useMutation({
    mutationFn: () => apiJson<{ workoutCount: number }>("POST", "/api/plan", {}),
    onSuccess: (r) => {
      void qc.invalidateQueries();
      toast({ title: "Plan rebuilt", description: `${r.workoutCount} workouts scheduled.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't build plan", description: e.message, variant: "destructive" }),
  });

  const disconnect = useMutation({
    mutationFn: () => apiJson("DELETE", "/api/strava"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/strava/status"] }),
  });

  const deleteAccount = useMutation({
    mutationFn: () => apiJson("DELETE", "/api/account"),
    onSuccess: async () => {
      qc.clear();
      await signOut();
    },
    onError: (e: Error) => toast({ title: "Couldn't delete account", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (stravaPhase === "success") {
      toast({ title: "Strava connected", description: "Importing your history — this can take a minute." });
      void qc.invalidateQueries();
    } else if (stravaPhase === "error") {
      toast({ title: "Strava connection failed", variant: "destructive" });
    }
  }, [stravaPhase, qc, toast]);

  const stravaBusy = stravaPhase === "opening" || stravaPhase === "browser" || stravaPhase === "exchanging";
  const initials = (profile?.fullName ?? user?.email ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const race = profile?.goalRaceType as RaceType | null;
  const thresholdRows: ThresholdMetric[] = ["ftp", "run_threshold_pace", "swim_css", "lthr_run", "lthr_bike", "max_hr", "resting_hr", "weight_kg"];
  const activeHealth = health?.filter((h) => !h.resolvedDate) ?? [];

  return (
    <div className="page">
      <PageHeader title="Profile" />

      <Card className="flex items-center gap-4 p-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0A84FF] to-[#5E5CE6] text-[18px] font-bold text-white">{initials}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold text-ink-1">{profile?.fullName || "Athlete"}</div>
          <div className="truncate text-[13px] text-ink-3">{user?.email}</div>
        </div>
        {profile?.fitnessLevel && <Pill>{profile.fitnessLevel}</Pill>}
      </Card>

      <SectionTitle>Goal & schedule</SectionTitle>
      <Card className="divide-y divide-hairline">
        <Row
          icon={<Flag size={17} />}
          label={race && RACES[race] ? (profile?.targetRace || RACES[race].label) : "No goal race"}
          value={profile?.targetRaceDate ? fmtDate(profile.targetRaceDate, { month: "short", day: "numeric", year: "numeric" }) : "Set goal"}
          onClick={() => setGoalOpen(true)}
        />
        <Row icon={<CalendarRange size={17} />} label="Weekly training" value={`${profile?.weeklyHoursGoal ? Number(profile.weeklyHoursGoal) : "—"} h · ${(profile?.weeklySchedule as TrainingDay[] | null)?.length ?? 0} days`} onClick={() => setGoalOpen(true)} />
      </Card>
      <Card className="mt-2 flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink-1">{plan ? plan.title : "No plan yet"}</div>
          <div className="text-[12px] text-ink-3">{plan ? `${fmtDate(plan.startDate, { month: "short", day: "numeric" })} → ${fmtDate(plan.endDate, { month: "short", day: "numeric" })}` : "Generate a periodized plan for your goal"}</div>
        </div>
        <button type="button" onClick={() => rebuild.mutate()} disabled={rebuild.isPending} className="press rounded-lg bg-white/[0.08] px-3 py-1.5 text-[13px] font-semibold text-ink-1">
          {rebuild.isPending ? <Loader2 size={14} className="animate-spin" /> : plan ? "Rebuild" : "Build"}
        </button>
      </Card>

      <SectionTitle
        action={
          <button type="button" className="text-[13px] font-medium text-primary" onClick={() => navigate("/progress")}>
            Zones
          </button>
        }
      >
        Thresholds
      </SectionTitle>
      <Card className="divide-y divide-hairline">
        {thresholdRows.map((m) => {
          const row = th?.current?.[m];
          return <Row key={m} label={THRESHOLD_LABELS[m]} value={row ? formatThreshold(m, row.value, prefs) : "Add"} sub={row?.source === "auto" ? "auto" : undefined} onClick={() => setEditMetric(m)} />;
        })}
      </Card>

      <SectionTitle>Units</SectionTitle>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] text-ink-1">Distance & pace</span>
          <div className="w-44">
            <Segmented
              value={prefs.units}
              onChange={(v) => updateProfile.mutate({ unitSystem: v })}
              options={[
                { value: "imperial", label: "mi" },
                { value: "metric", label: "km" },
              ]}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] text-ink-1">Pool</span>
          <div className="w-44">
            <Segmented
              value={prefs.pool}
              onChange={(v) => updateProfile.mutate({ poolUnit: v })}
              options={[
                { value: "yards", label: "yards" },
                { value: "meters", label: "meters" },
              ]}
            />
          </div>
        </div>
      </Card>

      <SectionTitle>Connections</SectionTitle>
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FC4C02]">
            <Zap size={19} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink-1">Strava</div>
            <div className="truncate text-[12px] text-ink-3">
              {strava?.connected ? `Connected${strava.athlete?.firstname ? ` as ${strava.athlete.firstname}` : ""} · synced ${timeAgo(strava.lastSynced)}` : "Imports every workout automatically"}
            </div>
          </div>
          {strava?.connected ? (
            <div className="flex gap-1">
              <button type="button" onClick={() => sync.run(true)} className="press rounded-full bg-white/[0.08] p-2 text-ink-2" aria-label="Sync now">
                <RefreshCw size={16} className={sync.syncing ? "animate-spin" : ""} />
              </button>
              <button type="button" onClick={() => disconnect.mutate()} className="press rounded-full bg-white/[0.08] p-2 text-bad" aria-label="Disconnect Strava">
                <Unlink size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={stravaBusy || strava?.configured === false}
              onClick={() => void connectStravaFlow({ onPhase: setStravaPhase })}
              className="press rounded-lg bg-[#FC4C02] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {stravaBusy ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
            </button>
          )}
        </div>
        <button type="button" onClick={() => void openGarminStravaHelpArticle()} className="press mt-3 flex w-full items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2.5 text-left">
          <Watch size={17} className="text-ink-2" />
          <div className="flex-1 text-[12px] leading-snug text-ink-2">
            <span className="font-semibold text-ink-1">Garmin, COROS, Wahoo, Apple Watch:</span> link your device app to Strava once and every workout lands here within seconds.
          </div>
          <ChevronRight size={15} className="text-ink-3" />
        </button>
        {healthSupported() && (
          <div className="mt-3 flex items-center gap-3 border-t border-hairline pt-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
              <Heart size={19} className="text-[#FF2D55]" fill="#FF2D55" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-ink-1">Apple Health</div>
              <div className="truncate text-[12px] text-ink-3">{appleHealthOn ? "HRV, resting HR and sleep sync on open" : "Lets your coach adjust to recovery"}</div>
            </div>
            {appleHealthOn ? (
              <button
                type="button"
                onClick={() => {
                  disconnectAppleHealth();
                  setAppleHealthOn(false);
                }}
                className="press rounded-full bg-white/[0.08] p-2 text-bad"
                aria-label="Stop Apple Health sync"
              >
                <Unlink size={16} />
              </button>
            ) : (
              <button type="button" onClick={() => appleHealth.mutate()} disabled={appleHealth.isPending} className="press rounded-lg bg-white/[0.12] px-3 py-1.5 text-[13px] font-semibold text-ink-1">
                {appleHealth.isPending ? <Loader2 size={14} className="animate-spin" /> : "Connect"}
              </button>
            )}
          </div>
        )}
      </Card>

      <SectionTitle>Fueling</SectionTitle>
      <Card className="divide-y divide-hairline">
        <Row icon={<Droplets size={17} />} label="Sweat rate" value={profile?.sweatRateMlPerH ? `${profile.sweatRateMlPerH} ml/h` : "Add"} onClick={() => setFuelOpen(true)} />
        <Row label="Sweat sodium" value={profile?.sweatSodiumMgPerL ? `${profile.sweatSodiumMgPerL} mg/L` : "Add"} onClick={() => setFuelOpen(true)} />
        <Row label="Carbs you can handle" value={profile?.carbToleranceGPerH ? `${profile.carbToleranceGPerH} g/h` : "Add"} onClick={() => setFuelOpen(true)} />
      </Card>

      <SectionTitle>What your coach knows</SectionTitle>
      <Card className="divide-y divide-hairline">
        {memories?.length ? (
          memories.map((m) => (
            <div key={m.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{m.category.replace("_", " ")}</div>
                <div className="text-[14px] leading-snug text-ink-1">{m.note}</div>
              </div>
              <button type="button" onClick={() => forgetNote.mutate(m.id)} className="press rounded-full p-1.5 text-ink-3" aria-label="Forget this note">
                <X size={15} />
              </button>
            </div>
          ))
        ) : (
          <div className="flex items-center gap-3 px-4 py-3.5 text-[14px] text-ink-2">
            <Brain size={17} className="text-ink-3" /> Tell your coach about injuries, schedule and goals — it remembers.
          </div>
        )}
      </Card>

      <SectionTitle
        action={
          <button type="button" className="text-[13px] font-medium text-primary" onClick={() => setHealthOpen(true)}>
            Log
          </button>
        }
      >
        Health
      </SectionTitle>
      <Card className="divide-y divide-hairline">
        {activeHealth.length ? (
          activeHealth.map((h) => <HealthRow key={h.id} h={h} />)
        ) : (
          <div className="flex items-center gap-3 px-4 py-3.5 text-[14px] text-ink-2">
            <HeartPulse size={17} className="text-ink-3" /> No active injuries or illness
          </div>
        )}
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card className="divide-y divide-hairline">
        <Row icon={<Shield size={17} />} label="Privacy policy" onClick={() => navigate("/privacy")} />
        <Row icon={<LogOut size={17} />} label="Sign out" onClick={() => void signOut()} />
        <Row icon={<Trash2 size={17} />} label="Delete account" danger onClick={() => setDeleteOpen(true)} />
      </Card>
      <p className="mt-4 text-center text-[11px] text-ink-3">Vista · coaching guidance is not medical advice</p>
      <div className="h-6" />

      <GoalSheet open={goalOpen} onClose={() => setGoalOpen(false)} profile={profile ?? null} onSave={(data, rebuildPlan) => updateProfile.mutate(data, { onSuccess: () => { setGoalOpen(false); if (rebuildPlan) rebuild.mutate(); } })} saving={updateProfile.isPending} />
      <ThresholdEditSheet metric={editMetric} onClose={() => setEditMetric(null)} />
      <HealthSheet open={healthOpen} onClose={() => setHealthOpen(false)} />
      <FuelingSheet open={fuelOpen} onClose={() => setFuelOpen(false)} profile={profile ?? null} onSave={(data) => updateProfile.mutate(data, { onSuccess: () => setFuelOpen(false) })} saving={updateProfile.isPending} />
      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete account?">
        <p className="mb-4 text-[14px] leading-relaxed text-ink-2">This permanently deletes your profile, activities, plans, coach conversations and disconnects Strava. It can't be undone.</p>
        <PrimaryButton variant="danger" className="w-full" onClick={() => deleteAccount.mutate()} disabled={deleteAccount.isPending}>
          {deleteAccount.isPending ? <Loader2 size={16} className="animate-spin" /> : "Delete everything"}
        </PrimaryButton>
      </Sheet>
    </div>
  );
}

function Row({ icon, label, value, sub, onClick, danger }: { icon?: React.ReactNode; label: string; value?: string; sub?: string; onClick?: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3.5 text-left">
      {icon && <span className={danger ? "text-bad" : "text-ink-2"}>{icon}</span>}
      <span className={`flex-1 truncate text-[15px] ${danger ? "text-bad" : "text-ink-1"}`}>{label}</span>
      {sub && <span className="text-[11px] text-ink-3">{sub}</span>}
      {value && <span className="num text-[14px] text-ink-2">{value}</span>}
      {!danger && <ChevronRight size={15} className="text-ink-3" />}
    </button>
  );
}

function GoalSheet({
  open,
  onClose,
  profile,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
  onSave: (d: Partial<Profile>, rebuild: boolean) => void;
  saving: boolean;
}) {
  const [race, setRace] = useState<RaceType>("general");
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [hours, setHours] = useState(8);
  const [schedule, setSchedule] = useState<TrainingDay[]>([]);
  const [level, setLevel] = useState("intermediate");
  const [limiter, setLimiter] = useState<string>("none");
  useEffect(() => {
    if (!open || !profile) return;
    setRace((profile.goalRaceType as RaceType) ?? "general");
    setDate(profile.targetRaceDate ?? "");
    setName(profile.targetRace ?? "");
    setHours(profile.weeklyHoursGoal ? Math.round(Number(profile.weeklyHoursGoal)) : 8);
    setSchedule((profile.weeklySchedule as TrainingDay[] | null) ?? []);
    setLevel(profile.fitnessLevel ?? "intermediate");
    setLimiter(profile.limiter ?? "none");
  }, [open, profile]);
  const input = "w-full rounded-xl bg-white/[0.08] px-4 py-3 text-ink-1 outline-none";
  const payload = (): Partial<Profile> => ({
    goalRaceType: race,
    targetRaceDate: race === "general" ? null : date || null,
    targetRace: race === "general" ? null : name || null,
    weeklyHoursGoal: String(hours),
    weeklyHoursBucket: hours < 5 ? "under_5" : hours < 10 ? "five_to_ten" : hours < 15 ? "ten_to_fifteen" : "fifteen_plus",
    weeklySchedule: schedule,
    fitnessLevel: level,
    limiter: limiter === "none" ? null : limiter,
  });
  const valid = race === "general" || (date && date > localToday());
  return (
    <Sheet open={open} onClose={onClose} title="Goal & schedule">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">Goal</div>
          <select value={race} onChange={(e) => setRace(e.target.value as RaceType)} className={input}>
            {RACE_CHOICES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {race !== "general" && (
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Race name" className={input} />
          </div>
        )}
        <div>
          <div className="mb-1.5 flex justify-between text-[12px] font-medium text-ink-2">
            <span>Hours per week (peak)</span>
            <span className="num text-ink-1">{hours} h</span>
          </div>
          <input type="range" min={0} max={HOURS.length - 1} value={Math.max(0, HOURS.indexOf(hours))} onChange={(e) => setHours(HOURS[Number(e.target.value)])} className="w-full accent-[#0A84FF]" />
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">Experience</div>
          <Segmented
            value={level}
            onChange={setLevel}
            options={[
              { value: "beginner", label: "New" },
              { value: "intermediate", label: "Inter." },
              { value: "advanced", label: "Adv." },
              { value: "elite", label: "Elite" },
            ]}
          />
        </div>
        {race.startsWith("tri_") && (
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink-2">Weakest discipline</div>
            <Segmented
              value={limiter}
              onChange={setLimiter}
              options={[
                { value: "none", label: "None" },
                { value: "swim", label: "Swim" },
                { value: "bike", label: "Bike" },
                { value: "run", label: "Run" },
              ]}
            />
          </div>
        )}
        <div>
          <div className="mb-2 text-[12px] font-medium text-ink-2">Days you can train</div>
          <WeeklySchedulePicker schedule={schedule} onChange={setSchedule} />
        </div>
        <PrimaryButton className="w-full" onClick={() => onSave(payload(), true)} disabled={!valid || saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : "Save & rebuild plan"}
        </PrimaryButton>
        <PrimaryButton className="w-full" variant="secondary" onClick={() => onSave(payload(), false)} disabled={!valid || saving}>
          Save only
        </PrimaryButton>
      </div>
    </Sheet>
  );
}

const METRIC_INPUT: Record<ThresholdMetric, { key: string; hint: (p: ReturnType<typeof usePrefs>) => string; numeric: boolean; suffix?: (p: ReturnType<typeof usePrefs>) => string; toKg?: boolean }> = {
  ftp: { key: "ftp", hint: () => "Watts, e.g. 240", numeric: true },
  run_threshold_pace: { key: "runThresholdPace", hint: (p) => `Pace per ${p.units === "imperial" ? "mile" : "km"}, e.g. ${p.units === "imperial" ? "7:15" : "4:30"}`, numeric: false, suffix: (p) => (p.units === "imperial" ? "/mi" : "/km") },
  swim_css: { key: "swimCss", hint: (p) => `Pace per 100${p.pool === "yards" ? "yd" : "m"}, e.g. 1:45`, numeric: false, suffix: (p) => (p.pool === "yards" ? "/100yd" : "/100m") },
  lthr_run: { key: "lthrRun", hint: () => "bpm", numeric: true },
  lthr_bike: { key: "lthrBike", hint: () => "bpm", numeric: true },
  max_hr: { key: "maxHr", hint: () => "bpm", numeric: true },
  resting_hr: { key: "restingHr", hint: () => "bpm", numeric: true },
  weight_kg: { key: "weightKg", hint: (p) => (p.units === "imperial" ? "Pounds" : "Kilograms"), numeric: true, toKg: true },
  vo2max: { key: "", hint: () => "", numeric: true },
};

const FUEL_FIELDS = [
  { key: "sweatRateMlPerH", label: "Sweat rate (ml/h)", hint: "e.g. 900 — weigh nude before/after 60 min, add fluid drunk" },
  { key: "sweatSodiumMgPerL", label: "Sweat sodium (mg/L)", hint: "e.g. 1100 — from a sweat test" },
  { key: "carbToleranceGPerH", label: "Carbs you can handle (g/h)", hint: "e.g. 75 — highest rate with no stomach issues" },
] as const;

function FuelingSheet({ open, onClose, profile, onSave, saving }: { open: boolean; onClose: () => void; profile: Profile | null; onSave: (d: Partial<Profile>) => void; saving: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setVals(Object.fromEntries(FUEL_FIELDS.map((f) => [f.key, profile?.[f.key] ? String(profile[f.key]) : ""])));
  }, [open, profile]);
  const submit = () => onSave(Object.fromEntries(FUEL_FIELDS.map((f) => [f.key, vals[f.key]?.trim() ? Math.round(parseFloat(vals[f.key])) : null])) as Partial<Profile>);
  return (
    <Sheet open={open} onClose={onClose} title="Fueling">
      {FUEL_FIELDS.map((f) => (
        <label key={f.key} className="mb-3 block">
          <span className="mb-1 block text-[13px] text-ink-2">{f.label}</span>
          <input
            value={vals[f.key] ?? ""}
            onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={f.hint}
            inputMode="numeric"
            className="w-full rounded-xl bg-white/[0.08] px-4 py-3 text-ink-1 outline-none placeholder:text-[13px] placeholder:text-ink-3"
          />
        </label>
      ))}
      <PrimaryButton className="mt-1 w-full" onClick={submit} disabled={saving}>
        {saving ? <Loader2 size={16} className="animate-spin" /> : "Save"}
      </PrimaryButton>
      <p className="mt-3 text-[12px] leading-snug text-ink-3">Blank fields use typical values. Your coach uses these for session and race-day fueling targets.</p>
    </Sheet>
  );
}

function ThresholdEditSheet({ metric, onClose }: { metric: ThresholdMetric | null; onClose: () => void }) {
  const prefs = usePrefs();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [metric]);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiJson("POST", "/api/thresholds", body),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast({ title: "Saved", description: "Future workouts now use the new value." });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  if (!metric) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const spec = METRIC_INPUT[metric];
  const submit = () => {
    let v: unknown = value.trim();
    if (spec.numeric) {
      const n = parseFloat(value);
      v = spec.toKg && prefs.units === "imperial" ? n / 2.20462 : n;
    } else if (spec.suffix) {
      v = `${value.trim()}${spec.suffix(prefs)}`;
    }
    save.mutate({ [spec.key]: v });
  };
  return (
    <Sheet open={!!metric} onClose={onClose} title={THRESHOLD_LABELS[metric]}>
      {spec.suffix ? (
        <ClockInput
          value={value}
          onChange={setValue}
          placeholder={spec.hint(prefs)}
          className="mb-4 w-full rounded-xl border border-transparent bg-white/[0.08] px-4 py-3 text-ink-1 outline-none placeholder:text-ink-3"
        />
      ) : (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={spec.hint(prefs)}
          inputMode={spec.numeric ? "decimal" : "text"}
          className="mb-4 w-full rounded-xl bg-white/[0.08] px-4 py-3 text-ink-1 outline-none placeholder:text-ink-3"
        />
      )}
      <PrimaryButton className="w-full" onClick={submit} disabled={!value.trim() || (!!spec.suffix && !isValidClock(value)) || save.isPending}>
        {save.isPending ? <Loader2 size={16} className="animate-spin" /> : "Save"}
      </PrimaryButton>
      <p className="mt-3 text-[12px] leading-snug text-ink-3">Not sure? Leave it — Vista estimates thresholds from your workouts and asks before changing anything you set.</p>
    </Sheet>
  );
}

function HealthRow({ h }: { h: HealthLog }) {
  const qc = useQueryClient();
  const resolve = useMutation({
    mutationFn: () => apiJson("POST", `/api/health-logs/${h.id}/resolve`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/health-logs"] }),
  });
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <HeartPulse size={17} className="text-bad" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] capitalize text-ink-1">
          {h.type.replace("_", " ")}
          {h.bodyPart ? ` · ${h.bodyPart}` : ""}
        </div>
        <div className="truncate text-[12px] text-ink-3">{h.description}</div>
      </div>
      <button type="button" onClick={() => resolve.mutate()} className="press rounded-lg bg-white/[0.08] px-2.5 py-1 text-[12px] font-semibold text-ink-1">
        Resolved
      </button>
    </div>
  );
}

function HealthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState("injury");
  const [severity, setSeverity] = useState(2);
  const [bodyPart, setBodyPart] = useState("");
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () => apiJson("POST", "/api/health-logs", { type, severity, bodyPart: bodyPart || undefined, description, date: localToday() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/health-logs"] });
      setDescription("");
      setBodyPart("");
      onClose();
    },
  });
  const input = "w-full rounded-xl bg-white/[0.08] px-4 py-3 text-ink-1 outline-none placeholder:text-ink-3";
  return (
    <Sheet open={open} onClose={onClose} title="Log health issue">
      <div className="space-y-3">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: "injury", label: "Injury" },
            { value: "illness", label: "Illness" },
            { value: "fatigue", label: "Fatigue" },
            { value: "life_stress", label: "Stress" },
          ]}
        />
        {type === "injury" && <input value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="Where? e.g. left achilles" className={input} />}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's going on?" className={`${input} resize-none`} />
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">Severity {severity}/5</div>
          <input type="range" min={1} max={5} value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full accent-[#0A84FF]" />
        </div>
        <PrimaryButton className="w-full" onClick={() => save.mutate()} disabled={!description.trim() || save.isPending}>
          Save
        </PrimaryButton>
        <p className="text-[12px] leading-snug text-ink-3">Your coach sees this and adapts training. For pain that changes how you move, see a medical professional.</p>
      </div>
    </Sheet>
  );
}
