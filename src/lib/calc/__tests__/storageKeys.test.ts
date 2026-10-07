// storageKeys.ts is implemented in phase 1 (it is constants and tiny total functions). The fake storage below stands in for
// window.localStorage because the test environment is node.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derive } from "@/lib/model/derive";
import { baseline, cloneHouse } from "@/lib/model/__tests__/helpers";
import {
  STORAGE_KEYS,
  STORAGE_VERSIONS,
  clearStored,
  derivedFingerprint,
  finiteIn,
  fingerprint,
  parseStoredPv,
  readStored,
  readStoredPv,
  writeStored,
  type StorageKey,
} from "../storageKeys";

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

let store: FakeStorage;
beforeEach(() => {
  store = new FakeStorage();
  vi.stubGlobal("window", { localStorage: store });
});
afterEach(() => vi.unstubAllGlobals());

const keys = Object.keys(STORAGE_KEYS) as StorageKey[];
const asNumber = (d: unknown): number | null => (typeof d === "number" ? d : null);

describe("keys and versions", () => {
  it("has one distinct, non-empty string per entry and a positive integer version for each", () => {
    const values = keys.map((k) => STORAGE_KEYS[k]);
    expect(new Set(values).size).toBe(values.length);
    for (const k of keys) {
      expect(STORAGE_KEYS[k].length).toBeGreaterThan(0);
      expect(Number.isInteger(STORAGE_VERSIONS[k]) && STORAGE_VERSIONS[k] > 0).toBe(true);
    }
    expect(Object.keys(STORAGE_VERSIONS).sort()).toEqual([...keys].sort());
  });

  it("never collides with the theme key of the shell", () => {
    expect(Object.values(STORAGE_KEYS)).not.toContain("theme");
  });
});

describe("readStored / writeStored", () => {
  it("round-trips a value through the envelope", () => {
    expect(writeStored("sun", 42)).toBe(true);
    expect(readStored("sun", { parse: asNumber })).toBe(42);
    const env = JSON.parse(store.getItem(STORAGE_KEYS.sun) as string);
    expect(env).toEqual({ v: STORAGE_VERSIONS.sun, fp: null, data: 42 });
  });

  it("returns null when nothing is stored or the parser rejects", () => {
    expect(readStored("sun", { parse: asNumber })).toBeNull();
    writeStored("sun", "not a number");
    expect(readStored("sun", { parse: asNumber })).toBeNull();
  });

  it("ignores broken JSON, wrong envelopes and unknown newer versions", () => {
    for (const raw of ["{", "null", "[]", '"x"', '{"v":"1","data":1}', '{"v":1.5,"data":1}', `{"v":${STORAGE_VERSIONS.sun + 1},"data":1}`]) {
      store.setItem(STORAGE_KEYS.sun, raw);
      expect(readStored("sun", { parse: asNumber })).toBeNull();
    }
  });

  it("drops entries saved for another model", () => {
    writeStored("budget", 1, { fingerprint: "aaaa0000" });
    expect(readStored("budget", { parse: asNumber, fingerprint: "aaaa0000" })).toBe(1);
    expect(readStored("budget", { parse: asNumber, fingerprint: "bbbb1111" })).toBeNull();
    // an entry saved without a fingerprint does not match a reader that asks for one
    writeStored("budget", 1);
    expect(readStored("budget", { parse: asNumber, fingerprint: "aaaa0000" })).toBeNull();
  });

  it("migrates older versions only when a migration is given", () => {
    store.setItem(STORAGE_KEYS.look, JSON.stringify({ v: 0, fp: null, data: { n: 7 } }));
    expect(readStored("look", { parse: asNumber })).toBeNull();
    const migrate = vi.fn((from: number, d: unknown) => (d as { n: number }).n);
    expect(readStored("look", { parse: asNumber, migrate })).toBe(7);
    expect(migrate).toHaveBeenCalledWith(0, { n: 7 });
    expect(readStored("look", { parse: asNumber, migrate: () => null })).toBeNull();
  });

  it("clears an entry", () => {
    writeStored("model", 1);
    clearStored("model");
    expect(store.getItem(STORAGE_KEYS.model)).toBeNull();
  });

  it("never throws when the storage does", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(readStored("sun", { parse: asNumber })).toBeNull();
    expect(writeStored("sun", 1)).toBe(false);
    expect(() => clearStored("sun")).not.toThrow();
    // the accessor itself can throw (blocked cookies)
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("denied");
      },
    });
    expect(readStored("sun", { parse: asNumber })).toBeNull();
    expect(writeStored("sun", 1)).toBe(false);
  });

  it("is a no-op on the server", () => {
    vi.unstubAllGlobals();
    expect(readStored("sun", { parse: asNumber })).toBeNull();
    expect(writeStored("sun", 1)).toBe(false);
    expect(readStoredPv()).toBeNull();
  });
});

