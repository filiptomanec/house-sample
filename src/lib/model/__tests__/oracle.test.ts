// The kernel against the independent oracle (concept-stage deriver and metrics of the same floor plan).
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../metrics";
import { baseline, fixture } from "./helpers";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Collects the differences between actual and expected (numbers within tol, everything else equal). */
function diff(actual: unknown, expected: Json, tol: number, path: string, skip: (path: string) => boolean, out: string[]): void {
  if (skip(path)) return;
  if (typeof expected === "number") {
    if (typeof actual !== "number" || Math.abs(actual - expected) > tol) out.push(`${path}: ${String(actual)} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) out.push(`${path}: length ${Array.isArray(actual) ? actual.length : "n/a"} vs ${expected.length}`);
    else expected.forEach((x, i) => diff(actual[i], x, tol, `${path}[${i}]`, skip, out));
  } else if (expected !== null && typeof expected === "object") {
    if (typeof actual !== "object" || actual === null) out.push(`${path}: missing`);
    else for (const k of Object.keys(expected)) diff((actual as Record<string, unknown>)[k], expected[k], tol, `${path}.${k}`, skip, out);
  } else if (actual !== expected) out.push(`${path}: ${String(actual)} vs ${String(expected)}`);
}

describe("derived geometry against the oracle (tolerance 1e-6)", () => {
  const { derived } = baseline();
  const oracle = fixture<Record<string, Json>>("oracle-derived.json");
  // room names are bilingual objects in the kernel
  const skip = (p: string): boolean => /^\$\.rooms\[\d+\]\.name$/.test(p);

  for (const key of Object.keys(oracle)) {
    it(`matches "${key}"`, () => {
      const out: string[] = [];
      diff((derived as unknown as Record<string, unknown>)[key], oracle[key], 1e-6, `$.${key}`, skip, out);
      expect(out).toEqual([]);
    });
  }

  it("is a superset of the oracle keys", () => {
    for (const key of Object.keys(oracle)) expect(derived).toHaveProperty(key);
    for (const key of ["schemaVersion", "inputHash", "roofPlanes", "facings", "bbox", "netRooms", "outer"]) expect(derived).toHaveProperty(key);
  });

  it("room ids and order follow the model", () => {
    expect(derived.rooms.map((r) => r.id)).toEqual((oracle.rooms as { id: string }[]).map((r) => r.id));
  });
});

describe("metrics against the oracle", () => {
  const { house, derived } = baseline();
  const metrics = computeMetrics(house, derived);
  const oracle = fixture<Record<string, Json>>("oracle-metrics.json");
  // the oracle samples roofs on a 2.5 cm grid; everything below is exact in the kernel
  const sampled = new Set(["volume", "volumeWalls", "volumeRoof", "roofArea", "roofAreaOverFootprint", "envelopeArea", "envelopeToVolume", "roofSouthArea", "roofAreaByAzimuth", "pvKwp"]);

  for (const key of Object.keys(oracle)) {
    if (["id", "name", "validation"].includes(key)) continue;
    if (sampled.has(key)) continue;
    it(`planar metric "${key}" agrees within 0.02`, () => {
      const out: string[] = [];
      diff((metrics as unknown as Record<string, unknown>)[key], oracle[key], 0.02, key, () => false, out);
      expect(out).toEqual([]);
    });
  }

  for (const key of sampled) {
    it(`sampled metric "${key}" agrees within the sampling error of the oracle`, () => {
      const a = (metrics as unknown as Record<string, unknown>)[key];
      const e = oracle[key];
      const pairs: [number, number, string][] = [];
      if (typeof e === "number") pairs.push([a as number, e, key]);
      else for (const k of Object.keys(e as object)) pairs.push([(a as Record<string, number>)[k], (e as Record<string, number>)[k], `${key}.${k}`]);
      for (const [x, y, label] of pairs) {
        // 0.4 % sampling error of the oracle plus the rounding of both values
        const tol = 0.004 * Math.abs(y) + (key === "envelopeToVolume" ? 0.011 : 0.11);
        expect(Math.abs(x - y), `${label}: ${x} vs ${y}`).toBeLessThanOrEqual(tol);
      }
    });
  }

  it("the oracle was valid", () => {
    expect((oracle.validation as { valid: boolean }).valid).toBe(true);
  });
});
