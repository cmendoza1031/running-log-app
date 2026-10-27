import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Run } from "@shared/schema";

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
  if (hours === 0) return `${minutes}min`;
  return `${hours}hr ${minutes}min`;
}

function formatPace(run: Run): string | null {
  const sport = run.sportType ?? "running";
  if (sport === "cycling") {
    // Compute speed from distance + time
    const totalHrs = run.timeHours + run.timeMinutes / 60;
    if (totalHrs <= 0) return null;
    const dist = parseFloat(String(run.distance));
    const speed = dist / totalHrs;
    const unit = run.distanceUnit === "km" ? "kph" : "mph";
    return `${speed.toFixed(1)} ${unit}`;
  }
  if (run.paceMinutes === 0 && run.paceSeconds === 0) return null;
  const unitLabel =
    sport === "swimming"
      ? (run.distanceUnit === "meters" ? "/100m" : "/100y")
      : run.distanceUnit === "km"
        ? "/km"
        : "/mi";
  return `${run.paceMinutes}:${String(run.paceSeconds).padStart(2, "0")} ${unitLabel}`;
}

function formatDate(dateString: string): string {
  const d = new Date(dateString + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

interface RunDayPopupProps {
  runs: Run[];
  date: string;
  isOpen: boolean;
  onClose: () => void;
  onRunClick: (run: Run) => void;
}

export default function RunDayPopup({ runs, date, isOpen, onClose, onRunClick }: RunDayPopupProps) {
  if (runs.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm mx-auto bg-surface-raised border-border rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">{formatDate(date)}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {runs.length} activit{runs.length === 1 ? "y" : "ies"} — tap to view details
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {runs.map((run) => {
            const sport = run.sportType ?? "running";
            const pace  = formatPace(run);
            return (
              <div
                key={run.id}
                onClick={() => onRunClick(run)}
                className="bg-surface-elevated rounded-xl p-3.5 cursor-pointer active:scale-95 transition-transform"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base shrink-0">{SPORT_EMOJI[sport] ?? "⚡"}</span>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {run.title ?? run.runType?.replace(/_/g, " ") ?? sport}
                    </p>
                  </div>
                  {pace && <span className="text-xs text-muted-foreground shrink-0">{pace}</span>}
                </div>

                <div className="flex gap-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Distance</p>
                    <p className="text-sm font-bold text-skyblue">{formatDist(run)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Time</p>
                    <p className="text-sm font-bold text-skyblue">{formatTime(run.timeHours, run.timeMinutes)}</p>
                  </div>
                  {run.heartRateAvg && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">Avg HR</p>
                      <p className="text-sm font-bold text-red-400">{run.heartRateAvg} bpm</p>
                    </div>
                  )}
                  {(run as Run & { averagePower?: number }).averagePower && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">Power</p>
                      <p className="text-sm font-bold text-amber-400">{(run as Run & { averagePower?: number }).averagePower}W</p>
                    </div>
                  )}
                </div>

                {run.notes && (
                  <p className="mt-2 text-xs text-muted-foreground line-clamp-1">{run.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
