import { generatePlan } from "../server/planning/generator";
import { parseWorkout, summarizeWorkout, describeWorkout } from "../shared/workout-structure";
const th = { ftp: 240, runThresholdPace: 270, swimCss: 105, lthrRun: 168, maxHr: 186 };
const race = (process.argv[2] ?? "tri_full") as any;
const plan = generatePlan({ race, raceDate: process.argv[3] ?? "2027-04-11", startDate: "2026-10-01", weeklyHours: +(process.argv[4] ?? 12), currentWeeklyHours: 7, level: "intermediate",
  schedule: [], limiter: null, sports: ["swim","bike","run"], pool: "yards", easyByHr: true, swimCss: 105 });
console.log(plan.phases.map(p=>`${p.phase}:${p.weeks}`).join(" "), plan.split);
let errors = 0;
for (const w of plan.weeks) {
  let sec = 0, tss = 0; const bySport: any = {swim:0,bike:0,run:0};
  for (const s of w.sessions) { try { const ws = parseWorkout(s.dsl, s.sport); const sm = summarizeWorkout(ws, th); sec += sm.seconds; tss += sm.tss; bySport[s.sport]+=sm.seconds/3600; } catch(e) { errors++; console.log("PARSE ERR", s.title, s.dsl, (e as Error).message); } }
  console.log(`W${w.index+1} ${w.start} ${w.phase.padEnd(8)} target ${w.targetHours}h actual ${(sec/3600).toFixed(1)}h TSS ${tss} n=${w.sessions.length} S${bySport.swim.toFixed(1)} B${bySport.bike.toFixed(1)} R${bySport.run.toFixed(1)}`);
}
for (const wi of [2, 12, plan.weeks.length-4, plan.weeks.length-1]) {
  const w = plan.weeks[wi]; if (!w) continue; console.log(`\n=== Week ${wi+1} (${w.phase})`);
  for (const s of w.sessions) console.log(s.date, s.sport, s.isKey?"★":" ", s.title, "|", describeWorkout(parseWorkout(s.dsl, s.sport), th, {units:"imperial", pool:"yards"}).slice(0,150));
}
console.log("errors", errors);
