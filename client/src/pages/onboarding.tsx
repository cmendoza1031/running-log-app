import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { SCREEN_EDGE_PADDING_BOTTOM, SCREEN_EDGE_PADDING_TOP } from "@/lib/auth-screen-layout";
import { useToast } from "@/hooks/use-toast";
import type { SportType, FitnessLevel } from "@shared/schema";

// ─── Config ───────────────────────────────────────────────────────────────────

const SPORTS: { id: SportType; emoji: string; label: string; description: string }[] = [
  { id: "running", emoji: "🏃", label: "Running", description: "Road, track, trail, treadmill" },
  { id: "cycling", emoji: "🚴", label: "Cycling", description: "Road, gravel, MTB, indoor" },
  { id: "swimming", emoji: "🏊", label: "Swimming", description: "Pool & open water" },
  { id: "triathlon", emoji: "🏅", label: "Triathlete", description: "Sprint through Ironman" },
];

const LEVELS: { id: FitnessLevel; label: string; description: string }[] = [
  { id: "beginner", label: "Just Starting", description: "Building base fitness, less than 1 year" },
  { id: "intermediate", label: "Intermediate", description: "Consistent training, 1–3 years" },
  { id: "advanced", label: "Advanced", description: "Competitive, structured training" },
  { id: "elite", label: "Elite / Sub-Elite", description: "Racing at a high level" },
];

const HOURS_OPTIONS = [
  { value: "3", label: "< 5 hrs/week", sub: "Casual" },
  { value: "7", label: "5–10 hrs/week", sub: "Moderate" },
  { value: "12", label: "10–15 hrs/week", sub: "Serious" },
  { value: "18", label: "15+ hrs/week", sub: "High volume" },
];

function getGoalPlaceholder(sports: SportType[]): string {
  if (sports.includes("triathlon")) return "e.g. Ironman 70.3, Sprint Tri, Olympic Distance";
  if (sports.includes("cycling") && sports.includes("running")) return "e.g. Marathon, Gran Fondo, Duathlon";
  if (sports.includes("cycling")) return "e.g. Gran Fondo, Century Ride, FTP goal";
  if (sports.includes("swimming")) return "e.g. 1-mile open water, Masters meet, CSS goal";
  return "e.g. Boston Marathon, Sub-20 5K, First Half Marathon";
}

// ─── Step components ──────────────────────────────────────────────────────────

