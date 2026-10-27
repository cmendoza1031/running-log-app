import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { METERS_PER_MILE, METERS_PER_YARD, parseClock, type Sport } from "@shared/physiology";
import type { Run } from "@/lib/types";
import { apiJson } from "@/lib/queryClient";
import { usePrefs, localToday, SPORTS } from "@/lib/vista";
import { PageHeader, Card, PrimaryButton, SportBadge } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { IOSFeedbackManager } from "@/lib/ios-utils";

export default function LogPage() {
  const prefs = usePrefs();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sport, setSport] = useState<Sport>("run");
  const [date, setDate] = useState(localToday());
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [hr, setHr] = useState("");
  const [power, setPower] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const distUnit = sport === "swim" ? (prefs.pool === "yards" ? "yd" : "m") : prefs.units === "imperial" ? "mi" : "km";
  const toMeters = (v: number) =>
    sport === "swim" ? (prefs.pool === "yards" ? v * METERS_PER_YARD : v) : prefs.units === "imperial" ? v * METERS_PER_MILE : v * 1000;
  const durationSec = parseClock(duration);

  const save = useMutation({
    mutationFn: () =>
      apiJson<Run>("POST", "/api/activities", {
        date,
        sport,
        title: title || undefined,
        durationSec: Math.round(durationSec!),
        distanceMeters: distance ? toMeters(parseFloat(distance)) : undefined,
        avgHr: hr ? Number(hr) : undefined,
        avgPower: power ? Number(power) : undefined,
        perceivedEffort: rpe ?? undefined,
        notes: notes || undefined,
      }),
    onSuccess: (r) => {
      void IOSFeedbackManager.successNotification();
      void qc.invalidateQueries();
      toast({ title: "Activity saved", description: "Your coach will review it in a moment." });
      navigate(`/activity/${r.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const input = "w-full rounded-xl bg-white/[0.07] px-4 py-3 text-ink-1 outline-none placeholder:text-ink-3";
  const label = "mb-1.5 block text-[12px] font-medium text-ink-2";

  return (
    <div className="page">
      <PageHeader back title="Log activity" subtitle="For sessions that didn't sync automatically" />
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(["swim", "bike", "run"] as Sport[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              void IOSFeedbackManager.lightImpact();
              setSport(s);
            }}
            className={`press flex flex-col items-center gap-2 rounded-2xl border py-3 ${sport === s ? "border-white/30 bg-white/[0.08]" : "border-hairline bg-[#0d0d0f]"}`}
          >
            <SportBadge sport={s} size={34} />
            <span className="text-[13px] font-semibold text-ink-1">{SPORTS[s].label}</span>
          </button>
        ))}
      </div>
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Date</label>
            <input type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Duration</label>
            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="h:mm:ss" inputMode="numeric" className={input} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Distance ({distUnit})</label>
            <input value={distance} onChange={(e) => setDistance(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="optional" className={input} />
          </div>
          <div>
            <label className={label}>Avg heart rate</label>
            <input value={hr} onChange={(e) => setHr(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="bpm" className={input} />
          </div>
        </div>
        {sport === "bike" && (
          <div>
            <label className={label}>Avg power (W)</label>
            <input value={power} onChange={(e) => setPower(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="optional" className={input} />
          </div>
        )}
        <div>
          <label className={label}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. Easy ${SPORTS[sport].noun}`} className={input} />
        </div>
        <div>
          <label className={label}>Effort (RPE {rpe ?? "–"}/10)</label>
          <div className="grid grid-cols-10 gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRpe(n)}
                className={`press h-8 rounded-lg text-[13px] font-semibold ${rpe === n ? "bg-primary text-white" : "bg-white/[0.07] text-ink-2"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={label}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="How it went" className={`${input} resize-none`} />
        </div>
      </Card>
      <PrimaryButton className="mt-4 w-full" onClick={() => save.mutate()} disabled={!durationSec || durationSec < 60 || save.isPending}>
        {save.isPending ? <Loader2 size={16} className="animate-spin" /> : "Save activity"}
      </PrimaryButton>
      {duration && !durationSec && <p className="mt-2 text-center text-[12px] text-bad">Use h:mm:ss or mm:ss, e.g. 45:00 or 1:05:30</p>}
      <div className="h-6" />
    </div>
  );
}
