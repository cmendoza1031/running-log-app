import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Watch, MessageCircle, CalendarClock, SkipForward, Undo2, Pencil, Loader2, Monitor, Trash2, CheckCircle2 } from "lucide-react";
import { formatDistance, formatDuration, type Sport } from "@shared/physiology";
import { flattenWorkout, isValidStructure, structureToDsl, compactTime, type WorkoutStructure, type FlatStep } from "@shared/workout-structure";
import type { PlanWorkout, Run } from "@/lib/types";
import { apiJson } from "@/lib/queryClient";
import { usePrefs, useThresholds, fmtDate, zoneColor, exportWorkoutFile, sportMeta } from "@/lib/vista";
import { PageHeader, Card, SportBadge, Stat, Pill, Sheet, PrimaryButton, Skeleton, SectionTitle } from "@/components/kit";
import { WorkoutProfile } from "@/components/charts";
import { ActivityRow } from "@/components/training";
import { useToast } from "@/hooks/use-toast";
import { IOSFeedbackManager } from "@/lib/ios-utils";

interface Group {
  count: number;
  steps: FlatStep[];
}

/** Collapse the flattened steps back into repeat groups for display. */
function groupSteps(structure: WorkoutStructure, flat: FlatStep[]): Group[] {
  const out: Group[] = [];
  let i = 0;
  for (const n of structure.nodes) {
    if (n.kind === "step") {
      out.push({ count: 1, steps: [flat[i++]] });
    } else {
      out.push({ count: n.count, steps: flat.slice(i, i + n.steps.length) });
      i += n.count * n.steps.length;
    }
  }
  return out;
}

function durationLabel(f: FlatStep, sport: Sport, units: "imperial" | "metric", pool: "yards" | "meters"): string {
  if (f.duration.type === "time") return compactTime(f.duration.sec);
  if (f.duration.type === "distance") return formatDistance(f.duration.m, sport, units, pool);
  return "Lap button";
}

