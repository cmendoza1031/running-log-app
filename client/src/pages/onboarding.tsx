import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { IOSFeedbackManager } from "@/lib/ios-utils";
import { useToast } from "@/hooks/use-toast";
import type { SportType, FitnessLevel } from "@shared/schema";

// ─── Config ───────────────────────────────────────────────────────────────────

const SPORTS: { id: SportType; emoji: string; label: string; description: string }[] = [
  { id: "running", emoji: "🏃", label: "Running", description: "Road, track, or treadmill" },
  { id: "trail_running", emoji: "🏔️", label: "Trail Running", description: "Trails & mountain runs" },
  { id: "cycling", emoji: "🚴", label: "Cycling", description: "Road, gravel, or MTB" },
  { id: "swimming", emoji: "🏊", label: "Swimming", description: "Pool or open water" },
  { id: "triathlon", emoji: "🥇", label: "Triathlon", description: "Duathlon, sprint to Ironman" },
  { id: "open_water", emoji: "🌊", label: "Open Water", description: "Open water swim events" },
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
      <h2 className="text-2xl font-bold text-gray-900 mb-1">What do you train?</h2>
      <p className="text-gray-500 text-sm mb-6">Select all that apply — your coach will be tailored to your sports</p>
      <div className="grid grid-cols-2 gap-3">
        {SPORTS.map((sport) => {
          const isSelected = selected.includes(sport.id);
          return (
            <button
              key={sport.id}
              onClick={() => { onToggle(sport.id); IOSFeedbackManager.lightImpact(); }}
              className={`relative flex flex-col items-start p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${
                isSelected
                  ? "border-skyblue bg-blue-50"
                  : "border-transparent bg-white shadow-sm"
              }`}
            >
              {isSelected && (
                <div className="absolute top-2.5 right-2.5 w-5 h-5 bg-skyblue rounded-full flex items-center justify-center">
                  <Check size={11} className="text-white" strokeWidth={3} />
                </div>
              )}
              <span className="text-2xl mb-2">{sport.emoji}</span>
              <span className="font-semibold text-gray-800 text-sm">{sport.label}</span>
              <span className="text-gray-400 text-xs mt-0.5">{sport.description}</span>
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
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Your experience level?</h2>
      <p className="text-gray-500 text-sm mb-6">This helps your coach calibrate recommendations</p>
      <div className="space-y-3">
        {LEVELS.map((level) => {
          const isSelected = selected === level.id;
          return (
            <button
              key={level.id}
              onClick={() => { onSelect(level.id); IOSFeedbackManager.lightImpact(); }}
              className={`w-full flex items-center p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${
                isSelected
                  ? "border-skyblue bg-blue-50"
                  : "border-transparent bg-white shadow-sm"
              }`}
            >
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{level.label}</p>
                <p className="text-gray-400 text-sm">{level.description}</p>
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
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Training time per week?</h2>
      <p className="text-gray-500 text-sm mb-6">Across all sports combined — your plan will respect this</p>
      <div className="space-y-3">
        {HOURS_OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => { onSelect(opt.value); IOSFeedbackManager.lightImpact(); }}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${
                isSelected
                  ? "border-skyblue bg-blue-50"
                  : "border-transparent bg-white shadow-sm"
              }`}
            >
              <div>
                <p className="font-semibold text-gray-800">{opt.label}</p>
                <p className="text-gray-400 text-sm">{opt.sub}</p>
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
}: {
  goal: string;
  onChange: (v: string) => void;
  goalDate: string;
  onDateChange: (v: string) => void;
}) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">What's your goal?</h2>
      <p className="text-gray-500 text-sm mb-6">Optional — give your coach a target to work toward</p>
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
            Target Event or Race
          </label>
          <input
            value={goal}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. Boston Marathon, Ironman 70.3, Sub-20 5K"
            className="w-full bg-white rounded-2xl px-4 py-4 text-sm text-gray-800 placeholder-gray-400 outline-none border border-transparent focus:border-skyblue transition-colors shadow-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
            Event Date (optional)
          </label>
          <input
            type="date"
            value={goalDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full bg-white rounded-2xl px-4 py-4 text-sm text-gray-800 outline-none border border-transparent focus:border-skyblue transition-colors shadow-sm"
          />
        </div>
        <p className="text-xs text-gray-400 text-center">
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

  const toggleSport = (s: SportType) => {
    setSports((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const canAdvance = () => {
    if (step === 0) return sports.length > 0;
    return true;
  };

  const getStepError = () => {
    if (step === 0 && sports.length === 0) return "Pick at least one sport to continue.";
    return null;
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

    // Final step — save profile
    setSaving(true);
    await IOSFeedbackManager.mediumImpact();
    try {
      const primarySport = sports.includes("triathlon") ? "triathlon" : sports[0];
      await apiRequest("PUT", "/api/profile", {
        sports,
        primarySport,
        fitnessLevel: level,
        weeklyHoursGoal: hours,
        targetRace: goal || undefined,
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

  return (
    <div className="min-h-screen bg-ivory flex flex-col px-6 pt-12 pb-10">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 font-medium">Step {step + 1} of {STEPS}</span>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="text-xs text-gray-400 font-medium active:text-skyblue"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-skyblue rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
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
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* CTA */}
      <div className="mt-8">
        {stepError && (
          <p className="text-red-500 text-sm text-center mb-3 font-medium">{stepError}</p>
        )}
        <button
          onClick={handleNext}
          disabled={saving}
          className="w-full bg-skyblue text-white py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-40 shadow-lg"
        >
          {saving ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : step === STEPS - 1 ? (
            <>Meet Your Coach <span className="text-lg">🏃</span></>
          ) : (
            <>Continue <ArrowRight size={18} /></>
          )}
        </button>
        {step === STEPS - 1 && (
          <button
            onClick={() => { setGoal(""); handleNext(); }}
            className="w-full text-center text-sm text-gray-400 mt-3 py-2"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
