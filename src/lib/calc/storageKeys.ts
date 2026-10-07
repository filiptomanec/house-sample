// The one place that names the browser storage entries of the site, so that no page and no 3D module repeats a literal.
// (Exception: the colour-scheme key lives in components/ui/themeScript.ts because an inline <head> script needs it.)
//
// Rules (docs/CALC-API.md, section 9):
//  * every entry is an envelope { v, fp, data }: `v` is the version of the shape of `data`, `fp` (optional) the
//    fingerprint of the model it was saved for. A different version or fingerprint means "nothing saved".
//  * every access is wrapped in try/catch (private windows, blocked storage, quota, SSR); nothing here ever throws;
//  * reading is total: untrusted JSON goes through a `parse` function of the caller that returns a complete valid
//    value or null; unknown ids/keys must be dropped there (never trust order or ids of an earlier model version);
//  * storage is read after mount (in an effect), never during render, so server and client markup agree.
import type { Derived } from "@/lib/model/types";
import { planeKey } from "./roofLayout";

export const STORAGE_KEYS = {
  /** Energy page: inputs, the PV choice (panel count, roof planes, battery) shared with Model, Home and Budget. */
  energy: "hs-energy",
  /** Budget page: switched groups, reserve and edited quantities/prices. */
  budget: "hs-budget",
  /** 3D model: selected facade, wood and roof looks. */
  look: "hs-look",
  /** Floor plan: furniture placed by the visitor. */
  furniture: "hs-furniture",
  /** Sun page: last date and time. */
  sun: "hs-sun",
  /** 3D model: switches (roof, furniture, section, labels...). */
  model: "hs-model",
} as const;

export type StorageKey = keyof typeof STORAGE_KEYS;

/** Current version of the `data` shape per entry. Bump together with a `migrate` function in the reader, or drop old data. */
export const STORAGE_VERSIONS: Record<StorageKey, number> = { energy: 1, budget: 1, look: 1, furniture: 1, sun: 1, model: 1 };

/** What is stored under a key. */
export interface StoredEnvelope {
  v: number;
  /** Fingerprint of the model the data belongs to, or null when it does not depend on the model. */
  fp: string | null;
  data: unknown;
}

/**
 * The PV choice shared by Energy (writes), Model, Home and Budget (read). Shape only; whether the plane keys and the battery id
 * still exist is checked by `resolvePvSelection` in roofLayout.ts. Part of the `energy` entry: `{ pv: StoredPv, ... }`.
 */
export interface StoredPv {
  panelCount: number | null;
  /** Stable plane keys (`planeKey`) that carry panels; null = model default. */
  enabledPlanes: string[] | null;
  batteryId: string | null;
}

/** localStorage, or null when unavailable (server, blocked, private window). The accessor itself can throw. */
export function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface ReadOptions<T> {
  /** Total function: a complete valid value from untrusted data, or null to reject it. */
  parse: (data: unknown) => T | null;
  /** Reject entries saved for another model. */
  fingerprint?: string;
  /** Upgrade the data of an older version; return null to drop it. Called only when `v` is lower than the current version. */
  migrate?: (fromVersion: number, data: unknown) => unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads and validates one entry. Returns null when nothing usable is stored. Never throws. */
export function readStored<T>(key: StorageKey, opts: ReadOptions<T>): T | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEYS[key]);
    if (!raw) return null;
    const env: unknown = JSON.parse(raw);
    if (!isRecord(env) || typeof env.v !== "number" || !Number.isInteger(env.v)) return null;
    const current = STORAGE_VERSIONS[key];
    let data: unknown = env.data;
    if (env.v > current) return null;
    if (env.v < current) {
      if (!opts.migrate) return null;
      data = opts.migrate(env.v, data);
      if (data == null) return null;
    }
    if (opts.fingerprint !== undefined && env.fp !== opts.fingerprint) return null;
    return opts.parse(data);
  } catch {
    return null;
  }
}

/** Writes one entry. Returns false when it could not be stored. Never throws. */
export function writeStored(key: StorageKey, data: unknown, opts: { fingerprint?: string } = {}): boolean {
  try {
    const s = storage();
    if (!s) return false;
    const env: StoredEnvelope = { v: STORAGE_VERSIONS[key], fp: opts.fingerprint ?? null, data };
    s.setItem(STORAGE_KEYS[key], JSON.stringify(env));
    return true;
  } catch {
    return false;
  }
}

/** Removes one entry. Never throws. */
export function clearStored(key: StorageKey): void {
  try {
    storage()?.removeItem(STORAGE_KEYS[key]);
  } catch {
    /* nothing to do */
  }
}

/** FNV-1a (32 bit) of the parts joined by "|", as 8 hex digits. Not cryptographic; it only detects "the model changed". */
export function fingerprint(parts: readonly (string | number)[]): string {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Fingerprint of the geometry that saved settings depend on: the roof planes (stable keys), the PV capacity, the
 * numbers of rooms and openings and the footprint area (to the centimetre). Independent of ids and of array order.
 */
export function derivedFingerprint(d: Derived): string {
  const planes = [...new Set(d.roofPlanes.map(planeKey))].sort();
  return fingerprint([...planes, d.pv.count, d.rooms.length, d.openings.length, Math.round(d.outline.area * 100)]);
}

/** Coerces a number from untrusted data: finite number inside [min, max], else the fallback. */
export function finiteIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Shape check of the shared PV choice inside an `energy` entry's data; null when absent or not an object. */
export function parseStoredPv(data: unknown): StoredPv | null {
  if (!isRecord(data) || !isRecord(data.pv)) return null;
  const pv = data.pv;
  const panels = pv.panelCount;
  const planes = pv.enabledPlanes;
  const battery = pv.batteryId;
  return {
    panelCount: typeof panels === "number" && Number.isFinite(panels) && panels >= 0 ? Math.round(panels) : null,
    enabledPlanes: Array.isArray(planes) && planes.every((p) => typeof p === "string") ? (planes as string[]) : null,
    batteryId: typeof battery === "string" && battery.length > 0 ? battery : null,
  };
}

/** Reads the shared PV choice (client only, after mount). Null when nothing is stored. */
export function readStoredPv(): StoredPv | null {
  return readStored("energy", { parse: parseStoredPv });
}
