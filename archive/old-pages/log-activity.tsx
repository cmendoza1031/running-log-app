import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ScrollWheel from "@/components/scroll-wheel";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { IOSFeedbackManager } from "@/lib/ios-utils";

// ─── Config ───────────────────────────────────────────────────────────────────

type SportKey = "running" | "cycling" | "swimming" | "triathlon";

interface SportCfg {
  emoji: string;
  label: string;
  defaultUnit: "mi" | "km" | "yards" | "meters";
  altUnit: "mi" | "km" | "yards" | "meters";
  unitLabel: (u: string) => string;
  paceLabel: (u: string) => string;
  showPace: boolean;
  showPower: boolean;
  workoutTypes: { value: string; label: string }[];
}

const SPORT_CFG: Record<SportKey, SportCfg> = {
  running: {
    emoji: "🏃", label: "Run",
    defaultUnit: "mi", altUnit: "km",
    unitLabel: (u) => u,
    paceLabel: (u) => u === "km" ? "min/km" : "min/mi",
    showPace: true, showPower: false,
    workoutTypes: [
      { value: "easy", label: "Easy" },
      { value: "tempo", label: "Tempo" },
      { value: "long", label: "Long Run" },
      { value: "interval", label: "Intervals" },
      { value: "threshold", label: "Threshold" },
      { value: "trail", label: "Trail" },
      { value: "recovery", label: "Recovery" },
      { value: "race", label: "Race" },
    ],
  },
  cycling: {
    emoji: "🚴", label: "Bike",
    defaultUnit: "mi", altUnit: "km",
    unitLabel: (u) => u,
    paceLabel: () => "optional: avg watts",
    showPace: false, showPower: true,
    workoutTypes: [
      { value: "easy_ride", label: "Easy Ride" },
      { value: "tempo_ride", label: "Tempo" },
      { value: "long_ride", label: "Long Ride" },
      { value: "interval_ride", label: "Intervals" },
      { value: "hill_ride", label: "Hills" },
      { value: "sweet_spot", label: "Sweet Spot" },
      { value: "recovery_ride", label: "Recovery" },
      { value: "race_ride", label: "Race" },
    ],
  },
  swimming: {
    emoji: "🏊", label: "Swim",
    defaultUnit: "yards", altUnit: "meters",
    unitLabel: (u) => u === "meters" ? "m" : "yd",
    paceLabel: (u) => u === "meters" ? "min/100m" : "min/100y",
    showPace: true, showPower: false,
    workoutTypes: [
      { value: "easy_swim", label: "Easy" },
      { value: "threshold_swim", label: "Threshold" },
      { value: "interval_swim", label: "Intervals" },
      { value: "open_water_swim", label: "Open Water" },
      { value: "drill", label: "Drills" },
      { value: "css_test", label: "CSS Test" },
      { value: "race_swim", label: "Race" },
    ],
  },
  triathlon: {
    emoji: "🏅", label: "Multi",
    defaultUnit: "mi", altUnit: "km",
    unitLabel: (u) => u,
    paceLabel: () => "min/mi",
    showPace: true, showPower: false,
    workoutTypes: [
      { value: "brick", label: "Brick" },
      { value: "transition", label: "Transition" },
      { value: "easy", label: "Easy" },
      { value: "race", label: "Race" },
      { value: "other", label: "Other" },
    ],
  },
};

// ─── Log Activity page ────────────────────────────────────────────────────────

