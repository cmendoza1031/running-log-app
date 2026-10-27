import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { SportType } from "@shared/schema";
import {
  buildRacePresetsForSports,
  initialVisibleRaceSlotCount,
  RACE_SLOT_NONE,
  type RaceSlotForm,
  type PeakWeeklyVolume,
  type RacePreset,
} from "@shared/profile-goals";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IOSFeedbackManager } from "@/lib/ios-utils";

function selectValueForSlot(slot: RaceSlotForm, options: RacePreset[]): string {
  if (slot.presetKey === "other") return "other";
  if (slot.presetKey !== RACE_SLOT_NONE && options.some((o) => o.key === slot.presetKey)) return slot.presetKey;
  return RACE_SLOT_NONE;
}

function RaceSlotRow({
  index,
  sports,
  slot,
  onChange,
}: {
  index: number;
  sports: SportType[];
  slot: RaceSlotForm;
  onChange: (next: RaceSlotForm) => void;
}) {
  const options = buildRacePresetsForSports(sports);
  const selectVal = selectValueForSlot(slot, options);
  const showCustom =
    slot.presetKey === "other" ||
    (selectVal === RACE_SLOT_NONE && slot.label.trim().length > 0);

  const handlePresetChange = (val: string) => {
    void IOSFeedbackManager.lightImpact();
    if (val === RACE_SLOT_NONE) {
      onChange({ ...slot, presetKey: RACE_SLOT_NONE, label: "" });
      return;
    }
    if (val === "other") {
      onChange({ ...slot, presetKey: "other", label: slot.presetKey === "other" ? slot.label : "" });
      return;
    }
    const preset = options.find((o) => o.key === val);
    if (preset) onChange({ ...slot, presetKey: preset.key, label: preset.label });
  };

  return (
    <div className="min-w-0 w-full max-w-full space-y-2 rounded-xl border border-border/60 bg-surface-elevated/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Upcoming race {index + 1} <span className="font-normal normal-case text-muted-foreground/80">(optional)</span>
      </p>
      <Select value={selectVal} onValueChange={handlePresetChange}>
        <SelectTrigger className="h-auto min-h-[44px] w-full min-w-0 max-w-full rounded-xl border-border bg-surface-elevated text-sm text-foreground">
          <SelectValue placeholder="Choose event" />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-border bg-surface-raised text-foreground max-h-[min(70vh,320px)]">
          <SelectItem value={RACE_SLOT_NONE} className="rounded-lg">
            Choose event (optional)
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.key} value={o.key} className="rounded-lg">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showCustom && (
        <input
          value={slot.label}
          onChange={(e) => onChange({ ...slot, label: e.target.value })}
          placeholder="Describe the event"
          maxLength={220}
          className="box-border min-w-0 w-full max-w-full rounded-xl border border-transparent bg-surface-elevated px-3 py-3 text-sm text-foreground outline-none focus:border-skyblue/40"
        />
      )}
      <input
        type="date"
        value={slot.date}
        onChange={(e) => onChange({ ...slot, date: e.target.value })}
        className="box-border min-w-0 w-full max-w-full appearance-none rounded-xl border border-transparent bg-surface-elevated px-3 py-3 text-sm text-foreground outline-none focus:border-skyblue/40 [color-scheme:dark]"
      />
    </div>
  );
}

export function UpcomingRacesFields({
  sports,
  slots,
  onSlotsChange,
  profileSyncKey,
}: {
  sports: SportType[];
  slots: [RaceSlotForm, RaceSlotForm, RaceSlotForm];
  onSlotsChange: (next: [RaceSlotForm, RaceSlotForm, RaceSlotForm]) => void;
  /** When this changes (e.g. profile refetch), visible row count resets from slot data. */
  profileSyncKey?: string;
}) {
  const [visibleCount, setVisibleCount] = useState(() => initialVisibleRaceSlotCount(slots));
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  useEffect(() => {
    if (profileSyncKey === undefined) return;
    setVisibleCount(initialVisibleRaceSlotCount(slotsRef.current));
  }, [profileSyncKey]);

  const setSlot = (i: number, next: RaceSlotForm) => {
    const copy: [RaceSlotForm, RaceSlotForm, RaceSlotForm] = [...slots];
    copy[i] = next;
    onSlotsChange(copy);
  };

  return (
    <div className="min-w-0 w-full max-w-full">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Upcoming races</p>
      <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
        Up to three goal events — e.g. marathon and full Ironman in the same season.
      </p>
      <div className="space-y-3">
        {Array.from({ length: visibleCount }, (_, i) => (
          <RaceSlotRow
            key={i}
            index={i}
            sports={sports}
            slot={slots[i]!}
            onChange={(next) => setSlot(i, next)}
          />
        ))}
      </div>
      {visibleCount < 3 && (
        <button
          type="button"
          onClick={() => {
            void IOSFeedbackManager.lightImpact();
            setVisibleCount((n) => Math.min(3, n + 1));
          }}
          className="mt-3 flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-transparent py-3 text-sm font-medium text-skyblue transition-colors active:bg-skyblue/10"
        >
          <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          Add upcoming race
        </button>
      )}
    </div>
  );
}

