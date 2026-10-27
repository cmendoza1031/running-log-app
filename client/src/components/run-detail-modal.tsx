import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Pencil, Heart, Zap, TrendingUp, Mountain } from "lucide-react";
import type { Run } from "@shared/schema";

type RunWithPower = Run & { averagePower?: number };

const SPORT_EMOJI: Record<string, string> = {
  running: "🏃", cycling: "🚴", swimming: "🏊", triathlon: "🏅",
};

function formatDist(run: Run): string {
  const d = parseFloat(String(run.distance));
  const u = run.distanceUnit ?? "mi";
  if (u === "meters" || u === "yards") return `${Math.round(d).toLocaleString()} ${u === "meters" ? "m" : "yd"}`;
  return `${d.toFixed(2)} ${u}`;
}

function formatTime(hours: number, minutes: number): string {
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatPace(run: Run): { label: string; value: string } | null {
  const sport = run.sportType ?? "running";
  if (sport === "cycling") {
    const totalHrs = run.timeHours + run.timeMinutes / 60;
    if (totalHrs <= 0) return null;
    const dist  = parseFloat(String(run.distance));
    const speed = (dist / totalHrs).toFixed(1);
    const unit  = run.distanceUnit === "km" ? "kph" : "mph";
    return { label: "Avg Speed", value: `${speed} ${unit}` };
  }
  if (run.paceMinutes === 0 && run.paceSeconds === 0) return null;
  const unitLabel =
    sport === "swimming"
      ? (run.distanceUnit === "meters" ? "/100m" : "/100y")
      : run.distanceUnit === "km" ? "/km" : "/mi";
  return {
    label: "Avg Pace",
    value: `${run.paceMinutes}:${String(run.paceSeconds).padStart(2, "0")} ${unitLabel}`,
  };
}

function formatDate(dateString: string): string {
  return new Date(dateString + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

interface RunDetailModalProps {
  run: Run | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (run: Run) => void;
}

export default function RunDetailModal({ run, isOpen, onClose, onEdit }: RunDetailModalProps) {
  if (!run) return null;

  const sport   = run.sportType ?? "running";
  const pace    = formatPace(run);
  const runExt  = run as RunWithPower;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm mx-auto bg-surface-raised border-border rounded-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                <span>{SPORT_EMOJI[sport] ?? "⚡"}</span>
                <span className="truncate">{run.title ?? (run.runType?.replace(/_/g, " ") ?? sport)}</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {formatDate(run.date)}
              </DialogDescription>
            </div>
            {!run.externalId && (
              <button
                type="button"
                onClick={() => onEdit(run)}
                className="shrink-0 flex items-center gap-1 bg-skyblue/10 text-skyblue px-3 py-1.5 rounded-xl text-xs font-semibold active:scale-95 transition-transform"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-3">
          {/* Primary stats grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-surface-elevated rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">Distance</p>
              <p className="text-base font-bold text-skyblue leading-tight">{formatDist(run)}</p>
            </div>
            <div className="bg-surface-elevated rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground mb-1">Time</p>
              <p className="text-base font-bold text-skyblue leading-tight">{formatTime(run.timeHours, run.timeMinutes)}</p>
            </div>
            {pace && (
              <div className="bg-surface-elevated rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">{pace.label}</p>
                <p className="text-sm font-bold text-skyblue leading-tight">{pace.value}</p>
              </div>
            )}
          </div>

          {/* Secondary stats */}
          {(run.heartRateAvg || run.heartRateMax || runExt.averagePower || run.elevationGain) && (
            <div className="grid grid-cols-2 gap-2">
              {run.heartRateAvg && (
                <div className="flex items-center gap-2 bg-surface-elevated rounded-xl px-3 py-2.5">
                  <Heart size={14} className="text-red-400 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Avg HR</p>
                    <p className="text-sm font-semibold text-foreground">{run.heartRateAvg} bpm</p>
                  </div>
                </div>
              )}
              {run.heartRateMax && (
                <div className="flex items-center gap-2 bg-surface-elevated rounded-xl px-3 py-2.5">
                  <TrendingUp size={14} className="text-red-400 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Max HR</p>
                    <p className="text-sm font-semibold text-foreground">{run.heartRateMax} bpm</p>
                  </div>
                </div>
              )}
              {runExt.averagePower && (
                <div className="flex items-center gap-2 bg-surface-elevated rounded-xl px-3 py-2.5">
                  <Zap size={14} className="text-amber-400 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Avg Power</p>
                    <p className="text-sm font-semibold text-foreground">{runExt.averagePower}W</p>
                  </div>
                </div>
              )}
              {run.elevationGain && (
                <div className="flex items-center gap-2 bg-surface-elevated rounded-xl px-3 py-2.5">
                  <Mountain size={14} className="text-green-400 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Elevation</p>
                    <p className="text-sm font-semibold text-foreground">{run.elevationGain} ft</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Source badge */}
          {run.externalSource && (
            <div className="flex items-center gap-1.5 bg-surface-elevated rounded-xl px-3 py-2">
              <span className="text-[10px] text-muted-foreground capitalize">
                Via {run.externalSource}
              </span>
              {run.externalSource === "strava" && (
                <span className="text-[10px] font-semibold text-orange-400">• Strava</span>
              )}
            </div>
          )}

          {/* Notes */}
          {run.notes && (
            <div className="bg-surface-elevated rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-muted-foreground mb-1">Notes</p>
              <p className="text-sm text-foreground">{run.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
