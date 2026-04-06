import { Encoder } from "@garmin/fitsdk";
import FIT from "@garmin/fitsdk/src/fit.js";
import Profile from "@garmin/fitsdk/src/profile.js";
import type { PlanWorkout } from "@shared/schema";

type FitSport = number;

const SPORT_MAP: Record<string, FitSport> = {
  running: 1,
  cycling: 2,
  swimming: 5,
  triathlon: 43,
};

const SUB_SPORT_MAP: Record<string, number> = {
  easy: 0,       // generic
  tempo: 0,
  long: 0,
  interval: 27,  // track
  threshold: 0,
  fartlek: 0,
  trail: 9,      // trail
  race: 17,      // race
  recovery: 0,
  strides: 0,
  easy_ride: 0,
  tempo_ride: 0,
  long_ride: 0,
  interval_ride: 0,
  hill_ride: 11,
  sweet_spot: 0,
  race_ride: 17,
  recovery_ride: 0,
  easy_swim: 0,
  threshold_swim: 0,
  interval_swim: 0,
  open_water_swim: 18,
  drill: 0,
  race_swim: 17,
  css_test: 0,
  brick: 0,
  transition: 0,
  other: 0,
};

function workoutTypeToSport(workoutType: string): FitSport {
  if (workoutType.includes("ride") || workoutType.includes("sweet_spot")) return SPORT_MAP.cycling;
  if (workoutType.includes("swim") || workoutType === "drill" || workoutType === "css_test") return SPORT_MAP.swimming;
  if (workoutType === "brick" || workoutType === "transition") return SPORT_MAP.triathlon;
  return SPORT_MAP.running;
}

function paceToSpeedMps(paceMin: number, paceSec: number): number {
  const totalSeconds = paceMin * 60 + paceSec;
  if (totalSeconds <= 0) return 0;
  const milesToMeters = 1609.344;
  return milesToMeters / totalSeconds;
}

/**
 * Generate a Garmin .fit workout file from a Vista plan workout.
 * The file can be uploaded to Garmin Connect or transferred to a watch.
 */
export function generateWorkoutFit(workout: PlanWorkout): Uint8Array {
  const encoder = new Encoder();

  const now = new Date();
  const sport = workoutTypeToSport(workout.workoutType);
  const subSport = SUB_SPORT_MAP[workout.workoutType] ?? 0;

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: FIT.File.WORKOUT,
    manufacturer: FIT.Manufacturer.DEVELOPMENT,
    product: 1,
    serialNumber: Math.floor(Math.random() * 0xffffffff),
    timeCreated: now,
  });

  const numSteps = buildSteps(workout).length;

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.WORKOUT,
    sport,
    subSport,
    wktName: workout.title.slice(0, 40),
    numValidSteps: numSteps,
  });

  const steps = buildSteps(workout);
  steps.forEach((step, idx) => {
    encoder.writeMesg({
      mesgNum: Profile.MesgNum.WORKOUT_STEP,
      messageIndex: idx,
      wktStepName: step.name,
      durationType: step.durationType,
      durationValue: step.durationValue,
      targetType: step.targetType,
      targetValue: step.targetValue,
      customTargetValueLow: step.targetLow,
      customTargetValueHigh: step.targetHigh,
      intensity: step.intensity,
    });
  });

  return encoder.close();
}

interface WorkoutStep {
  name: string;
  durationType: number;
  durationValue: number;
  targetType: number;
  targetValue: number;
  targetLow: number;
  targetHigh: number;
  intensity: number;
}

function buildSteps(workout: PlanWorkout): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  const durationMinutes = workout.targetDurationMinutes ?? 30;
  const hasPace = workout.targetPaceMin != null && workout.targetPaceSec != null;

  if (isWarmupType(workout.workoutType)) {
    steps.push({
      name: "Warm Up",
      durationType: 0, // time
      durationValue: 10 * 60 * 1000,
      targetType: hasPace ? 0 : 1, // speed or heart_rate open
      targetValue: 0,
      targetLow: 0,
      targetHigh: 0,
      intensity: 1, // warmup
    });

    const mainDuration = Math.max((durationMinutes - 20) * 60 * 1000, 10 * 60 * 1000);
    steps.push({
      name: workout.title.slice(0, 20),
      durationType: 0,
      durationValue: mainDuration,
      targetType: hasPace ? 0 : 1,
      targetValue: 0,
      targetLow: hasPace ? paceToSpeedMps(workout.targetPaceMin! + 0, workout.targetPaceSec! + 15) * 1000 : 0,
      targetHigh: hasPace ? paceToSpeedMps(workout.targetPaceMin!, workout.targetPaceSec!) * 1000 : 0,
      intensity: 0, // active
    });

    steps.push({
      name: "Cool Down",
      durationType: 0,
      durationValue: 10 * 60 * 1000,
      targetType: 1,
      targetValue: 0,
      targetLow: 0,
      targetHigh: 0,
      intensity: 3, // cooldown
    });
  } else {
    const targetSpeed = hasPace ? paceToSpeedMps(workout.targetPaceMin!, workout.targetPaceSec!) * 1000 : 0;
    steps.push({
      name: workout.title.slice(0, 24),
      durationType: 0,
      durationValue: durationMinutes * 60 * 1000,
      targetType: hasPace ? 0 : 1,
      targetValue: 0,
      targetLow: hasPace ? targetSpeed * 0.95 : 0,
      targetHigh: hasPace ? targetSpeed * 1.05 : 0,
      intensity: isEasyType(workout.workoutType) ? 0 : 0,
    });
  }

  return steps;
}

function isWarmupType(wt: string): boolean {
  return ["tempo", "interval", "threshold", "fartlek", "tempo_ride", "interval_ride",
    "hill_ride", "sweet_spot", "threshold_swim", "interval_swim", "css_test", "race"].includes(wt);
}

function isEasyType(wt: string): boolean {
  return ["easy", "recovery", "easy_ride", "recovery_ride", "easy_swim", "drill"].includes(wt);
}