export function PeakWeeklyVolumeFields({
  sports,
  peak,
  onPeakChange,
}: {
  sports: SportType[];
  peak: PeakWeeklyVolume;
  onPeakChange: (next: PeakWeeklyVolume) => void;
}) {
  const patch = (partial: PeakWeeklyVolume) => {
    onPeakChange({ ...peak, ...partial });
  };

  return (
    <div className="min-w-0 w-full max-w-full">
      <p className="mb-1 text-xs font-medium text-muted-foreground">Best recent week by sport</p>
      <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
        Roughly the highest weekly volume you have handled comfortably before — not a target, just context for the coach.
      </p>
      <div className="space-y-3">
        {sports.includes("running") && (
          <div className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Running</label>
              <input
                value={peak.running?.amount ?? ""}
                onChange={(e) =>
                  patch({
                    running: {
                      amount: e.target.value,
                      unit: peak.running?.unit ?? "mi",
                    },
                  })
                }
                inputMode="decimal"
                placeholder="e.g. 45"
                className="box-border min-w-0 w-full max-w-full rounded-xl border border-transparent bg-surface-elevated px-3 py-3 text-sm text-foreground outline-none focus:border-skyblue/40"
              />
            </div>
            <Select
              value={peak.running?.unit ?? "mi"}
              onValueChange={(u) => {
                void IOSFeedbackManager.lightImpact();
                patch({
                  running: {
                    amount: peak.running?.amount ?? "",
                    unit: u as "mi" | "km",
                  },
                });
              }}
            >
              <SelectTrigger className="h-[46px] w-[5.5rem] shrink-0 rounded-xl border-border bg-surface-elevated text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border bg-surface-raised">
                <SelectItem value="mi">mi</SelectItem>
                <SelectItem value="km">km</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {sports.includes("cycling") && (
          <div className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Cycling</label>
              <input
                value={peak.cycling?.amount ?? ""}
                onChange={(e) =>
                  patch({
                    cycling: {
                      amount: e.target.value,
                      unit: peak.cycling?.unit ?? "mi",
                    },
                  })
                }
                inputMode="decimal"
                placeholder="e.g. 120"
                className="box-border min-w-0 w-full max-w-full rounded-xl border border-transparent bg-surface-elevated px-3 py-3 text-sm text-foreground outline-none focus:border-skyblue/40"
              />
            </div>
            <Select
              value={peak.cycling?.unit ?? "mi"}
              onValueChange={(u) => {
                void IOSFeedbackManager.lightImpact();
                patch({
                  cycling: {
                    amount: peak.cycling?.amount ?? "",
                    unit: u as "mi" | "km",
                  },
                });
              }}
            >
              <SelectTrigger className="h-[46px] w-[5.5rem] shrink-0 rounded-xl border-border bg-surface-elevated text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border bg-surface-raised">
                <SelectItem value="mi">mi</SelectItem>
                <SelectItem value="km">km</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {sports.includes("swimming") && (
          <div className="flex min-w-0 max-w-full flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">Swimming</label>
              <input
                value={peak.swimming?.amount ?? ""}
                onChange={(e) =>
                  patch({
                    swimming: {
                      amount: e.target.value,
                      unit: peak.swimming?.unit ?? "yards",
                    },
                  })
                }
                inputMode="decimal"
                placeholder="e.g. 8000"
                className="box-border min-w-0 w-full max-w-full rounded-xl border border-transparent bg-surface-elevated px-3 py-3 text-sm text-foreground outline-none focus:border-skyblue/40"
              />
            </div>
            <Select
              value={peak.swimming?.unit ?? "yards"}
              onValueChange={(u) => {
                void IOSFeedbackManager.lightImpact();
                patch({
                  swimming: {
                    amount: peak.swimming?.amount ?? "",
                    unit: u as "yards" | "meters" | "hours",
                  },
                });
              }}
            >
              <SelectTrigger className="h-[46px] w-[7.5rem] shrink-0 rounded-xl border-border bg-surface-elevated text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border bg-surface-raised">
                <SelectItem value="yards">yards</SelectItem>
                <SelectItem value="meters">meters</SelectItem>
                <SelectItem value="hours">hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
