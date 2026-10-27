/**
 * Automatic threshold detection from training data.
 *
 * Policy (mirrors how good coaches treat field data):
 *  - Only raise a threshold on evidence of a better performance; never lower it automatically,
 *    because a missing hard effort isn't proof of lost fitness.
 *  - If the athlete has no value (or only an auto/default one) the detection is applied.
 *  - If the athlete entered the value themselves, the detection becomes a suggestion they accept.
 */
import type { Run } from "@shared/schema";
import {
  type ThresholdMetric,
  type Thresholds,
  toSport,
  vdotFromPerformance,
  thresholdPaceFromVdot,
  vo2AtVelocity,
  formatClock,
} from "@shared/physiology";
import { gradeAdjustedSpeed } from "@shared/training-load";
import { addThreshold, getActivitiesBetween, getThresholdState, todayInTz } from "../data";
import { addDays } from "@shared/training-load";

export interface Detection {
  metric: ThresholdMetric;
  value: number;
  activityId: string | null;
  note: string;
}

function daysAgo(today: string, n: number) {
  return addDays(today, -n);
}

function movingSec(r: Run): number {
  return r.movingTimeSec ?? r.timeHours * 3600 + r.timeMinutes * 60;
}

export function detectThresholds(acts: Run[], current: Thresholds, today: string): Detection[] {
  const out: Detection[] = [];
  const within = (r: Run, days: number) => r.date >= daysAgo(today, days);

  // ── Max HR: highest credible reading in a year (ignore single spikes).
  const maxes = acts
    .filter((r) => within(r, 365) && r.heartRateMax && r.heartRateMax > 120 && r.heartRateMax < 225)
    .map((r) => ({ v: r.heartRateMax!, id: r.id }))
    .sort((a, b) => b.v - a.v);
  if (maxes.length >= 3) {
    const top = maxes[0].v - maxes[1].v <= 6 ? maxes[0] : maxes[1];
    if (!current.maxHr || top.v > current.maxHr) {
      out.push({ metric: "max_hr", value: top.v, activityId: top.id, note: `Highest heart rate recorded in the last year` });
    }
  }
  const maxHr = Math.max(current.maxHr ?? 0, out.find((d) => d.metric === "max_hr")?.value ?? 0) || null;

  // ── FTP from power curve (streams) or NP of hard rides (summary).
  let bestFtp: { v: number; id: string; how: string } | null = null;
  for (const r of acts) {
    if (toSport(r.sportType) !== "bike" || !within(r, 90) || r.hasPowerMeter === false) continue;
    const curve = r.bestEfforts as Record<string, number> | null;
    const cands: [number, string][] = [];
    if (curve?.["1200"]) cands.push([curve["1200"] * 0.95, `95% of your best 20-min power (${curve["1200"]} W)`]);
    if (curve?.["3600"]) cands.push([curve["3600"], `your best 60-min power (${curve["3600"]} W)`]);
    const t = movingSec(r) / 60;
    if (r.normalizedPower && t >= 20 && t <= 90 && !curve) {
      const f = 0.95 + 0.05 * Math.min(1, (t - 20) / 40);
      cands.push([r.normalizedPower * f, `NP ${r.normalizedPower} W over ${Math.round(t)} min`]);
    }
    for (const [v, how] of cands) if (!bestFtp || v > bestFtp.v) bestFtp = { v, id: r.id, how };
  }
  if (bestFtp && (!current.ftp || bestFtp.v >= current.ftp * 1.02)) {
    out.push({ metric: "ftp", value: Math.round(bestFtp.v), activityId: bestFtp.id, note: `Based on ${bestFtp.how}` });
  }

  // ── Run threshold pace via VDOT from best efforts; HR-based estimate as fallback.
  let bestVdot: { v: number; id: string; how: string } | null = null;
  for (const r of acts) {
    if (toSport(r.sportType) !== "run" || !within(r, 120)) continue;
    const bests = r.bestEfforts as Record<string, number> | null;
    if (bests) {
      for (const [m, sec] of Object.entries(bests)) {
        const meters = Number(m);
        if (meters < 1600) continue;
        const v = vdotFromPerformance(meters, sec);
        if (v && (!bestVdot || v > bestVdot.v)) bestVdot = { v, id: r.id, how: `${labelForMeters(meters)} in ${formatClock(sec)}` };
      }
    }
    // Races or hard whole-run efforts
    const dist = r.distanceMeters ?? 0;
    const secs = movingSec(r);
    if ((r.runType === "race" || r.runType === "threshold") && dist >= 3000 && secs > 600) {
      const v = vdotFromPerformance(dist, secs);
      if (v && (!bestVdot || v > bestVdot.v)) bestVdot = { v, id: r.id, how: `${(dist / 1000).toFixed(1)} km ${r.runType} in ${formatClock(secs)}` };
    }
  }
  if (!bestVdot && maxHr) {
    // Submaximal estimate: %VO2 reserve ≈ %HR reserve (Swain). Median of steady recent runs.
    const rest = current.restingHr ?? 55;
    const ests: number[] = [];
    for (const r of acts) {
      if (toSport(r.sportType) !== "run" || !within(r, 42) || !r.heartRateAvg || !r.distanceMeters || r.trainer) continue;
      const secs = movingSec(r);
      if (secs < 1200) continue;
      const hrr = (r.heartRateAvg - rest) / (maxHr - rest);
      if (hrr < 0.55 || hrr > 0.92) continue;
      const v = gradeAdjustedSpeed(r.distanceMeters, secs, r.elevationGainM) * 60;
      ests.push(3.5 + (vo2AtVelocity(v) - 3.5) / hrr);
    }
    if (ests.length >= 3) {
      ests.sort((a, b) => a - b);
      const med = ests[Math.floor(ests.length / 2)];
      bestVdot = { v: med, id: "", how: `heart rate vs. pace on ${ests.length} recent runs` };
    }
  }
  if (bestVdot) {
    const tp = thresholdPaceFromVdot(bestVdot.v);
    if (!current.runThresholdPace || tp <= current.runThresholdPace * 0.98) {
      out.push({ metric: "run_threshold_pace", value: Math.round(tp), activityId: bestVdot.id || null, note: `From ${bestVdot.how} (VDOT ${bestVdot.v.toFixed(1)})` });
    }
    const vo2 = Math.round(bestVdot.v * 10) / 10;
    if (!current.vo2max || vo2 > current.vo2max + 0.5) {
      out.push({ metric: "vo2max", value: vo2, activityId: bestVdot.id || null, note: `Running VDOT from ${bestVdot.how}` });
    }
  }

  // ── Swim CSS: best 1500 m-equivalent pace from continuous swims (Riegel, k=1.05).
  let bestCss: { v: number; id: string; how: string } | null = null;
  for (const r of acts) {
    if (toSport(r.sportType) !== "swim" || !within(r, 90) || !r.distanceMeters || r.distanceMeters < 400) continue;
    const secs = movingSec(r);
    if (secs < 360) continue;
    const t1500 = secs * Math.pow(1500 / r.distanceMeters, 1.05);
    const css = t1500 / 15;
    if (css > 55 && (!bestCss || css < bestCss.v)) bestCss = { v: css, id: r.id, how: `${Math.round(r.distanceMeters)} m in ${formatClock(secs)}` };
  }
  if (bestCss && (!current.swimCss || bestCss.v <= current.swimCss * 0.98)) {
    out.push({ metric: "swim_css", value: Math.round(bestCss.v), activityId: bestCss.id, note: `From ${bestCss.how}` });
  }

  // ── LTHR: highest average HR over a sustained hard effort, bounded by max HR.
  for (const [sport, metric] of [["run", "lthr_run"], ["bike", "lthr_bike"]] as const) {
    if (!maxHr) break;
    const cands = acts.filter((r) => {
      const secs = movingSec(r);
      return toSport(r.sportType) === sport && within(r, 90) && r.heartRateAvg && secs >= 1500 && secs <= 4500;
    });
    const top = cands.sort((a, b) => b.heartRateAvg! - a.heartRateAvg!)[0];
    if (!top) continue;
    const lo = Math.round(maxHr * (sport === "run" ? 0.86 : 0.83));
    const hi = Math.round(maxHr * (sport === "run" ? 0.95 : 0.93));
    if (top.heartRateAvg! < lo) continue; // no genuinely hard effort
    const v = Math.min(hi, top.heartRateAvg!);
    const cur = sport === "run" ? current.lthrRun : current.lthrBike;
    if (!cur || v >= cur + 3) out.push({ metric, value: v, activityId: top.id, note: `Average HR of your hardest sustained ${sport === "run" ? "run" : "ride"} recently` });
  }
  return out;
}

function labelForMeters(m: number): string {
  const map: Record<number, string> = { 1609: "1 mile", 3000: "3K", 5000: "5K", 10000: "10K", 21097: "half marathon" };
  return map[m] ?? `${m} m`;
}

/**
 * Run detection for a user and persist results according to the policy above.
 * Returns the rows written (active or suggested) so callers can notify.
 */
export async function runThresholdDetection(userId: string, tz: string | null) {
  const today = todayInTz(tz);
  const [state, acts] = await Promise.all([getThresholdState(userId), getActivitiesBetween(userId, addDays(today, -365), today)]);
  const detections = detectThresholds(acts, state.values, today);
  const written = [];
  for (const d of detections) {
    const cur = state.current[d.metric];
    const pending = state.suggestions.find((s) => s.metric === d.metric && Math.abs(s.value - d.value) < 0.5);
    if (pending) continue;
    const userOwned = cur && (cur.source === "manual" || cur.source === "test");
    written.push(
      await addThreshold(userId, {
        metric: d.metric,
        value: d.value,
        source: "auto",
        status: userOwned ? "suggested" : "active",
        note: d.note,
        activityId: d.activityId,
        effectiveDate: today,
      }),
    );
  }
  return written;
}
