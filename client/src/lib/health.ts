/**
 * Apple Health bridge (native plugin: ios/App/App/HealthPlugin.swift). Reads HRV, resting HR and
 * sleep, then uploads daily values to the API. iOS only; a no-op elsewhere.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiJson } from "@/lib/queryClient";

interface WellnessDay {
  date: string;
  hrvMs?: number;
  restingHr?: number;
  sleepMin?: number;
}

interface VistaHealthPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ completed: boolean }>;
  readDaily(options: { days: number }): Promise<{ days: WellnessDay[] }>;
}

const VistaHealth = registerPlugin<VistaHealthPlugin>("VistaHealth");
const ENABLED_KEY = "vista.appleHealth";

export const healthSupported = () => Capacitor.getPlatform() === "ios";

export function healthEnabled(): boolean {
  try {
    return healthSupported() && localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shows the Health permission sheet, then imports 60 days. Returns days uploaded. */
export async function connectAppleHealth(): Promise<number> {
  if (!healthSupported() || !(await VistaHealth.isAvailable()).available) throw new Error("Apple Health isn't available on this device");
  await VistaHealth.requestAuthorization();
  try {
    localStorage.setItem(ENABLED_KEY, "1");
  } catch {
    /* storage blocked: sync still works for this session */
  }
  return syncAppleHealth(60);
}

export function disconnectAppleHealth() {
  try {
    localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* ignore */
  }
}

/** Upload recent days. HealthKit returns nothing (no error) when read access was denied. */
export async function syncAppleHealth(days = 7): Promise<number> {
  const { days: rows } = await VistaHealth.readDaily({ days });
  if (!rows.length) return 0;
  const r = await apiJson<{ saved: number }>("POST", "/api/wellness", { days: rows });
  return r.saved;
}
