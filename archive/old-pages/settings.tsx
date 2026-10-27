import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  User, Target, Activity, LogOut, Clock,
  CheckCircle, RefreshCw, Loader2, Link2, Unlink, Check,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { useToast } from "@/hooks/use-toast";
import type { Profile, TrainingDay } from "@shared/schema";
import type { SportType } from "@shared/schema";
import { WeeklySchedulePicker } from "@/components/weekly-schedule-picker";
import {
  WEEKLY_HOURS_UI_OPTIONS,
  isWeeklyHoursBucket,
  weeklyTimeCommitmentDisplay,
  type WeeklyHoursBucket,
} from "@shared/weekly-hours-bucket";
import {
  initialRaceSlotsFromProfile,
  raceSlotsToEntries,
  peakFromProfile,
  peakFormToPayload,
  formatUpcomingRacesSummary,
  formatPeakWeeklyVolumeSummary,
  type RaceSlotForm,
  type PeakWeeklyVolume,
} from "@shared/profile-goals";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UpcomingRacesFields, PeakWeeklyVolumeFields } from "@/components/profile-training-fields";
import {
  connectStravaFlow,
  openGarminStravaHelpArticle,
  openGarminStravaSetup,
  type StravaConnectPhase,
} from "@/lib/strava-oauth";

const SPORT_OPTIONS: { id: SportType; emoji: string; label: string }[] = [
  { id: "running", emoji: "🏃", label: "Running" },
  { id: "cycling", emoji: "🚴", label: "Cycling" },
  { id: "swimming", emoji: "🏊", label: "Swimming" },
  { id: "triathlon", emoji: "🏅", label: "Triathlete" },
];

