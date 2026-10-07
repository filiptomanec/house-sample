import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS, writeStored } from "@/lib/calc/storageKeys";
import { createStoredStore } from "./storedStore";
import { DEFAULT_SETTINGS, parseSettings, type ModelSettings } from "./settings";

/** A minimal in-memory localStorage on a fake window, as in a browser. */
function fakeBrowser(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  vi.stubGlobal("window", { localStorage: storage });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe("createStoredStore", () => {
  it("starts from the defaults on the server and without anything stored", () => {
    const store = createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings);
    expect(store.getServerSnapshot()).toBe(DEFAULT_SETTINGS);
    expect(store.getSnapshot()).toBe(DEFAULT_SETTINGS); // no window: nothing to read, and no throw
  });

  it("reads a stored value once, after the first snapshot", () => {
    fakeBrowser();
    writeStored("model", { roof: false, day: "noon" });
    const store = createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings);
    expect(store.getServerSnapshot()).toBe(DEFAULT_SETTINGS);
    const snap = store.getSnapshot();
    expect(snap).toEqual({ ...DEFAULT_SETTINGS, roof: false, day: "noon" });
    expect(store.getSnapshot()).toBe(snap); // a stable reference, as useSyncExternalStore requires
  });

  it("validates what it reads: garbage and foreign shapes give the defaults", () => {
    fakeBrowser({ [STORAGE_KEYS.model]: "{not json" });
    expect(createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings).getSnapshot()).toBe(DEFAULT_SETTINGS);
    fakeBrowser({ [STORAGE_KEYS.model]: JSON.stringify({ v: 99, fp: null, data: { roof: false } }) });
    expect(createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings).getSnapshot()).toBe(DEFAULT_SETTINGS);
  });

  it("set stores the value, notifies the subscribers and survives a reload", () => {
    const data = fakeBrowser();
    const store = createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const next = { ...DEFAULT_SETTINGS, green: false };
    store.set(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(next);
    expect(JSON.parse(data.get(STORAGE_KEYS.model)!).data.green).toBe(false);
    off();
    store.set({ ...DEFAULT_SETTINGS });
    expect(listener).toHaveBeenCalledTimes(1);
    const reloaded = createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings);
    expect(reloaded.getSnapshot()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps working when storage throws (private window, quota)", () => {
    vi.stubGlobal("window", { get localStorage(): Storage { throw new Error("blocked"); } });
    const store = createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings);
    expect(store.getSnapshot()).toBe(DEFAULT_SETTINGS);
    const next = { ...DEFAULT_SETTINGS, roof: false };
    expect(() => store.set(next)).not.toThrow();
    expect(store.getSnapshot()).toBe(next); // the value lives on in memory for this visit
  });
});
