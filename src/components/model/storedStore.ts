// A tiny external store for a value the visitor chose and the browser remembers (switches, the look). It plugs into
// `useSyncExternalStore`: the server and the first client render use the defaults (so the markup agrees), then the stored
// value takes over without an effect. Every storage access is guarded by calc/storageKeys (private windows, blocked storage).
import { readStored, writeStored, type StorageKey } from "@/lib/calc/storageKeys";

export interface StoredStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /** Replaces the value (a partial update is the caller's business), notifies the subscribers and stores it. */
  set: (value: T) => void;
}

export function createStoredStore<T>(key: StorageKey, defaults: T, parse: (data: unknown) => T): StoredStore<T> {
  let current = defaults;
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded) return;
    loaded = true;
    current = readStored(key, { parse: (d) => parse(d) }) ?? defaults;
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
    set(value) {
      loaded = true;
      current = value;
      writeStored(key, value);
      listeners.forEach((l) => l());
    },
  };
}
