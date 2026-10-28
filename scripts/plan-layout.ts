/**
 * Week-layout check for the plan engine: prints each week as Mon..Sun and counts scheduling problems.
 * Usage: npx tsx scripts/plan-layout.ts [schedule-json] [race] [raceDate] [startDate] [hours]
 */
import { generatePlan } from "../server/planning/generator";
import type { TrainingDay } from "../shared/schema";

const MY_SCHEDULE: TrainingDay[] = [
  { day: 1, isLongDay: false, maxMinutes: 120 },
  { day: 2, isLongDay: false, maxMinutes: 240 },
  { day: 3, isLongDay: false, maxMinutes: 240 },
  { day: 4, isLongDay: false, maxMinutes: 240 },
  { day: 5, isLongDay: false, maxMinutes: 240 },
  { day: 0, isLongDay: false, maxMinutes: 240 },
  { day: 6, isLongDay: true, maxMinutes: 330 },
];
const schedule: TrainingDay[] = process.argv[2] ? JSON.parse(process.argv[2]) : MY_SCHEDULE;
const plan = generatePlan({
  race: (process.argv[3] ?? "tri_full") as never,
  raceDate: process.argv[4] ?? "2027-08-15",
  startDate: process.argv[5] ?? "2026-11-30",
  weeklyHours: +(process.argv[6] ?? 18),
  currentWeeklyHours: 8,
  level: "advanced",
  schedule,
  limiter: "bike",
  sports: ["swim", "bike", "run"],
  pool: "yards",
  easyByHr: true,
  swimCss: 100,
});

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hardKinds = new Set(["quality", "long"]);
// date -> sports with a hard session (run/bike only)
const hardBy = new Map<string, Set<string>>();
const longRunDow: Record<string, number> = {};
for (const w of plan.weeks) for (const s of w.sessions) {
  if (s.sport !== "swim" && hardKinds.has(s.kind)) {
    if (!hardBy.has(s.date)) hardBy.set(s.date, new Set());
    hardBy.get(s.date)!.add(s.sport);
  }
  if (s.sport === "run" && s.kind === "long") {
    const d = DAYS[(new Date(s.date + "T12:00:00Z").getUTCDay() + 6) % 7];
    longRunDow[d] = (longRunDow[d] ?? 0) + 1;
  }
}
const next = (d: string) => new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
let sameSportB2B = 0;
let streak3 = 0;
const dates = [...hardBy.keys()].sort();
for (const d of dates) {
  const n = hardBy.get(next(d));
  if (n) for (const s of hardBy.get(d)!) if (n.has(s)) sameSportB2B++;
  if (n && hardBy.get(next(next(d)))) streak3++;
}
console.log(`same-sport hard back-to-back: ${sameSportB2B} | 3+ hard run/bike days in a row: ${streak3} | long run by day: ${JSON.stringify(longRunDow)}`);

const tag = (s: { sport: string; kind: string }) => {
  const k = s.kind === "long" ? "LONG" : s.kind === "quality" ? "Q" : s.kind === "swim_css" ? "css" : s.kind === "brick" ? "brick" : s.kind === "recovery" ? "rec" : "e";
  return `${s.sport[0].toUpperCase()}:${k}`;
};
const show = (process.argv[7] ?? "3,10,20,30").split(",").map(Number);
for (const wi of show) {
  const w = plan.weeks[wi];
  if (!w) continue;
  const cols = DAYS.map((_, i) => {
    const date = new Date(Date.parse(w.start + "T12:00:00Z") + i * 864e5).toISOString().slice(0, 10);
    return w.sessions.filter((s) => s.date === date).map(tag).join("+") || "rest";
  });
  console.log(`W${wi + 1} ${w.start} ${w.phase.padEnd(8)} ${cols.map((c, i) => `${DAYS[i]} ${c}`.padEnd(18)).join("")}`);
}
