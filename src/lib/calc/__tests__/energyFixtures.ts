// Fixtures of the energy tests (not a test file): a one-room house whose numbers can be computed by hand, and helpers
// that build contexts from modified copies of the model and of the data files.
import assumptionsJson from "@model/assumptions.json";
import climateJson from "@/lib/data/pvgis.json";
import { derive } from "@/lib/model/derive";
import { HouseSchema } from "@/lib/model/schema";
import type { House } from "@/lib/model/types";
import { rawHouse } from "@/lib/model/__tests__/helpers";
import { createEnergyContext, parseAssumptions, type Assumptions, type ClimateData, type EnergyContext } from "../energy";

export const climate = climateJson as unknown as ClimateData;
export const assumptions = (): Assumptions => parseAssumptions(JSON.parse(JSON.stringify(assumptionsJson)));
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Size of the one-room house: axis rectangle, m. */
export const BOX = { w: 8, d: 6 };

/** The model with every room, opening, roof and outdoor element replaced by one living room under one hip roof without overhang. */
export function boxHouse(edit?: (raw: Record<string, any>) => void): House { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = rawHouse() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = raw.wall.ext as number;
  raw.rooms = [{ id: "R1", name: { cs: "Pokoj", en: "Room" }, type: "living", rects: [[0, 0, BOX.w, BOX.d]] }];
  raw.openings = [];
  raw.roofs = [{ id: "T1", rect: [-t / 2, -t / 2, BOX.w + t / 2, BOX.d + t / 2], pitch: raw.roofs[0].pitch, overhang: 0, wallTop: raw.clearHeight + raw.slab }];
  raw.outdoor = [];
  raw.accents = [];
  raw.furniture = [];
  raw.lightpipes = [];
  raw.screens = [];
  raw.bearingAxes = { x: [], y: [] };
  edit?.(raw);
  return HouseSchema.parse(raw);
}

export function contextOf(house: House, tweak?: { climate?: ClimateData; assumptions?: Assumptions }): EnergyContext {
  return createEnergyContext({ house, derived: derive(house), climate: tweak?.climate ?? climate, assumptions: tweak?.assumptions ?? assumptions() });
}

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
