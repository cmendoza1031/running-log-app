import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Area,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { Sport, Thresholds } from "@shared/physiology";
import { formatDuration } from "@shared/physiology";
import { flattenWorkout, type WorkoutStructure } from "@shared/workout-structure";
import { PMC_COLORS, SPORTS, ZONE_COLORS, fmtDate, zoneColor, type Prefs } from "@/lib/vista";

const AXIS = { fontSize: 10, fill: "#6E6E73" };
const GRID = "rgba(255,255,255,0.06)";

function TooltipBox({ title, rows }: { title: string; rows: { color?: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-hairline bg-[#1c1c1e]/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur">
      <div className="mb-1 font-semibold text-ink-1">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-ink-2">
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
          <span className="flex-1">{r.label}</span>
          <span className="num font-semibold text-ink-1">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: i.color }} />
          {i.label}
          {i.value && <span className="num font-semibold text-ink-1">{i.value}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Fitness / Fatigue / Form ─────────────────────────────────────────────────

export interface PmcPoint {
  date: string;
  ctl: number;
  atl: number;
  tsb: number;
  tss: number;
  projected?: boolean;
}

export function PmcChart({ series, height = 180, showForm = true }: { series: PmcPoint[]; height?: number; showForm?: boolean }) {
  const data = useMemo(() => {
    const lastActual = series.filter((p) => !p.projected).pop()?.date;
    return series.map((p) => ({
      ...p,
      ctlA: p.projected ? null : p.ctl,
      atlA: p.projected ? null : p.atl,
      tsbA: p.projected ? null : p.tsb,
      ctlP: p.projected || p.date === lastActual ? p.ctl : null,
      atlP: p.projected || p.date === lastActual ? p.atl : null,
      tsbP: p.projected || p.date === lastActual ? p.tsb : null,
    }));
  }, [series]);
  const today = series.filter((p) => !p.projected).pop()?.date;
  const ticks = useMemo(() => {
    if (series.length < 2) return [];
    const step = Math.ceil(series.length / 4);
    return series.filter((_, i) => i % step === 0).map((p) => p.date);
  }, [series]);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={(d) => fmtDate(d, { month: "short", day: "numeric" })} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} tickFormatter={(v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v))} />
          {showForm && <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" />}
          {today && <ReferenceLine x={today} stroke="rgba(255,255,255,0.25)" />}
          <Area type="monotone" dataKey="ctlA" stroke="none" fill={PMC_COLORS.ctl} fillOpacity={0.1} isAnimationActive={false} />
          <Line type="monotone" dataKey="ctlA" stroke={PMC_COLORS.ctl} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="atlA" stroke={PMC_COLORS.atl} strokeWidth={2} dot={false} isAnimationActive={false} />
          {showForm && <Line type="monotone" dataKey="tsbA" stroke={PMC_COLORS.tsb} strokeWidth={2} dot={false} isAnimationActive={false} />}
          <Line type="monotone" dataKey="ctlP" stroke={PMC_COLORS.ctl} strokeWidth={2} strokeOpacity={0.5} strokeDasharray="3 4" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="atlP" stroke={PMC_COLORS.atl} strokeWidth={2} strokeOpacity={0.5} strokeDasharray="3 4" dot={false} isAnimationActive={false} />
          {showForm && <Line type="monotone" dataKey="tsbP" stroke={PMC_COLORS.tsb} strokeWidth={2} strokeOpacity={0.5} strokeDasharray="3 4" dot={false} isAnimationActive={false} />}
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.25)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as PmcPoint;
              return (
                <TooltipBox
                  title={`${fmtDate(p.date)}${p.projected ? " · planned" : ""}`}
                  rows={[
                    { color: PMC_COLORS.ctl, label: "Fitness", value: p.ctl.toFixed(0) },
                    { color: PMC_COLORS.atl, label: "Fatigue", value: p.atl.toFixed(0) },
                    { color: PMC_COLORS.tsb, label: "Form", value: p.tsb.toFixed(0) },
                    { label: "Load", value: `${Math.round(p.tss)} TSS` },
                  ]}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Weekly volume ────────────────────────────────────────────────────────────

export interface WeekVolumePoint {
  week: string;
  swim: number;
  bike: number;
  run: number;
  planned?: number;
}

export function VolumeChart({ data, height = 160, sports = ["swim", "bike", "run"] as Sport[] }: { data: WeekVolumePoint[]; height?: number; sports?: Sport[] }) {
  const topKey = (row: WeekVolumePoint) => [...sports].reverse().find((s) => row[s] > 0);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -8 }} barCategoryGap="22%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="week" tickFormatter={(d) => fmtDate(d, { month: "numeric", day: "numeric" })} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={30} allowDecimals={false} tickFormatter={(v) => `${v}h`} />
          {sports.map((s) => (
            <Bar
              key={s}
              dataKey={s}
              stackId="v"
              fill={SPORTS[s].color}
              stroke="#0d0d0f"
              strokeWidth={2}
              maxBarSize={24}
              isAnimationActive={false}
              shape={(raw: unknown) => {
                const { x, y, width, height: h, payload } = raw as { x: number; y: number; width: number; height: number; payload: WeekVolumePoint };
                if (!h || h <= 0) return <g />;
                const r = topKey(payload) === s ? Math.min(4, h) : 0;
                return (
                  <path
                    d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`}
                    fill={SPORTS[s].color}
                    stroke="#0d0d0f"
                    strokeWidth={2}
                  />
                );
              }}
            />
          ))}
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as WeekVolumePoint;
              const total = sports.reduce((a, s) => a + p[s], 0);
              return (
                <TooltipBox
                  title={`Week of ${fmtDate(p.week, { month: "short", day: "numeric" })}`}
                  rows={[
                    ...sports.map((s) => ({ color: SPORTS[s].color, label: SPORTS[s].label, value: formatDuration(p[s] * 3600) })),
                    { label: "Total", value: formatDuration(total * 3600) },
                    ...(p.planned ? [{ label: "Planned", value: formatDuration(p.planned * 3600) }] : []),
                  ]}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Zone distribution ────────────────────────────────────────────────────────

export function ZoneBars({ seconds, names }: { seconds: number[]; names?: string[] }) {
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...seconds, 1);
  return (
    <div className="space-y-1.5">
      {seconds.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span className="w-6 font-semibold text-ink-2">Z{i + 1}</span>
          {names && <span className="w-[76px] truncate text-ink-3">{names[i]}</span>}
          <div className="h-3 flex-1 overflow-hidden rounded-r-[4px]">
            <div className="h-full rounded-r-[4px]" style={{ width: `${(s / max) * 100}%`, background: ZONE_COLORS[i] ?? "#888", minWidth: s > 0 ? 2 : 0 }} />
          </div>
          <span className="num w-[70px] text-right text-ink-2">
            {formatDuration(s)} <span className="text-ink-3">{Math.round((s / total) * 100)}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Low / moderate / high distribution as one stacked strip (80/20 check). */
export function IntensityStrip({ low, moderate, high }: { low: number; moderate: number; high: number }) {
  const segs = [
    { v: low, c: ZONE_COLORS[1], l: "Low" },
    { v: moderate, c: ZONE_COLORS[2], l: "Moderate" },
    { v: high, c: ZONE_COLORS[4], l: "High" },
  ];
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {segs.map((s) => (s.v > 0 ? <div key={s.l} style={{ width: `${s.v * 100}%`, background: s.c }} /> : null))}
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-ink-2">
        {segs.map((s) => (
          <span key={s.l} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.c }} />
            {s.l} <span className="num font-semibold text-ink-1">{Math.round(s.v * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Workout profile graphic ─────────────────────────────────────────────────

export function WorkoutProfile({ structure, thresholds, prefs, height = 64 }: { structure: WorkoutStructure; thresholds: Thresholds; prefs: Prefs; height?: number }) {
  const flat = useMemo(() => flattenWorkout(structure, thresholds, prefs), [structure, thresholds, prefs]);
  const total = flat.reduce((a, f) => a + f.seconds, 0) || 1;
  const W = 1000;
  const gap = flat.length > 60 ? 0 : 3;
  let x = 0;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label="Workout intensity profile">
      {flat.map((f, i) => {
        const w = Math.max(1.5, (f.seconds / total) * W - gap);
        const intensity = f.intent === "rest" ? 0.25 : Math.max(0.35, Math.min(1.35, f.resolved.intensity));
        const h = Math.max(4, ((intensity - 0.2) / 1.15) * height);
        const rect = <rect key={i} x={x} y={height - h} width={w} height={h} rx={3} fill={f.intent === "rest" ? "#3A3A3C" : zoneColor(f.resolved.zone)} />;
        x += (f.seconds / total) * W;
        return rect;
      })}
    </svg>
  );
}

// ─── Power curve ──────────────────────────────────────────────────────────────

const CURVE_SECS = [5, 15, 30, 60, 180, 300, 600, 1200, 1800, 3600, 5400];

export function PowerCurve({ recent, year, height = 170 }: { recent: Record<string, number>; year: Record<string, number>; height?: number }) {
  const data = CURVE_SECS.filter((s) => recent[s] || year[s]).map((s) => ({ s, recent: recent[s] ?? null, year: year[s] ?? null }));
  if (data.length < 2) return null;
  const label = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${s / 60}m` : `${s / 3600}h`);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="s" scale="log" domain={["dataMin", "dataMax"]} type="number" ticks={data.map((d) => d.s)} tickFormatter={label} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Line type="monotone" dataKey="year" stroke="#8E8E93" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="recent" stroke={SPORTS.bike.color} strokeWidth={2} dot={{ r: 3, fill: SPORTS.bike.color, stroke: "#0d0d0f", strokeWidth: 2 }} isAnimationActive={false} connectNulls />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.25)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { s: number; recent: number | null; year: number | null };
              return (
                <TooltipBox
                  title={`Best ${label(p.s)}`}
                  rows={[
                    { color: SPORTS.bike.color, label: "Last 90 days", value: p.recent ? `${p.recent} W` : "—" },
                    { color: "#8E8E93", label: "Last 12 months", value: p.year ? `${p.year} W` : "—" },
                  ]}
                />
              );
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

export function Sparkline({ values, color, height = 28, width = 90 }: { values: number[]; color: string; height?: number; width?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`);
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={pts[pts.length - 1].split(",")[1]} r={3} fill={color} stroke="#0d0d0f" strokeWidth={2} />
    </svg>
  );
}