export default function WorkoutPage() {
  const [, params] = useRoute("/workout/:id");
  const id = params?.id ?? "";
  const prefs = usePrefs();
  const { data: th } = useThresholds();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [exporting, setExporting] = useState<"fit" | "zwo" | null>(null);

  const { data, isLoading } = useQuery<{ workout: PlanWorkout; activity: Run | null }>({ queryKey: [`/api/workouts/${id}`], enabled: !!id });
  const w = data?.workout;
  const structure = w && isValidStructure(w.structure) ? (w.structure as WorkoutStructure) : null;
  const thresholds = th?.values ?? {};
  const flat = useMemo(() => (structure ? flattenWorkout(structure, thresholds, prefs) : []), [structure, thresholds, prefs]);
  const groups = useMemo(() => (structure ? groupSteps(structure, flat) : []), [structure, flat]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiJson<PlanWorkout>("PATCH", `/api/workouts/${id}`, body),
    onSuccess: () => {
      void IOSFeedbackManager.successNotification();
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: () => apiJson("DELETE", `/api/workouts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries();
      navigate("/calendar");
    },
  });

  const doExport = async (kind: "fit" | "zwo") => {
    if (!w) return;
    setExporting(kind);
    try {
      await exportWorkoutFile(w.id, kind, w.title);
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  if (isLoading || !w) {
    return (
      <div className="page page-top space-y-3">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const sport = (w.sport ?? "run") as Sport;
  const meta = sportMeta(sport);

  return (
    <div className="page">
      <PageHeader back title={w.title} subtitle={`${fmtDate(w.date, { weekday: "long", month: "long", day: "numeric" })}${w.phase ? ` · ${w.phase} phase` : ""}`} />

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Pill color={meta.tint}>{meta.label}</Pill>
        {w.isKey && <Pill color="#64a8ff">Key session</Pill>}
        {w.isCompleted && (
          <Pill color="#30D158">
            <CheckCircle2 size={12} /> Completed
          </Pill>
        )}
        {w.status === "skipped" && <Pill>Skipped</Pill>}
      </div>

      <Card className="p-4">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="Duration" value={formatDuration(w.plannedDurationSec ?? 0)} />
          <Stat label={sport === "bike" ? "Est. dist" : "Distance"} value={w.plannedDistanceM ? formatDistance(w.plannedDistanceM, sport, prefs.units, prefs.pool) : "—"} />
          <Stat label="Load" value={Math.round(w.plannedTss ?? 0)} unit="TSS" />
        </div>
        {structure && <WorkoutProfile structure={structure} thresholds={thresholds} prefs={prefs} height={84} />}
      </Card>

      {w.description && (
        <Card className="mt-3 p-4">
          <div className="eyebrow mb-1">Purpose</div>
          <p className="text-[14px] leading-relaxed text-ink-2">{w.description}</p>
          {w.notes && <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{w.notes}</p>}
        </Card>
      )}

      {structure && (
        <>
          <SectionTitle>Steps</SectionTitle>
          <Card className="divide-y divide-hairline">
            {groups.map((g, gi) => (
              <div key={gi} className="px-4 py-3">
                {g.count > 1 && <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-primary">{g.count}× repeat</div>}
                <div className="space-y-2">
                  {g.steps.map((f, si) => (
                    <div key={si} className="flex items-stretch gap-3">
                      <div className="w-1 shrink-0 rounded-full" style={{ background: f.intent === "rest" ? "#3A3A3C" : zoneColor(f.resolved.zone) }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[14px] font-semibold capitalize text-ink-1">
                            {f.intent === "work" ? (f.label && f.label.length < 28 ? f.label : f.resolved.zone <= 2 ? "Steady" : "Work") : f.intent}
                          </span>
                          <span className="num text-[14px] font-semibold text-ink-1">{durationLabel(f, sport, prefs.units, prefs.pool)}</span>
                        </div>
                        <div className="num text-[13px] text-ink-2">{f.targetText}</div>
                        {f.label && (f.intent !== "work" || f.label.length >= 28) && <div className="mt-0.5 text-[12px] text-ink-3">{f.label}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      {data.activity && (
        <>
          <SectionTitle>Completed as</SectionTitle>
          <ActivityRow r={data.activity} prefs={prefs} />
        </>
      )}

      <SectionTitle>Send to device</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3.5" onClick={() => void doExport("fit")}>
          <div className="flex items-center gap-2">
            {exporting === "fit" ? <Loader2 size={18} className="animate-spin text-primary" /> : <Watch size={18} className="text-primary" />}
            <div className="text-[14px] font-semibold text-ink-1">Garmin / COROS</div>
          </div>
          <div className="mt-1 text-[12px] leading-snug text-ink-3">Structured .FIT with your targets</div>
        </Card>
        {sport === "bike" ? (
          <Card className="p-3.5" onClick={() => void doExport("zwo")}>
            <div className="flex items-center gap-2">
              {exporting === "zwo" ? <Loader2 size={18} className="animate-spin text-primary" /> : <Monitor size={18} className="text-primary" />}
              <div className="text-[14px] font-semibold text-ink-1">Zwift / trainer</div>
            </div>
            <div className="mt-1 text-[12px] leading-snug text-ink-3">.ZWO in % of FTP</div>
          </Card>
        ) : (
          <Card className="p-3.5" onClick={() => navigate(`/coach?prompt=${encodeURIComponent(`About my ${w.title} on ${fmtDate(w.date)}: `)}`)}>
            <div className="flex items-center gap-2">
              <MessageCircle size={18} className="text-primary" />
              <div className="text-[14px] font-semibold text-ink-1">Ask coach</div>
            </div>
            <div className="mt-1 text-[12px] leading-snug text-ink-3">Swap, shorten, or explain</div>
          </Card>
        )}
      </div>

      <SectionTitle>Adjust</SectionTitle>
      <Card className="divide-y divide-hairline">
        <ActionRow icon={<CalendarClock size={18} />} label="Move to another day" onClick={() => setMoveOpen(true)} />
        {w.status === "skipped" ? (
          <ActionRow icon={<Undo2 size={18} />} label="Restore session" onClick={() => patch.mutate({ status: "planned" })} />
        ) : (
          !w.isCompleted && <ActionRow icon={<SkipForward size={18} />} label="Skip this session" onClick={() => patch.mutate({ status: "skipped" })} />
        )}
        {sport === "bike" && (
          <ActionRow
            icon={<MessageCircle size={18} />}
            label="Ask coach about this workout"
            onClick={() => navigate(`/coach?prompt=${encodeURIComponent(`About my ${w.title} on ${fmtDate(w.date)}: `)}`)}
          />
        )}
        <ActionRow icon={<Pencil size={18} />} label="Edit structure" onClick={() => setEditOpen(true)} />
        <ActionRow icon={<Trash2 size={18} />} label="Delete" danger onClick={() => del.mutate()} />
      </Card>
      <div className="h-6" />

      <MoveSheet open={moveOpen} onClose={() => setMoveOpen(false)} date={w.date} onSave={(date) => patch.mutate({ date }, { onSuccess: () => setMoveOpen(false) })} />
      {structure && (
        <EditSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          initial={structureToDsl(structure, prefs.pool)}
          saving={patch.isPending}
          onSave={(dsl) => patch.mutate({ dsl }, { onSuccess: () => setEditOpen(false) })}
        />
      )}
    </div>
  );
}

function ActionRow({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`press flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] ${danger ? "text-bad" : "text-ink-1"}`}>
      <span className={danger ? "text-bad" : "text-ink-2"}>{icon}</span>
      {label}
    </button>
  );
}

function MoveSheet({ open, onClose, date, onSave }: { open: boolean; onClose: () => void; date: string; onSave: (d: string) => void }) {
  const [value, setValue] = useState(date);
  return (
    <Sheet open={open} onClose={onClose} title="Move session">
      <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="mb-4 w-full rounded-xl bg-white/[0.08] px-4 py-3 text-ink-1 outline-none" />
      <PrimaryButton className="w-full" onClick={() => onSave(value)} disabled={!value || value === date}>
        Move
      </PrimaryButton>
    </Sheet>
  );
}

function EditSheet({ open, onClose, initial, onSave, saving }: { open: boolean; onClose: () => void; initial: string; onSave: (dsl: string) => void; saving: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <Sheet open={open} onClose={onClose} title="Edit structure">
      <p className="mb-2 text-[13px] leading-snug text-ink-2">
        One step per line. Durations: <code>10min</code>, <code>90s</code>, <code>1km</code>, <code>400m</code>. Targets: <code>Z2</code>, <code>88-93% FTP</code>,{" "}
        <code>97-102% TP</code>, <code>100% CSS</code>, <code>250W</code>, <code>4:30/km</code>. Repeats: <code>4x(8min 95% FTP, 3min Z1)</code>. Or just ask your coach.
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        className="mb-4 w-full rounded-xl bg-white/[0.08] px-3 py-3 font-mono text-[13px] leading-relaxed text-ink-1 outline-none"
        spellCheck={false}
        autoCapitalize="off"
      />
      <PrimaryButton className="w-full" onClick={() => onSave(value)} disabled={saving}>
        {saving ? <Loader2 size={16} className="animate-spin" /> : "Save"}
      </PrimaryButton>
    </Sheet>
  );
}
