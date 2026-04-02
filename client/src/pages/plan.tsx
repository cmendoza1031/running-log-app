import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight, Target, Clock, MapPin, CheckCircle, Bot, Loader2 } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isBefore, isToday } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import type { TrainingPlan, PlanWorkout } from "@shared/schema";
import { IOSFeedbackManager } from "@/lib/ios-utils";

const WORKOUT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  easy: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  tempo: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-400" },
  long: { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  interval: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-400" },
  threshold: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" },
  trail: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  race: { bg: "bg-pink-50", text: "text-pink-700", dot: "bg-pink-500" },
  recovery: { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-400" },
  rest: { bg: "bg-gray-50", text: "text-gray-400", dot: "bg-gray-300" },
  other: { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400" },
};

interface PlanResponse {
  plan: TrainingPlan;
  workouts: PlanWorkout[];
}

export default function PlanPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedWorkout, setSelectedWorkout] = useState<PlanWorkout | null>(null);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const { data: activePlan, isLoading: planLoading } = useQuery<PlanResponse | null>({
    queryKey: ["/api/plans/active"],
  });

  const { data: monthWorkouts = [], isLoading: workoutsLoading } = useQuery<PlanWorkout[]>({
    queryKey: ["/api/plans/workouts/month", year, month],
    enabled: !!activePlan,
  });

  const completeMutation = useMutation({
    mutationFn: async (workoutId: string) => {
      const res = await apiRequest("PATCH", `/api/plans/workouts/${workoutId}/complete`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/plans/workouts/month"] });
      IOSFeedbackManager.successNotification();
    },
  });

  const navigateMonth = (dir: "prev" | "next") => {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + (dir === "next" ? 1 : -1));
    setCurrentDate(d);
    IOSFeedbackManager.lightImpact();
  };

  // Build calendar grid
  const firstDay = startOfMonth(currentDate);
  const lastDay = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: firstDay, end: lastDay });
  // Pad to start on Monday
  const startPadding = (getDay(firstDay) + 6) % 7;
  const paddedDays = [...Array(startPadding).fill(null), ...days];

  const getWorkoutsForDay = (date: Date) =>
    monthWorkouts.filter((w) => isSameDay(parseISO(w.date), date));

  const plan = activePlan?.plan;

  return (
    <div className="px-5 pb-28" data-testid="plan-page">
      {/* Header */}
      <div className="pt-14 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Training Plan</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your personalized schedule</p>
      </div>

      {planLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-skyblue animate-spin" />
        </div>
      ) : !plan ? (
        <NoPlanView onNavigateToCoach={() => setLocation("/coach")} />
      ) : (
        <>
          {/* Plan Info Card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-br from-skyblue to-blue-600 rounded-2xl p-4 mb-5 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 mr-2">
                <p className="text-blue-100 text-xs font-medium uppercase tracking-wide mb-0.5">Active Plan</p>
                <h2 className="text-white font-bold text-lg leading-tight">{plan.title}</h2>
                {plan.goal && (
                  <p className="text-blue-100 text-sm mt-1">{plan.goal}</p>
                )}
              </div>
              <div className="bg-white/20 rounded-xl p-2.5">
                <Target size={20} className="text-white" />
              </div>
            </div>
            {(plan.startDate || plan.endDate) && (
              <div className="flex items-center gap-1 mt-3">
                <Calendar size={12} className="text-blue-200" />
                <p className="text-blue-100 text-xs">
                  {plan.startDate && format(parseISO(plan.startDate), "MMM d")}
                  {" – "}
                  {plan.endDate && format(parseISO(plan.endDate), "MMM d, yyyy")}
                </p>
              </div>
            )}
            {plan.raceName && (
              <div className="flex items-center gap-1 mt-1">
                <MapPin size={12} className="text-blue-200" />
                <p className="text-blue-100 text-xs">{plan.raceName}</p>
              </div>
            )}
          </motion.div>

          {/* Calendar */}
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => navigateMonth("prev")} className="p-2 text-skyblue">
                <ChevronLeft size={18} />
              </button>
              <h3 className="font-semibold text-gray-800">
                {format(currentDate, "MMMM yyyy")}
              </h3>
              <button onClick={() => navigateMonth("next")} className="p-2 text-skyblue">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Day labels */}
            <div className="grid grid-cols-7 mb-2">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div key={i} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-y-1">
              {paddedDays.map((day, i) => {
                if (!day) return <div key={`pad-${i}`} />;

                const workouts = getWorkoutsForDay(day);
                const isPast = isBefore(day, new Date()) && !isToday(day);
                const isCurrentDay = isToday(day);
                const primaryWorkout = workouts[0];
                const colors = primaryWorkout ? (WORKOUT_COLORS[primaryWorkout.workoutType] ?? WORKOUT_COLORS.other) : null;

                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => {
                      if (primaryWorkout) {
                        setSelectedWorkout(primaryWorkout);
                        IOSFeedbackManager.lightImpact();
                      }
                    }}
                    className={`relative flex flex-col items-center justify-start py-2 rounded-xl transition-all active:scale-90 min-h-[52px] ${
                      isCurrentDay ? "ring-2 ring-skyblue ring-offset-1" : ""
                    } ${primaryWorkout ? `${colors!.bg} ${colors!.text}` : ""} ${isPast && !primaryWorkout ? "opacity-40" : ""}`}
                  >
                    <span className={`text-xs font-semibold mb-0.5 ${isCurrentDay ? "text-skyblue" : primaryWorkout ? colors!.text : "text-gray-400"}`}>
                      {format(day, "d")}
                    </span>
                    {primaryWorkout && (
                      <>
                        <div className={`w-1.5 h-1.5 rounded-full ${colors!.dot}`} />
                        {primaryWorkout.isCompleted && (
                          <CheckCircle size={10} className="text-green-500 mt-0.5" />
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="bg-white rounded-xl p-3 mb-4 shadow-sm">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(WORKOUT_COLORS).filter(([k]) => k !== "rest" && k !== "other").map(([type, colors]) => (
                <div key={type} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                  <span className="text-xs text-gray-600 capitalize">{type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming workouts list */}
          <UpcomingWorkouts workouts={monthWorkouts} onWorkoutPress={setSelectedWorkout} />
        </>
      )}

      {/* Workout Detail Sheet */}
      {selectedWorkout && (
        <WorkoutSheet
          workout={selectedWorkout}
          onClose={() => setSelectedWorkout(null)}
          onComplete={(id) => completeMutation.mutate(id)}
          completing={completeMutation.isPending}
        />
      )}
    </div>
  );
}

function NoPlanView({ onNavigateToCoach }: { onNavigateToCoach: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-skyblue to-blue-600 flex items-center justify-center shadow-lg mb-4">
        <Bot size={28} className="text-white" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">No Plan Yet</h2>
      <p className="text-gray-500 text-sm max-w-xs mb-6">
        Your AI coach can build you a personalized training plan based on your current fitness and goals.
      </p>
      <button
        onClick={onNavigateToCoach}
        className="bg-skyblue text-white px-6 py-3 rounded-2xl font-semibold text-sm active:scale-95 transition-transform shadow-lg"
      >
        Ask Coach to Build Plan
      </button>
    </motion.div>
  );
}

function UpcomingWorkouts({ workouts, onWorkoutPress }: { workouts: PlanWorkout[]; onWorkoutPress: (w: PlanWorkout) => void }) {
  const today = new Date();
  const upcoming = workouts
    .filter((w) => !isBefore(parseISO(w.date), today) || isToday(parseISO(w.date)))
    .filter((w) => !w.isCompleted)
    .slice(0, 5);

  if (!upcoming.length) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2 px-1">Upcoming Workouts</h3>
      <div className="space-y-2">
        {upcoming.map((workout) => {
          const colors = WORKOUT_COLORS[workout.workoutType] ?? WORKOUT_COLORS.other;
          return (
            <button
              key={workout.id}
              onClick={() => { onWorkoutPress(workout); IOSFeedbackManager.lightImpact(); }}
              className="w-full bg-white rounded-2xl p-3.5 shadow-sm text-left flex items-center gap-3 active:scale-95 transition-transform"
            >
              <div className={`w-10 h-10 rounded-xl ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm truncate">{workout.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {format(parseISO(workout.date), "EEE, MMM d")}
                  {workout.targetDistance && ` · ${workout.targetDistance} mi`}
                </p>
              </div>
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorkoutSheet({
  workout,
  onClose,
  onComplete,
  completing,
}: {
  workout: PlanWorkout;
  onClose: () => void;
  onComplete: (id: string) => void;
  completing: boolean;
}) {
  const colors = WORKOUT_COLORS[workout.workoutType] ?? WORKOUT_COLORS.other;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="relative bg-white w-full max-w-sm mx-auto rounded-t-3xl p-5 pb-10 shadow-2xl z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl ${colors.bg} mb-3`}>
          <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
          <span className={`text-xs font-semibold capitalize ${colors.text}`}>{workout.workoutType}</span>
        </div>

        <h2 className="text-xl font-bold text-gray-900 mb-1">{workout.title}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {format(parseISO(workout.date), "EEEE, MMMM d")}
        </p>

        {workout.description && (
          <p className="text-sm text-gray-700 leading-relaxed mb-4 bg-gray-50 rounded-xl p-3">
            {workout.description}
          </p>
        )}

        <div className="flex gap-3 mb-4">
          {workout.targetDistance && (
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl px-3 py-2">
              <MapPin size={13} className="text-skyblue" />
              <span className="text-xs font-semibold text-skyblue">{workout.targetDistance} mi</span>
            </div>
          )}
          {(workout.targetPaceMin != null) && (
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl px-3 py-2">
              <Clock size={13} className="text-skyblue" />
              <span className="text-xs font-semibold text-skyblue">
                {workout.targetPaceMin}:{String(workout.targetPaceSec ?? 0).padStart(2, "0")}/mi
              </span>
            </div>
          )}
          {workout.targetDurationMinutes && (
            <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl px-3 py-2">
              <Clock size={13} className="text-skyblue" />
              <span className="text-xs font-semibold text-skyblue">{workout.targetDurationMinutes} min</span>
            </div>
          )}
        </div>

        {!workout.isCompleted ? (
          <button
            onClick={() => onComplete(workout.id)}
            disabled={completing}
            className="w-full bg-green-500 text-white py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            {completing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <><CheckCircle size={16} /> Mark as Complete</>
            )}
          </button>
        ) : (
          <div className="w-full bg-green-50 text-green-600 py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2">
            <CheckCircle size={16} /> Completed
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
