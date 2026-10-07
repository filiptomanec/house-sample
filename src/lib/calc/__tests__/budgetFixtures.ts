// Shared fixtures of the budget tests (not a test file): the model's quantities, a small hand-checkable price book and a CSV reader.
import siteJson from "@model/site.json";
import { baseline } from "@/lib/model/__tests__/helpers";
import { createSite } from "@/lib/model/site";
import { deriveQuantities, parsePricebook, zeroQuantities, type Pricebook, type Quantities } from "../budget";

const model = baseline();
export const { house, derived } = model;
export const site = createSite(siteJson, house.location.houseAxisBearingDeg);

let cache: Quantities | null = null;
/** The quantities of the project's model (computed once, shared: do not mutate). */
export function modelQuantities(): Quantities {
  cache ??= deriveQuantities(house, derived, site);
  return cache;
}

/**
 * A tiny book whose totals can be checked by hand. Quantities used: footprintArea (100) and floorAreaHeated (80).
 *   g1 (shell, 12 %, basis):  100 m2 x 1000 + 2 x 50000                  = 200 000   + overhead 3 % rounded to 1000 = 6 000  -> 206 000
 *   g2 (finish, 12 %):        80 m2 x 500                                =  40 000
 *   g3 (extra, optional, on, 21 %): 3 x 10000                             =  30 000
 *   g4 (option, optional, off, 12 %): 1 x 7000                            =   7 000
 */
export function syntheticBook(): Pricebook {
  return parsePricebook({
    schema: "pricebook/1",
    meta: { status: "reviewed", region: "Test", currency: "CZK", priceYear: 2026, sources: ["test"] },
    vat: { default: "low", classes: { low: 0.12, high: 0.21 } },
    reserve: { default: 0.1, min: 0, max: 0.15, step: 0.01 },
    siteOverhead: { id: "overhead", name: { cs: "Vedlejší náklady", en: "Ancillary costs" }, groupId: "g1", share: 0.03, roundTo: 1000 },
    benchmark: { perM2Low: 1000, perM2High: 2000 },
    groups: [
      {
        id: "g1", name: { cs: "Hrubá stavba", en: "Shell" }, optional: false, defaultOn: true, vat: "low", siteOverheadBasis: true,
        lines: [
          { id: "a", name: { cs: "Deska", en: "Slab" }, unit: "m2", quantity: { ref: "footprintArea" }, price: 1000 },
          { id: "b", name: { cs: "Přípojka, \"hlavní\"; a další", en: "Connection, \"main\"; and more" }, unit: "set", quantity: { value: 2 }, price: 50000 },
        ],
      },
      {
        id: "g2", name: { cs: "Dokončení", en: "Finishing" }, optional: false, defaultOn: true, vat: "low", siteOverheadBasis: false,
        lines: [{ id: "c", name: { cs: "Podlaha", en: "Floor" }, unit: "m2", quantity: { ref: "floorAreaHeated", factor: 1 }, price: 500, waste: 0.1 }],
      },
      {
        id: "g3", name: { cs: "Doplněk", en: "Extra" }, optional: true, defaultOn: true, vat: "high", siteOverheadBasis: false,
        lines: [{ id: "d", name: { cs: "Doplněk", en: "Extra item" }, unit: "pcs", quantity: { value: 3 }, price: 10000 }],
      },
      {
        id: "g4", name: { cs: "Volba", en: "Option" }, optional: true, defaultOn: false, vat: "low", siteOverheadBasis: false,
        lines: [{ id: "e", name: { cs: "Volba", en: "Option item" }, unit: "pcs", quantity: { value: 1 }, price: 7000 }],
      },
    ],
  });
}

export function syntheticQuantities(): Quantities {
  return { ...zeroQuantities(), footprintArea: 100, floorAreaHeated: 80 };
}

/** A small RFC 4180 reader: quoted cells, doubled quotes, line breaks inside quotes. Returns the rows without the BOM. */
export function readCsv(text: string, sep: string): string[][] {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\r" && src[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Deterministic pseudo-random numbers for property tests. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