export default function LogActivity() {
  const [sport, setSport] = useState<SportKey>("running");
  const [distUnit, setDistUnit] = useState<string>("mi");
  const [workoutType, setWorkoutType] = useState("easy");
  const [distance, setDistance] = useState("");
  const [paceMinutes, setPaceMinutes] = useState(8);
  const [paceSeconds, setPaceSeconds] = useState(45);
  const [timeHours, setTimeHours] = useState(0);
  const [timeMinutes, setTimeMinutes] = useState(45);
  const [avgPower, setAvgPower] = useState("");
  const [notes, setNotes] = useState("");
  const [dateStr, setDateStr] = useState(new Date().toISOString().split("T")[0]);
  const [showPacePopup, setShowPacePopup] = useState(false);
  const [showTimePopup, setShowTimePopup] = useState(false);
  const [paceAutoCalced, setPaceAutoCalced] = useState(false);
  const [timeAutoCalced, setTimeAutoCalced] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const editRunId = new URLSearchParams(window.location.search).get("edit");
  const { data: editingRun } = useQuery<Record<string, unknown>>({
    queryKey: ["/api/runs", editRunId],
    enabled: !!editRunId,
  });

  useEffect(() => {
    if (!editRunId || !editingRun) return;
    setIsEditing(true);
    setEditingId(editRunId);
    setSport((editingRun.sportType as SportKey) ?? "running");
    setDistUnit((editingRun.distanceUnit as string) ?? "mi");
    setWorkoutType((editingRun.runType as string) ?? "easy");
    setDistance(String(editingRun.distance ?? ""));
    setPaceMinutes(Number(editingRun.paceMinutes ?? 8));
    setPaceSeconds(Number(editingRun.paceSeconds ?? 45));
    setTimeHours(Number(editingRun.timeHours ?? 0));
    setTimeMinutes(Number(editingRun.timeMinutes ?? 45));
    setNotes((editingRun.notes as string) ?? "");
    setDateStr((editingRun.date as string) ?? new Date().toISOString().split("T")[0]);
  }, [editRunId, editingRun]);

  const cfg = SPORT_CFG[sport];

  const handleSportChange = (s: SportKey) => {
    setSport(s);
    setWorkoutType(SPORT_CFG[s].workoutTypes[0].value);
    setDistUnit(SPORT_CFG[s].defaultUnit);
    void IOSFeedbackManager.lightImpact();
  };

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url    = isEditing ? `/api/runs/${editingId}` : "/api/runs";
      const method = isEditing ? "PUT" : "POST";
      const res    = await apiRequest(method, url, body);
      return res.json();
    },
    onSuccess: async () => {
      await IOSFeedbackManager.successNotification();
      toast({ title: isEditing ? "Activity updated" : "Activity logged" });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/month"] });
      if (!isEditing) {
        setDistance(""); setNotes(""); setAvgPower("");
      }
    },
    onError: async (err: Error) => {
      await IOSFeedbackManager.errorNotification();
      toast({ title: "Error saving activity", description: err.message, variant: "destructive" });
    },
  });

  // ─── Auto-calculation helpers ────────────────────────────────────────────────

  const handleTimeDone = () => {
    setShowTimePopup(false);
    if (!cfg.showPace) return;
    const dist = parseFloat(distance);
    const timeSec = timeHours * 3600 + timeMinutes * 60;
    if (dist > 0 && timeSec > 0) {
      const pacePerUnit = timeSec / dist;
      let mins = Math.floor(pacePerUnit / 60);
      let secs = Math.round(pacePerUnit % 60);
      if (secs === 60) { mins++; secs = 0; }
      setPaceMinutes(mins);
      setPaceSeconds(secs);
      setPaceAutoCalced(true);
    }
    setTimeAutoCalced(false);
  };

  const handlePaceDone = () => {
    setShowPacePopup(false);
    const dist = parseFloat(distance);
    const paceSec = paceMinutes * 60 + paceSeconds;
    if (dist > 0 && paceSec > 0) {
      const totalSec = paceSec * dist;
      setTimeHours(Math.floor(totalSec / 3600));
      setTimeMinutes(Math.round((totalSec % 3600) / 60));
      setTimeAutoCalced(true);
    }
    setPaceAutoCalced(false);
  };

  const handleDistanceBlur = () => {
    if (!cfg.showPace) return;
    const dist = parseFloat(distance);
    if (!dist || dist <= 0) return;
    const timeSec = timeHours * 3600 + timeMinutes * 60;
    const paceSec = paceMinutes * 60 + paceSeconds;
    if (timeSec > 0 && !timeAutoCalced) {
      // Time was manually set → derive pace
      const pacePerUnit = timeSec / dist;
      let mins = Math.floor(pacePerUnit / 60);
      let secs = Math.round(pacePerUnit % 60);
      if (secs === 60) { mins++; secs = 0; }
      setPaceMinutes(mins);
      setPaceSeconds(secs);
      setPaceAutoCalced(true);
    } else if (paceSec > 0 && !paceAutoCalced) {
      // Pace was manually set → derive time
      const totalSec = paceSec * dist;
      setTimeHours(Math.floor(totalSec / 3600));
      setTimeMinutes(Math.round((totalSec % 3600) / 60));
      setTimeAutoCalced(true);
    }
  };

  const avgSpeedDisplay = (() => {
    const dist = parseFloat(distance);
    const timeSec = timeHours * 3600 + timeMinutes * 60;
    if (!(dist > 0) || timeSec <= 0) return null;
    const speed = (dist / (timeSec / 3600)).toFixed(1);
    return `${speed} ${distUnit === "km" ? "km/h" : "mph"}`;
  })();

  const handleSubmit = () => {
    const distNum = parseFloat(distance);
    if (!distance || isNaN(distNum) || distNum <= 0) {
      toast({ title: "Enter a valid distance", variant: "destructive" });
      return;
    }
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (new Date(dateStr) > today) {
      toast({ title: "Cannot log future activities", variant: "destructive" });
      return;
    }
    const body: Record<string, unknown> = {
      sportType: sport,
      distanceUnit: distUnit,
      distance: distNum,
      paceMinutes: cfg.showPace ? paceMinutes : 0,
      paceSeconds: cfg.showPace ? paceSeconds : 0,
      timeHours,
      timeMinutes,
      runType: workoutType,
      notes: notes || null,
      date: dateStr,
    };
    if (cfg.showPower && avgPower) {
      const p = parseInt(avgPower);
      if (!isNaN(p)) body.averagePower = p;
    }
    saveMutation.mutate(body);
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto px-5 pb-28">
      <div className="pt-14 pb-4">
        <h1 className="text-2xl font-bold text-foreground">{isEditing ? "Edit Activity" : "Log Activity"}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Record your workout</p>
      </div>

      {/* Sport selector */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar">
        {(Object.keys(SPORT_CFG) as SportKey[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => handleSportChange(s)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-2xl font-semibold text-sm flex-shrink-0 transition-all active:scale-95 ${
              sport === s ? "bg-skyblue text-white shadow-md" : "bg-surface-raised text-muted-foreground shadow-sm"
            }`}
          >
            <span>{SPORT_CFG[s].emoji}</span>
            <span>{SPORT_CFG[s].label}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {/* Date */}
        <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
          <label className="text-sm font-medium text-muted-foreground mb-2 block">Date</label>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="box-border w-full max-w-full min-w-0 appearance-none bg-surface-elevated rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-skyblue/30 [color-scheme:dark]"
          />
        </div>

        {/* Distance + unit toggle */}
        <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-muted-foreground">Distance</label>
            {/* Unit toggle */}
            <div className="flex rounded-xl overflow-hidden border border-border">
              <button
                type="button"
                onClick={() => setDistUnit(cfg.defaultUnit)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  distUnit === cfg.defaultUnit ? "bg-skyblue text-white" : "bg-surface-elevated text-muted-foreground"
                }`}
              >
                {cfg.unitLabel(cfg.defaultUnit)}
              </button>
              <button
                type="button"
                onClick={() => setDistUnit(cfg.altUnit)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  distUnit === cfg.altUnit ? "bg-skyblue text-white" : "bg-surface-elevated text-muted-foreground"
                }`}
              >
                {cfg.unitLabel(cfg.altUnit)}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              placeholder="0.0"
              value={distance}
              onChange={(e) => { setDistance(e.target.value); setPaceAutoCalced(false); setTimeAutoCalced(false); }}
              onBlur={handleDistanceBlur}
              className="flex-1 bg-surface-elevated rounded-xl px-4 py-3 text-lg font-semibold text-center text-foreground outline-none focus:ring-2 focus:ring-skyblue/30"
            />
            <span className="text-muted-foreground font-medium text-sm w-10">{cfg.unitLabel(distUnit)}</span>
          </div>
        </div>

        {/* Pace (running, swimming, triathlon) */}
        {cfg.showPace && (
          <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-muted-foreground mb-3">
              Pace <span className="text-xs">({cfg.paceLabel(distUnit)})</span>
              {paceAutoCalced && <span className="ml-2 text-xs text-skyblue font-medium">auto</span>}
            </label>
            <div
              onClick={() => setShowPacePopup(true)}
              className="bg-surface-elevated rounded-xl px-4 py-4 text-center cursor-pointer active:bg-surface"
            >
              <div className="text-2xl font-semibold text-foreground">
                {paceMinutes}:{String(paceSeconds).padStart(2, "0")}
              </div>
              <div className="text-sm text-muted-foreground mt-1">{cfg.paceLabel(distUnit)}</div>
            </div>
          </div>
        )}

        {/* Avg power (cycling only) */}
        {cfg.showPower && (
          <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-muted-foreground mb-3">
              Avg Power <span className="text-xs text-muted-foreground">(watts — optional)</span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="e.g. 220"
              value={avgPower}
              onChange={(e) => setAvgPower(e.target.value)}
              className="w-full bg-surface-elevated rounded-xl px-4 py-3 text-lg font-semibold text-center text-foreground outline-none focus:ring-2 focus:ring-skyblue/30"
            />
          </div>
        )}

        {/* Time */}
        <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
          <label className="block text-sm font-medium text-muted-foreground mb-3">
            Total Time
            {timeAutoCalced && <span className="ml-2 text-xs text-skyblue font-medium">auto</span>}
          </label>
          <div
            onClick={() => setShowTimePopup(true)}
            className="bg-surface-elevated rounded-xl px-4 py-4 text-center cursor-pointer active:bg-surface"
          >
            <div className="text-2xl font-semibold text-foreground">
              {timeHours > 0 ? `${timeHours}hr ` : ""}{timeMinutes}min
            </div>
          </div>
        </div>

        {/* Cycling avg speed (calculated) */}
        {sport === "cycling" && avgSpeedDisplay && (
          <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-muted-foreground mb-3">
              Avg Speed <span className="ml-1 text-xs text-skyblue font-medium">calculated</span>
            </label>
            <div className="bg-surface-elevated rounded-xl px-4 py-4 text-center">
              <div className="text-2xl font-semibold text-foreground">{avgSpeedDisplay}</div>
            </div>
          </div>
        )}

        {/* Workout Type */}
        <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
          <label className="block text-sm font-medium text-muted-foreground mb-3">Workout Type</label>
          <div className="grid grid-cols-2 gap-2">
            {cfg.workoutTypes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={async () => { setWorkoutType(t.value); await IOSFeedbackManager.lightImpact(); }}
                className={`py-3 px-4 rounded-xl font-medium text-sm transition-all active:scale-95 ${
                  workoutType === t.value
                    ? "bg-skyblue/10 border-2 border-skyblue text-skyblue"
                    : "bg-surface-raised border-2 border-transparent text-muted-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-surface-raised rounded-2xl p-5 shadow-sm">
          <label className="block text-sm font-medium text-muted-foreground mb-3">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="How did it feel? Any highlights..."
            rows={3}
            className="w-full bg-surface-elevated rounded-xl px-4 py-3 text-sm text-foreground placeholder-muted-foreground resize-none outline-none focus:ring-2 focus:ring-skyblue/30"
          />
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saveMutation.isPending}
          className="w-full flex items-center justify-center bg-skyblue text-white py-4 rounded-2xl font-semibold text-base shadow-lg transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {saveMutation.isPending
            ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            : isEditing ? "Update Activity" : "Log Activity"}
        </button>
      </div>

      {/* Pace popup */}
      <Dialog open={showPacePopup} onOpenChange={setShowPacePopup}>
        <DialogContent className="max-w-sm mx-auto bg-surface rounded-2xl border-border">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-foreground text-center">Set Pace</DialogTitle>
            <DialogDescription className="text-center text-muted-foreground text-sm">
              {cfg.paceLabel(distUnit)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex flex-col items-center">
              <ScrollWheel
                value={paceMinutes}
                onChange={setPaceMinutes}
                min={sport === "swimming" ? 1 : 4}
                max={sport === "swimming" ? 5 : 15}
                className="bg-surface-raised rounded-xl"
              />
              <span className="text-xs text-muted-foreground mt-2">min</span>
            </div>
            <span className="text-2xl font-medium text-muted-foreground pt-8">:</span>
            <div className="flex flex-col items-center">
              <ScrollWheel
                value={paceSeconds}
                onChange={setPaceSeconds}
                min={0}
                max={59}
                className="bg-surface-raised rounded-xl"
              />
              <span className="text-xs text-muted-foreground mt-2">sec</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handlePaceDone}
            className="w-full bg-skyblue text-white py-3 rounded-xl font-medium"
          >
            Done
          </button>
        </DialogContent>
      </Dialog>

      {/* Time popup */}
      <Dialog open={showTimePopup} onOpenChange={setShowTimePopup}>
        <DialogContent className="max-w-sm mx-auto bg-surface rounded-2xl border-border">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-foreground text-center">Set Duration</DialogTitle>
            <DialogDescription className="text-center text-muted-foreground text-sm">
              Total moving time
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-4 py-4">
            <div className="flex flex-col items-center">
              <ScrollWheel value={timeHours} onChange={setTimeHours} min={0} max={12} className="bg-surface-raised rounded-xl" />
              <span className="text-xs text-muted-foreground mt-2">hr</span>
            </div>
            <div className="flex flex-col items-center">
              <ScrollWheel value={timeMinutes} onChange={setTimeMinutes} min={0} max={59} className="bg-surface-raised rounded-xl" />
              <span className="text-xs text-muted-foreground mt-2">min</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleTimeDone}
            className="w-full bg-skyblue text-white py-3 rounded-xl font-medium"
          >
            Done
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
