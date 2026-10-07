// The remembered choices of the Sun page (STORAGE_KEYS.sun): the day, the time and the position of the shading. An external
// store for `useSyncExternalStore`: the server and the first client render use the defaults, so the markup agrees; then the stored
// value takes over without an effect. Every storage access is guarded by calc/storageKeys (private windows, blocked storage).
import { readStored, writeStored } from "@/lib/calc/storageKeys";
import { DEFAULT_SHADING, defaultMinute, parseSettings, type DayPreset, type SunSettings } from "./model";
import { placeOf, sunTimes } from "@/lib/calc/sun";
import type { House } from "@/lib/model/types";

export interface SunStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SunSettings;
  getServerSnapshot: () => SunSettings;
  /** Merges a change into the settings, notifies the subscribers and stores the result. */
  update: (patch: Partial<SunSettings>) => void;
}

/** First visit: the summer solstice (the longest day), with the shading half open. */
export function defaultSettings(house: Pick<House, "location">, presets: readonly DayPreset[]): SunSettings {
  const day = (presets.find((p) => p.key === "summer") ?? presets[0]).date;
  return { month: day.month, day: day.day, minute: defaultMinute(sunTimes(placeOf(house), day)), ...DEFAULT_SHADING };
}

export function createSunStore(year: number, defaults: SunSettings): SunStore {
  let current = defaults;
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded) return;
    loaded = true;
    current = readStored("sun", { parse: (d) => parseSettings(d, year) }) ?? defaults;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot() {
      load();
      return current;
    },
    getServerSnapshot: () => defaults,
    update(patch) {
      load();
      current = { ...current, ...patch };
      writeStored("sun", current);
      listeners.forEach((l) => l());
    },
  };
}