describe("fingerprint", () => {
  it("is FNV-1a 32 bit (published test vectors)", () => {
    expect(fingerprint([""])).toBe("811c9dc5");
    expect(fingerprint(["a"])).toBe("e40c292c");
    expect(fingerprint(["foobar"])).toBe("bf9cf968");
  });

  it("joins parts with a bar and depends on every part", () => {
    expect(fingerprint(["a", "b"])).toBe(fingerprint(["a|b"]));
    expect(fingerprint([1, 2, 3])).not.toBe(fingerprint([1, 2, 4]));
    expect(fingerprint(["x"])).toHaveLength(8);
  });
});

describe("derivedFingerprint", () => {
  const { derived } = baseline();

  it("does not depend on the order of the roof faces", () => {
    const shuffled = { ...derived, roofPlanes: [...derived.roofPlanes].reverse() };
    expect(derivedFingerprint(shuffled)).toBe(derivedFingerprint(derived));
  });

  it("changes when the roof changes", () => {
    const h = cloneHouse();
    h.roofs = h.roofs.map((r) => ({ ...r, pitch: r.pitch + 5 }));
    expect(derivedFingerprint(derive(h))).not.toBe(derivedFingerprint(derived));
  });

  it("changes when a room is added", () => {
    expect(derivedFingerprint({ ...derived, rooms: [...derived.rooms, derived.rooms[0]] })).not.toBe(derivedFingerprint(derived));
  });
});

describe("finiteIn", () => {
  it("clamps finite numbers and falls back for everything else", () => {
    expect(finiteIn(5, 0, 10, 1)).toBe(5);
    expect(finiteIn(-3, 0, 10, 1)).toBe(0);
    expect(finiteIn(99, 0, 10, 1)).toBe(10);
    for (const bad of [NaN, Infinity, -Infinity, "5", null, undefined, {}]) expect(finiteIn(bad, 0, 10, 7)).toBe(7);
  });
});

describe("shared PV choice", () => {
  it("parses a well-formed choice and rounds the count", () => {
    expect(parseStoredPv({ pv: { panelCount: 12.4, enabledPlanes: ["a", "b"], batteryId: "x" } })).toEqual({ panelCount: 12, enabledPlanes: ["a", "b"], batteryId: "x" });
  });

  it("turns bad fields into null instead of rejecting the rest", () => {
    expect(parseStoredPv({ pv: { panelCount: -1, enabledPlanes: [1, 2], batteryId: "" } })).toEqual({ panelCount: null, enabledPlanes: null, batteryId: null });
    expect(parseStoredPv({ pv: { panelCount: NaN } })?.panelCount).toBeNull();
  });

  it("is null without a pv object", () => {
    for (const bad of [null, undefined, 3, "x", [], {}, { pv: null }, { pv: [] }]) expect(parseStoredPv(bad)).toBeNull();
  });

  it("reads through the energy entry", () => {
    writeStored("energy", { pv: { panelCount: 9, enabledPlanes: ["k"], batteryId: "b" }, other: 1 });
    expect(readStoredPv()).toEqual({ panelCount: 9, enabledPlanes: ["k"], batteryId: "b" });
  });
});
