/**
 * Exact pace / split / distance / speed arithmetic for the coach (LLMs are unreliable at this).
 * Everything is reduced to seconds-per-meter or meters, then formatted in every useful unit.
 */
import { METERS_PER_MILE, METERS_PER_YARD, formatClock, parseClock, parsePaceString } from "./physiology";

const PACE_UNIT_M = { km: 1000, mi: METERS_PER_MILE, "100m": 100, "100yd": 100 * METERS_PER_YARD } as const;
type PaceUnit = keyof typeof PACE_UNIT_M;

const DIST_UNITS: Record<string, number> = {
  m: 1,
  meter: 1,
  meters: 1,
  km: 1000,
  k: 1000,
  mi: METERS_PER_MILE,
  mile: METERS_PER_MILE,
  miles: METERS_PER_MILE,
  yd: METERS_PER_YARD,
  y: METERS_PER_YARD,
  yard: METERS_PER_YARD,
  yards: METERS_PER_YARD,
};

export class PaceMathError extends Error {}

export function parseDistanceString(raw: string): number | null {
  const m = raw.trim().toLowerCase().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!m || !DIST_UNITS[m[2]]) return null;
  return parseFloat(m[1]) * DIST_UNITS[m[2]];
}

/** Pace with sub-second precision (e.g. 1:32.4/100yd). */
function fmtPace(secPerM: number, unit: PaceUnit): string {
  const s = secPerM * PACE_UNIT_M[unit];
  const whole = Math.floor(s);
  const tenth = Math.round((s - whole) * 10);
  const base = tenth === 10 ? formatClock(whole + 1) : formatClock(whole) + (tenth ? `.${tenth}` : "");
  return `${base}/${unit}`;
}

function fmtTime(sec: number): string {
  if (sec >= 60) return formatClock(sec);
  return `${(Math.round(sec * 10) / 10).toFixed(1)}s`;
}

function fmtDist(m: number): string {
  const r = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  return `${r(m, 1)} m = ${r(m / 1000, 3)} km = ${r(m / METERS_PER_MILE, 3)} mi = ${r(m / METERS_PER_YARD, 1)} yd`;
}

function isSwimUnit(u: string | null | undefined) {
  return u === "100m" || u === "100yd";
}

function paceLines(secPerM: number, swim: boolean): string[] {
  const units: PaceUnit[] = swim ? ["100yd", "100m"] : ["mi", "km"];
  const kmh = 3.6 / secPerM;
  const lines = [`Pace: ${units.map((u) => fmtPace(secPerM, u)).join(" = ")}`];
  if (!swim) lines.push(`Speed: ${(Math.round(kmh * 100) / 100).toFixed(2)} km/h = ${(Math.round((kmh / 1.609344) * 100) / 100).toFixed(2)} mph`);
  return lines;
}

function normPaceUnit(u: string | null): PaceUnit | null {
  if (!u) return null;
  if (u === "mile") return "mi";
  if (u === "100y" || u === "100yds") return "100yd";
  return (u in PACE_UNIT_M ? u : null) as PaceUnit | null;
}

export interface PaceMathInput {
  pace?: string;
  time?: string;
  distance?: string;
  speed_kmh?: number;
  speed_mph?: number;
}

export function paceMath(i: PaceMathInput): string {
  let secPerM: number | null = null;
  let swim = false;
  if (i.pace) {
    const p = parsePaceString(i.pace);
    const unit = normPaceUnit(p?.unit ?? null);
    if (!p || !unit) throw new PaceMathError(`Couldn't read pace "${i.pace}". Use m:ss with a unit: /mi, /km, /100m or /100yd.`);
    secPerM = p.sec / PACE_UNIT_M[unit];
    swim = isSwimUnit(unit);
  } else if (i.speed_kmh || i.speed_mph) {
    const kmh = i.speed_kmh ?? (i.speed_mph as number) * 1.609344;
    secPerM = 3.6 / kmh;
  }
  const meters = i.distance ? parseDistanceString(i.distance) : null;
  if (i.distance && meters == null) throw new PaceMathError(`Couldn't read distance "${i.distance}". Use a number + m, km, mi or yd (e.g. 1km, 400m, 26.2mi).`);
  if (meters != null && /y/.test(i.distance!.toLowerCase())) swim = true;
  const timeSec = i.time ? parseClock(i.time) : null;
  if (i.time && !timeSec) throw new PaceMathError(`Couldn't read time "${i.time}". Use m:ss or h:mm:ss.`);

  const out: string[] = [];
  if (secPerM == null && timeSec && meters) {
    // time + distance → pace
    secPerM = timeSec / meters;
    out.push(`${fmtTime(timeSec)} for ${i.distance}:`);
    out.push(...paceLines(secPerM, swim));
    return out.join("\n");
  }
  if (secPerM != null && meters != null) {
    // pace + distance → split time
    out.push(`At ${i.pace ?? `${i.speed_kmh ?? i.speed_mph} ${i.speed_kmh ? "km/h" : "mph"}`}, ${i.distance} takes ${fmtTime(secPerM * meters)}.`);
    if (!swim && meters >= 200 && meters <= 10000) out.push(`Per 400 m lap: ${fmtTime(secPerM * 400)}; 200 m: ${fmtTime(secPerM * 200)}.`);
    out.push(...paceLines(secPerM, swim));
    out.push(`Distance: ${fmtDist(meters)}`);
    return out.join("\n");
  }
  if (secPerM != null && timeSec) {
    // pace + time → distance
    out.push(`In ${fmtTime(timeSec)} at that pace you cover ${fmtDist(timeSec / secPerM)}.`);
    out.push(...paceLines(secPerM, swim));
    return out.join("\n");
  }
  if (secPerM != null) return paceLines(secPerM, swim).join("\n");
  if (meters != null) return [`Distance: ${fmtDist(meters)}`, `400 m track laps: ${Math.round((meters / 400) * 100) / 100}`].join("\n");
  throw new PaceMathError("Give at least one of: pace, speed, distance (+ time or pace for splits).");
}
