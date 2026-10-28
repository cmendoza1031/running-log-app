/**
 * One training session saved as several files (e.g. warm-up, intervals and cool-down as separate
 * Strava activities). Same sport, same day, each file starting ≤ 30 min after the previous one ended.
 */
import type { Run } from "@shared/schema";
import { toSport } from "@shared/physiology";
import { getActivitiesBetween } from "../data";
import { activityMovingSec } from "../analytics/load";

const MAX_GAP_MS = 30 * 60 * 1000;

/** The files that make up `run`'s session, in start order (just `[run]` for a normal one-file session). */
export async function sessionGroup(userId: string, run: Run): Promise<Run[]> {
  const sport = toSport(run.sportType);
  if (!sport || !run.startTime) return [run];
  const sameDay = (await getActivitiesBetween(userId, run.date, run.date))
    .filter((r) => r.startTime && toSport(r.sportType) === sport)
    .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());
  const end = (r: Run) => r.startTime!.getTime() + (r.elapsedTimeSec ?? activityMovingSec(r)) * 1000;
  let group: Run[] = [];
  for (const r of sameDay) {
    const prev = group[group.length - 1];
    if (prev && r.startTime!.getTime() - end(prev) > MAX_GAP_MS) {
      if (group.some((g) => g.id === run.id)) break;
      group = [];
    }
    group.push(r);
  }
  return group.some((g) => g.id === run.id) ? group : [run];
}

/** The file that carries the session's main work: the one with the most load (falls back to duration). */
export function mainFile(group: Run[]): Run {
  return group.reduce((best, r) => ((r.tss ?? 0) > (best.tss ?? 0) || (r.tss == null && best.tss == null && activityMovingSec(r) > activityMovingSec(best)) ? r : best));
}
