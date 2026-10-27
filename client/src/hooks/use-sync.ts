import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { apiJson } from "@/lib/queryClient";
import type { SyncResult } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { THRESHOLD_LABELS, type ThresholdMetric } from "@shared/physiology";
import { healthEnabled, syncAppleHealth } from "@/lib/health";

const MIN_INTERVAL_MS = 3 * 60 * 1000;
let lastRun = 0;
let inflight: Promise<SyncResult | null> | null = null;
const listeners = new Set<(s: boolean) => void>();

async function doSync(force: boolean): Promise<SyncResult | null> {
  if (inflight) return inflight;
  if (!force && Date.now() - lastRun < MIN_INTERVAL_MS) return null;
  lastRun = Date.now();
  listeners.forEach((l) => l(true));
  // Wellness first, so the coach's post-workout notes see last night's HRV.
  const health = healthEnabled() ? syncAppleHealth(7).catch(() => 0) : Promise.resolve(0);
  inflight = health
    .then(() => apiJson<SyncResult>("POST", "/api/sync"))
    .catch(() => null)
    .finally(() => {
      inflight = null;
      listeners.forEach((l) => l(false));
    });
  return inflight;
}

/** Sync with Strava on demand; the provider in App also runs it on launch/foreground. */
export function useSync() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(!!inflight);
  useEffect(() => {
    listeners.add(setSyncing);
    return () => {
      listeners.delete(setSyncing);
    };
  }, []);
  const run = useCallback(
    async (force = false) => {
      const r = await doSync(force);
      if (!r) return;
      if (r.imported > 0 || r.thresholdChanges.length) {
        await qc.invalidateQueries();
        const th = r.thresholdChanges.map((t) => THRESHOLD_LABELS[t.metric as ThresholdMetric] ?? t.metric);
        toast({
          title: r.imported > 0 ? `${r.imported} new ${r.imported === 1 ? "workout" : "workouts"} synced` : "Thresholds updated",
          description: th.length ? `Updated: ${th.join(", ")}` : r.analyzed ? "Your coach reviewed the latest session." : undefined,
        });
      } else if (force) {
        await qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
        if (r.error) toast({ title: "Sync problem", description: r.error, variant: "destructive" });
      }
    },
    [qc, toast],
  );
  return { run, syncing };
}

export function useAutoSync(enabled: boolean) {
  const { run } = useSync();
  useEffect(() => {
    if (!enabled) return;
    void run(false);
    const onVisible = () => document.visibilityState === "visible" && void run(false);
    document.addEventListener("visibilitychange", onVisible);
    let remove: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => isActive && void run(false)).then((h) => (remove = () => void h.remove()));
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      remove?.();
    };
  }, [enabled, run]);
}
