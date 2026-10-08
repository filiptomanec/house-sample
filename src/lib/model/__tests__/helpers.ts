// Shared helpers of the kernel tests (not a test file itself).
import fs from "node:fs";
import path from "node:path";
import { derive } from "../derive";
import { HouseSchema } from "../schema";
import type { Derived, House } from "../types";

const root = path.resolve(__dirname, "../../../..");

/** Raw house.json as a plain object (a fresh deep copy on every call). */
export function rawHouse(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, "model", "house.json"), "utf8")) as Record<string, unknown>;
}

export function loadHouse(): House {
  return HouseSchema.parse(rawHouse());
}

let cache: { house: House; derived: Derived } | null = null;
/** The parsed model and its derived data (shared, do not mutate). */
export function baseline(): { house: House; derived: Derived } {
  if (!cache) {
    const house = loadHouse();
    cache = { house, derived: derive(house) };
  }
  return cache;
}

let oracleCache: { house: House; derived: Derived } | null = null;
/**
 * The frozen concept plan the oracle fixtures were produced from (`__fixtures__/oracle-house.json`) and its derived data.
 * The oracle checks the kernel, not the current content: model/house.json moves on (re-plans), this input does not.
 */
export function oracleBaseline(): { house: House; derived: Derived } {
  if (!oracleCache) {
    const house = HouseSchema.parse(fixture<unknown>("oracle-house.json"));
    oracleCache = { house, derived: derive(house) };
  }
  return oracleCache;
}

/** Deep copy of the house as a mutable object. */
export function cloneHouse(): House {
  return loadHouse();
}

export function fixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "../__fixtures__", name), "utf8")) as T;
}

export const repoRoot = root;

import * as pcNs from "polygon-clipping";

/** polygon-clipping works with both its CommonJS and ES builds. */
export const pc: typeof pcNs = ((pcNs as unknown as { default?: typeof pcNs }).default ?? pcNs) as typeof pcNs;

/** Closed ring for polygon-clipping from open points. */
export const ring = (pts: [number, number][]): [number, number][] => [...pts, pts[0]];
/** Area of a polygon-clipping MultiPolygon. */
export function multiArea(mp: pcNs.MultiPolygon): number {
  let a = 0;
  for (const poly of mp) {
    poly.forEach((r, i) => {
      let s = 0;
      for (let k = 0; k < r.length - 1; k++) s += r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1];
      a += (i === 0 ? 1 : -1) * Math.abs(s / 2);
    });
  }
  return a;
}

/** Rounds coordinates to 1 micrometre so that shared vertices coincide exactly (polygon-clipping is sensitive to float noise). */
export const snapRing = (pts: [number, number][]): [number, number][] => ring(pts.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as [number, number]));