interface StravaStatus {
  connected: boolean;
  lastSynced: string | null;
  athlete: { firstname?: string; lastname?: string } | null;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editProfile, setEditProfile] = useState(false);

  const { data: profile } = useQuery<Profile | null>({
    queryKey: ["/api/profile"],
  });

  const { data: stravaStatus } = useQuery<StravaStatus>({
    queryKey: ["/api/strava/status"],
  });

  const [stravaPhase, setStravaPhase] = useState<StravaConnectPhase>("idle");

  useEffect(() => {
    if (stravaPhase !== "success") return;
    void qc.invalidateQueries({ queryKey: ["/api/strava/status"] });
    void qc.invalidateQueries({ queryKey: ["/api/runs"] });
    toast({ title: "Strava connected" });
    const t = window.setTimeout(() => setStravaPhase("idle"), 800);
    return () => window.clearTimeout(t);
  }, [stravaPhase, qc, toast]);

  useEffect(() => {
    if (stravaPhase !== "error") return;
    toast({
      title: "Strava connection failed",
      description: "Try again or check Strava API settings.",
      variant: "destructive",
    });
    const t = window.setTimeout(() => setStravaPhase("idle"), 400);
    return () => window.clearTimeout(t);
  }, [stravaPhase, toast]);

  const stravaBusy =
    stravaPhase === "opening" || stravaPhase === "browser" || stravaPhase === "exchanging";

  const profileMutation = useMutation({
    mutationFn: async (data: Partial<Profile>) => {
      const res = await apiRequest("PUT", "/api/profile", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/profile"] });
      setEditProfile(false);
      toast({ title: "Profile updated" });
      IOSFeedbackManager.successNotification();
    },
  });

  const syncStravaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/strava/sync", {});
      return res.json() as Promise<{ synced: number; skipped: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/strava/status"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      toast({ title: "Strava synced", description: `${data.synced} new activities imported` });
      IOSFeedbackManager.successNotification();
    },
    onError: () => {
      toast({ title: "Sync failed", description: "Check your Strava connection", variant: "destructive" });
    },
  });

  const connectStrava = async () => {
    await IOSFeedbackManager.mediumImpact();
    await connectStravaFlow({
      onPhase: setStravaPhase,
      onFinally: () => {
        void qc.invalidateQueries({ queryKey: ["/api/strava/status"] });
      },
    });
  };

  const disconnectStrava = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/strava/disconnect", {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/strava/status"] });
      toast({ title: "Strava disconnected" });
    },
  });

  const handleSignOut = async () => {
    await IOSFeedbackManager.mediumImpact();
    await signOut();
  };

  const initials = profile?.fullName
    ? profile.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : user?.email?.[0].toUpperCase() ?? "?";

  return (
    <div className="h-full min-h-0 overflow-y-auto px-5 pb-28">
      <div className="pt-14 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your account and integrations</p>
      </div>

      {/* Avatar & name (no edit button here) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface-raised rounded-2xl p-4 mb-4 shadow-sm flex items-center gap-4"
      >
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-skyblue to-blue-600 flex items-center justify-center shadow-md">
          <span className="text-white font-bold text-lg">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground">{profile?.fullName || "Athlete"}</p>
          <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
          {profile?.fitnessLevel && (
            <span className="inline-block mt-1 text-xs bg-skyblue/10 text-skyblue px-2 py-0.5 rounded-lg font-medium capitalize">
              {profile.fitnessLevel}
            </span>
          )}
        </div>
      </motion.div>

      {/* Edit profile inline */}
      {editProfile && (
        <ProfileEditForm
          profile={profile}
          onSave={(data) => profileMutation.mutate(data)}
          onCancel={() => setEditProfile(false)}
          saving={profileMutation.isPending}
        />
      )}

      {/* Training Goals */}
      <div className="bg-surface-raised rounded-2xl shadow-sm mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Training Goals</p>
          <button
            type="button"
            onClick={() => { setEditProfile(!editProfile); IOSFeedbackManager.lightImpact(); }}
            className="text-skyblue text-xs font-semibold"
          >
            {editProfile ? "Cancel" : "Edit"}
          </button>
        </div>
        <SettingsRow icon={Target} label="Upcoming races" value={formatUpcomingRacesSummary(profile ?? undefined)} />
        <SettingsRow icon={Clock} label="Weekly training time" value={weeklyTimeCommitmentDisplay(profile ?? {})} />
        <SettingsRow
          icon={Activity}
          label="Peak weekly volume"
          value={formatPeakWeeklyVolumeSummary(
            profile?.peakWeeklyVolume ?? null,
            (profile?.sports as SportType[] | null) ?? ["running"]
          )}
        />
        <SettingsRow icon={User} label="Fitness Level" value={profile?.fitnessLevel ? profile.fitnessLevel.charAt(0).toUpperCase() + profile.fitnessLevel.slice(1) : "Not set"} />
      </div>

      {/* Integrations */}
      <div className="bg-surface-raised rounded-2xl shadow-sm mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Integrations</p>
        </div>

        {/* Strava */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Strava</p>
              <p className="text-xs text-muted-foreground">
                {stravaStatus?.connected
                  ? `Connected${stravaStatus.athlete ? ` · ${stravaStatus.athlete.firstname} ${stravaStatus.athlete.lastname}` : ""}`
                  : "Connect to sync Garmin, Coros, and more"}
              </p>
              {stravaStatus?.lastSynced && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last synced {new Date(stravaStatus.lastSynced).toLocaleDateString()}
                </p>
              )}
            </div>
            {stravaStatus?.connected ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 rounded-xl border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                  <Check size={14} className="text-green-500" />
                  Linked
                </span>
                <button
                  type="button"
                  onClick={() => { syncStravaMutation.mutate(); IOSFeedbackManager.mediumImpact(); }}
                  disabled={syncStravaMutation.isPending}
                  className="p-2 text-skyblue active:scale-90 transition-transform"
                >
                  {syncStravaMutation.isPending
                    ? <Loader2 size={16} className="animate-spin" />
                    : <RefreshCw size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => { disconnectStrava.mutate(); IOSFeedbackManager.mediumImpact(); }}
                  className="p-2 text-red-400 active:scale-90 transition-transform"
                >
                  <Unlink size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => void connectStrava()}
                disabled={stravaBusy}
                className="flex min-w-[7.5rem] items-center justify-center gap-1 bg-orange-500 px-3 py-2 text-xs font-semibold text-white rounded-xl transition-transform active:scale-90 disabled:opacity-60"
              >
                {stravaBusy ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    {stravaPhase === "exchanging"
                      ? "Saving…"
                      : stravaPhase === "browser"
                        ? "Waiting…"
                        : "Opening…"}
                  </>
                ) : (
                  <>
                    <Link2 size={13} /> Connect
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Garmin → Strava bridge */}
        <div className="px-4 py-4 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">G</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground text-sm">Garmin & other devices</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Link Garmin Connect to Strava, then use Connect above. Opens Garmin Connect or a step-by-step
                guide.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => void openGarminStravaSetup()}
                className="text-xs font-semibold text-skyblue px-2 py-1 rounded-lg active:opacity-70"
              >
                Open app
              </button>
              <button
                type="button"
                onClick={() => void openGarminStravaHelpArticle()}
                className="text-[10px] font-medium text-muted-foreground px-2 py-0.5 active:opacity-70"
              >
                Guide
              </button>
            </div>
          </div>
        </div>

        {stravaStatus?.connected && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-1.5 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2">
              <CheckCircle size={13} className="text-green-500 shrink-0" />
              <p className="text-xs text-muted-foreground">
                Coros and other devices that sync to Strava will import here automatically.
              </p>
            </div>
          </div>
        )}

        {/* Apple Health (coming soon) */}
        <div className="px-4 py-4 border-t border-border opacity-60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-lg">♥</span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground text-sm">Apple Health</p>
              <p className="text-xs text-muted-foreground">Coming soon — native iOS sync</p>
            </div>
            <span className="text-xs bg-surface-elevated text-muted-foreground px-2 py-1 rounded-lg">Soon</span>
          </div>
        </div>
      </div>

      {/* Sign Out */}
      <button
        onClick={handleSignOut}
        className="w-full bg-surface-raised rounded-2xl p-4 shadow-sm flex items-center gap-3 text-red-500 active:scale-95 transition-transform mb-4"
      >
        <LogOut size={18} />
        <span className="font-semibold text-sm">Sign Out</span>
      </button>

      <p className="text-center text-xs text-muted-foreground">Vista Running · v1.0</p>
    </div>
  );
}

function SettingsRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="w-8 h-8 rounded-xl bg-skyblue/10 flex items-center justify-center flex-shrink-0">
        <Icon size={15} className="text-skyblue" />
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function initialWeeklyBucket(p: Profile | null | undefined): WeeklyHoursBucket {
  if (p?.weeklyHoursBucket && isWeeklyHoursBucket(p.weeklyHoursBucket)) return p.weeklyHoursBucket;
  return "five_to_ten";
}

function ProfileEditForm({
  profile,
  onSave,
  onCancel,
  saving,
}: {
  profile: Profile | null | undefined;
  onSave: (data: Partial<Profile>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    fullName: profile?.fullName ?? "",
    weeklyHoursBucket: initialWeeklyBucket(profile),
    fitnessLevel: profile?.fitnessLevel ?? "intermediate",
    age: profile?.age ? String(profile.age) : "",
    sports: (profile?.sports as SportType[] | null) ?? ["running"],
  });
  const [raceSlots, setRaceSlots] = useState<[RaceSlotForm, RaceSlotForm, RaceSlotForm]>(() =>
    initialRaceSlotsFromProfile(profile, (profile?.sports as SportType[] | null) ?? ["running"])
  );
  const [peakForm, setPeakForm] = useState<PeakWeeklyVolume>(() =>
    peakFromProfile(profile?.peakWeeklyVolume ?? null, profile?.weeklyMileageGoal ?? null)
  );
  const [weeklySchedule, setWeeklySchedule] = useState<TrainingDay[]>(
    () => (profile?.weeklySchedule as TrainingDay[] | null) ?? []
  );

  useEffect(() => {
    if (!profile?.id) return;
    const sports = (profile.sports as SportType[] | null) ?? ["running"];
    setForm({
      fullName: profile.fullName ?? "",
      weeklyHoursBucket: initialWeeklyBucket(profile),
      fitnessLevel: profile.fitnessLevel ?? "intermediate",
      age: profile.age != null ? String(profile.age) : "",
      sports,
    });
    setRaceSlots(initialRaceSlotsFromProfile(profile, sports));
    setPeakForm(peakFromProfile(profile.peakWeeklyVolume ?? null, profile.weeklyMileageGoal ?? null));
    setWeeklySchedule((profile.weeklySchedule as TrainingDay[] | null) ?? []);
  }, [profile?.id, profile?.updatedAt]);

  const racesSyncKey =
    profile?.id && profile?.updatedAt != null ? `${profile.id}-${String(profile.updatedAt)}` : "pending";

  const LEVELS = ["beginner", "intermediate", "advanced", "elite"];

  const toggleSport = (id: SportType) => {
    setForm((f) => {
      const has = f.sports.includes(id);
      if (has && f.sports.length === 1) return f; // keep at least one
      return { ...f, sports: has ? f.sports.filter((s) => s !== id) : [...f.sports, id] };
    });
    IOSFeedbackManager.lightImpact();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="min-w-0 max-w-full bg-surface-raised rounded-2xl shadow-sm mb-4 overflow-hidden p-4"
    >
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Edit Profile</p>
      <div className="space-y-4">
        <input
          value={form.fullName}
          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
          placeholder="Full name"
          className="w-full bg-surface-elevated rounded-xl px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-skyblue/30"
        />

        {/* Sports */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">Sports</p>
          <div className="flex flex-wrap gap-2">
            {SPORT_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSport(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  form.sports.includes(s.id)
                    ? "bg-skyblue text-white"
                    : "bg-surface-elevated text-muted-foreground"
                }`}
              >
                <span>{s.emoji}</span>{s.label}
              </button>
            ))}
          </div>
        </div>

        <UpcomingRacesFields
          sports={form.sports}
          slots={raceSlots}
          onSlotsChange={setRaceSlots}
          profileSyncKey={racesSyncKey}
        />
        <PeakWeeklyVolumeFields sports={form.sports} peak={peakForm} onPeakChange={setPeakForm} />

        <div>
          <p className="text-xs text-muted-foreground mb-1.5 font-medium">Weekly training time</p>
          <Select
            value={form.weeklyHoursBucket}
            onValueChange={(v) => {
              void IOSFeedbackManager.lightImpact();
              setForm((f) => ({ ...f, weeklyHoursBucket: v as WeeklyHoursBucket }));
            }}
          >
            <SelectTrigger className="h-auto min-h-[44px] w-full rounded-xl border-border bg-surface-elevated text-sm text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border bg-surface-raised text-foreground">
              {WEEKLY_HOURS_UI_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="rounded-lg">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Weekly schedule */}
        <div>
          <p className="text-xs text-muted-foreground mb-3 font-medium">Training days</p>
          <WeeklySchedulePicker schedule={weeklySchedule} onChange={setWeeklySchedule} />
        </div>

        {/* Fitness level */}
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-medium">Fitness Level</p>
          <div className="flex gap-2 flex-wrap">
            {LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => { setForm((f) => ({ ...f, fitnessLevel: level })); IOSFeedbackManager.lightImpact(); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-colors ${
                  form.fitnessLevel === level
                    ? "bg-skyblue text-white"
                    : "bg-surface-elevated text-muted-foreground"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>

        <input
          value={form.age}
          onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
          inputMode="numeric"
          placeholder="Age (optional)"
          className="w-full bg-surface-elevated rounded-xl px-3 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-skyblue/30"
        />

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              const upcoming = raceSlotsToEntries([...raceSlots], form.sports);
              const peakPayload = peakFormToPayload(peakForm, form.sports);
              onSave({
                fullName: form.fullName || undefined,
                weeklyHoursBucket: form.weeklyHoursBucket,
                weeklyMileageGoal: null,
                weeklySchedule,
                upcomingRaces: upcoming,
                peakWeeklyVolume: peakPayload,
                fitnessLevel: form.fitnessLevel,
                age: form.age ? parseInt(form.age, 10) : undefined,
                sports: form.sports,
                primarySport: form.sports.includes("triathlon") ? "triathlon" : form.sports[0],
              });
            }}
            disabled={saving}
            className="flex-1 bg-skyblue text-white py-3 rounded-xl text-sm font-semibold active:scale-95 transition-transform"
          >
            {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-3 bg-surface-elevated text-muted-foreground rounded-xl text-sm font-semibold active:scale-95 transition-transform"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}