function SportStep({
  selected,
  onToggle,
}: {
  selected: SportType[];
  onToggle: (s: SportType) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-foreground mb-1">What do you train?</h2>
      <p className="text-muted-foreground text-sm mb-4">Select all that apply — your coach will be tailored to your sports</p>
      <div className="grid grid-cols-2 gap-2.5">
        {SPORTS.map((sport) => {
          const isSelected = selected.includes(sport.id);
          return (
            <button
              key={sport.id}
              onClick={() => { onToggle(sport.id); IOSFeedbackManager.lightImpact(); }}
              className={`relative flex flex-col items-start rounded-2xl border-2 p-3.5 text-left transition-all active:scale-95 ${
                isSelected
                  ? "border-skyblue bg-skyblue/10"
                  : "border-transparent bg-surface-raised shadow-sm"
              }`}
            >
              {isSelected && (
                <div className="absolute top-2.5 right-2.5 w-5 h-5 bg-skyblue rounded-full flex items-center justify-center">
                  <Check size={11} className="text-white" strokeWidth={3} />
                </div>
              )}
              <span className="text-2xl mb-2">{sport.emoji}</span>
              <span className="font-semibold text-foreground text-sm">{sport.label}</span>
              <span className="text-muted-foreground text-xs mt-0.5">{sport.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LevelStep({
  selected,
  onSelect,
}: {
  selected: FitnessLevel;
  onSelect: (l: FitnessLevel) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-foreground mb-1">Your experience level?</h2>
      <p className="text-muted-foreground text-sm mb-4">This helps your coach calibrate recommendations</p>
      <div className="space-y-3">
        {LEVELS.map((level) => {
          const isSelected = selected === level.id;
          return (
            <button
              key={level.id}
              onClick={() => { onSelect(level.id); IOSFeedbackManager.lightImpact(); }}
              className={`w-full flex items-center p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${
                isSelected
                  ? "border-skyblue bg-skyblue/10"
                  : "border-transparent bg-surface-raised shadow-sm"
              }`}
            >
              <div className="flex-1">
                <p className="font-semibold text-foreground">{level.label}</p>
                <p className="text-muted-foreground text-sm">{level.description}</p>
              </div>
              {isSelected && (
                <div className="w-6 h-6 bg-skyblue rounded-full flex items-center justify-center ml-3 flex-shrink-0">
                  <Check size={12} className="text-white" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HoursStep({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (h: string) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-foreground mb-1">Training time per week?</h2>
      <p className="text-muted-foreground text-sm mb-4">Across all sports combined — your plan will respect this</p>
      <div className="space-y-3">
        {HOURS_OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); IOSFeedbackManager.lightImpact(); }}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${
                isSelected
                  ? "border-skyblue bg-skyblue/10"
                  : "border-transparent bg-surface-raised shadow-sm"
              }`}
            >
              <div>
                <p className="font-semibold text-foreground">{opt.label}</p>
                <p className="text-muted-foreground text-sm">{opt.sub}</p>
              </div>
              {isSelected && (
                <div className="w-6 h-6 bg-skyblue rounded-full flex items-center justify-center flex-shrink-0">
                  <Check size={12} className="text-white" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoalStep({
  goal,
  onChange,
  goalDate,
  onDateChange,
  placeholder,
}: {
  goal: string;
  onChange: (v: string) => void;
  goalDate: string;
  onDateChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-foreground mb-1">What's your goal?</h2>
      <p className="text-muted-foreground text-sm mb-4">Optional — give your coach a target to work toward</p>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
            Target Event or Race
          </label>
          <input
            value={goal}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-surface-raised rounded-2xl px-4 py-4 text-sm text-foreground placeholder-muted-foreground outline-none border border-transparent focus:border-skyblue transition-colors shadow-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">
            Event Date (optional)
          </label>
          <input
            type="date"
            value={goalDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full bg-surface-raised rounded-2xl px-4 py-4 text-sm text-foreground outline-none border border-transparent focus:border-skyblue transition-colors shadow-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground text-center">
          You can always update this in Settings. Your coach will ask clarifying questions too.
        </p>
      </div>
    </div>
  );
}

// ─── Main Onboarding ──────────────────────────────────────────────────────────

interface OnboardingProps {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const [sports, setSports] = useState<SportType[]>(["running"]);
  const [level, setLevel] = useState<FitnessLevel>("intermediate");
  const [hours, setHours] = useState("7");
  const [goal, setGoal] = useState("");
  const [goalDate, setGoalDate] = useState("");

  const STEPS = 4;
  const progress = ((step + 1) / STEPS) * 100;
  const goalPlaceholder = useMemo(() => getGoalPlaceholder(sports), [sports]);

  const toggleSport = (s: SportType) => {
    setSports((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const getStepError = () => {
    if (step === 0 && sports.length === 0) return "Pick at least one sport to continue.";
    return null;
  };

  const saveProfile = async (overrideGoal?: string) => {
    setSaving(true);
    await IOSFeedbackManager.mediumImpact();
    try {
      const primarySport = sports.includes("triathlon") ? "triathlon" : sports[0];
      const finalGoal = overrideGoal !== undefined ? overrideGoal : goal;
      await apiRequest("PUT", "/api/profile", {
        sports,
        primarySport,
        fitnessLevel: level,
        weeklyHoursGoal: hours,
        targetRace: finalGoal || undefined,
        targetRaceDate: goalDate || undefined,
        onboardingComplete: true,
      });
      qc.invalidateQueries({ queryKey: ["/api/profile"] });
      await IOSFeedbackManager.successNotification();
      onComplete();
    } catch {
      await IOSFeedbackManager.errorNotification();
      toast({
        title: "Couldn't save your profile",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    const err = getStepError();
    if (err) {
      setStepError(err);
      await IOSFeedbackManager.errorNotification();
      return;
    }
    setStepError(null);

    if (step < STEPS - 1) {
      await IOSFeedbackManager.mediumImpact();
      setStep((s) => s + 1);
      return;
    }

    await saveProfile();
  };

  const goBack = () => {
    setStepError(null);
    setStep((s) => Math.max(0, s - 1));
    void IOSFeedbackManager.lightImpact();
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface px-6 overscroll-none"
      style={{ paddingTop: SCREEN_EDGE_PADDING_TOP }}
    >
      <header className="mb-4 shrink-0">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Step {step + 1} of {STEPS}
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full rounded-full bg-skyblue"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </header>

      <div
        className={
          step === STEPS - 1
            ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch]"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
            className={
              step === STEPS - 1
                ? "pb-4"
                : "flex min-h-0 flex-1 flex-col justify-center"
            }
          >
            {step === 0 && <SportStep selected={sports} onToggle={toggleSport} />}
            {step === 1 && <LevelStep selected={level} onSelect={setLevel} />}
            {step === 2 && <HoursStep selected={hours} onSelect={setHours} />}
            {step === 3 && (
              <GoalStep
                goal={goal}
                onChange={setGoal}
                goalDate={goalDate}
                onDateChange={setGoalDate}
                placeholder={goalPlaceholder}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer
        className="flex shrink-0 flex-col gap-2 pt-3"
        style={{ paddingBottom: SCREEN_EDGE_PADDING_BOTTOM }}
      >
        {stepError && (
          <p className="text-center text-sm font-medium text-red-500">{stepError}</p>
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-skyblue py-4 text-base font-semibold text-white shadow-lg transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : step === STEPS - 1 ? (
            <>
              Meet Your Coach <span className="text-lg">🏃</span>
            </>
          ) : (
            <>
              Continue <ArrowRight size={18} />
            </>
          )}
        </button>
        {step > 0 && (
          <button
            type="button"
            onClick={goBack}
            disabled={saving}
            className="w-full rounded-2xl border border-border bg-transparent py-3.5 text-base font-medium text-foreground active:bg-surface-raised disabled:opacity-40"
          >
            Back
          </button>
        )}
        {step === STEPS - 1 && (
          <button
            type="button"
            onClick={() => saveProfile("")}
            disabled={saving}
            className="w-full py-2 text-center text-sm text-muted-foreground"
          >
            Skip for now
          </button>
        )}
      </footer>
    </div>
  );
}
