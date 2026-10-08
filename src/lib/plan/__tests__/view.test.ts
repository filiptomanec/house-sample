// The view model of the floor plan page and the construction cards, against the kernel and metrics of the shared house.
import { describe, expect, it } from "vitest";
import { derived, house, metrics } from "@/lib/model/instance";
import style from "@model/style.json";
import { buildAssemblyCards, buildMaterialLegend, ASSEMBLY_KEYS } from "../assemblies";
import { buildPlanView, roomNumbers, type StyleMaterials } from "../view";

const mat = style as unknown as StyleMaterials;

/** The page sets Czech and English texts with non-breaking spaces; the model has ordinary ones. */
const plain = (text: string): string => text.replaceAll("\u00a0", " ");

describe("roomNumbers", () => {
  it("takes the trailing digits without leading zeros", () => {
    expect(roomNumbers(["R01", "R10", "R2"])).toEqual(["1", "10", "2"]);
  });
  it("falls back to positions when the numbers are not unique or missing", () => {
    expect(roomNumbers(["A1", "B1"])).toEqual(["1", "2"]);
    expect(roomNumbers(["kitchen", "R2"])).toEqual(["1", "2"]);
  });
});

describe.each(["cs", "en"] as const)("buildPlanView (%s)", (locale) => {
  const view = buildPlanView(house, derived, metrics, mat, locale);

  it("is plain data", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("lists every room once, in the order of its number, with its texts in the language", () => {
    expect(view.rooms).toHaveLength(derived.rooms.length);
    expect(new Set(view.rooms.map((r) => r.id)).size).toBe(derived.rooms.length);
    const nums = view.rooms.map((r) => Number(r.number));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    for (const r of view.rooms) {
      const src = derived.rooms.find((q) => q.id === r.id)!;
      expect(plain(r.name)).toBe(plain(src.name[locale]));
      expect(plain(r.zone)).toBe(plain(house.zones[src.zone].label[locale]));
      expect(r.area).toBe(src.area);
      expect(r.volume).toBeCloseTo(r.area * r.height, 3); // the kernel rounds areas and volumes
      expect(r.glazingRatio).toBeCloseTo(r.glazing / r.area, 12);
    }
  });

  it("adds up to the metrics of the model", () => {
    expect(view.totals.floorArea).toBeCloseTo(metrics.netArea + metrics.garageArea, 1); // metrics are rounded to 0.01 m2
    expect(view.totals.glazing).toBeCloseTo(metrics.glazing.total, 1);
    expect(view.totals.footprint).toBe(metrics.footprintArea);
    expect(view.totals.clearHeight).toBe(house.clearHeight);
    expect(view.totals.interiorDoors).toBe(derived.openings.filter((o) => o.kind === "door").length);
  });

  it("lists the exterior openings of the rooms, and their window area is the glazing of the room", () => {
    expect(view.rooms.reduce((s, r) => s + r.openings.length, 0)).toBe(derived.openings.filter((o) => o.exterior && o.room).length);
    for (const r of view.rooms) {
      const glass = r.openings.filter((o) => o.kind === "window" || o.kind === "slider").reduce((s, o) => s + o.w * o.h, 0);
      expect(glass).toBeCloseTo(r.glazing, 6);
    }
  });

  it("starts at the main living room, frames furniture inside the drawing and has a legend for the fills in use", () => {
    expect(derived.rooms.find((r) => r.id === view.initialRoom)?.role).toBe("main-living");
    const v = view.drawing.viewBox;
    expect(view.bounds).toEqual([v.x, -(v.y + v.h), v.x + v.w, -v.y]);
    expect(view.legend.length).toBeGreaterThan(2);
    expect(new Set(view.legend).size).toBe(view.legend.length);
    for (const r of view.drawing.rooms) expect(view.legend).toContain(r.fill);
    expect(view.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("gives every reachable room its distance from the entry", () => {
    for (const r of view.rooms) expect(r.doorsFromEntry === null).toBe(derived.access.unreachable.includes(r.id));
  });
});

describe("construction cards", () => {
  const cards = buildAssemblyCards(house, "en");

  it("has one card per assembly with the model's name and the kernel's U-value", () => {
    expect(cards.map((c) => c.key)).toEqual([...ASSEMBLY_KEYS]);
    expect(new Set(Object.keys(house.assemblies))).toEqual(new Set(ASSEMBLY_KEYS));
    for (const c of cards) {
      expect(plain(c.name)).toBe(plain(house.assemblies[c.key].name.en));
      expect(c.u).toBeCloseTo(derived.assemblies[c.key].U, 4);
      expect(c.r).toBeCloseTo(derived.assemblies[c.key].R, 4);
      expect(c.thickness).toBeCloseTo(derived.assemblies[c.key].thickness, 9);
    }
  });

  it("lists every layer, with shares that add up to the resistance of the layers", () => {
    for (const c of cards) {
      const src = house.assemblies[c.key];
      expect(c.layers).toHaveLength(src.layers.length);
      expect(c.layers.map((l) => plain(l.name))).toEqual(src.layers.map((l) => plain(l.name.en)));
      expect(c.layers.reduce((s, l) => s + l.thickness, 0)).toBeCloseTo(c.thickness, 9);
      const share = c.layers.reduce((s, l) => s + l.share, 0);
      expect(share).toBeGreaterThan(0.5); // surface resistances take the rest
      expect(share).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("material legend", () => {
  it("has the floors in use once each, then the facade materials, with colours of the style", () => {
    const floors = derived.rooms.map((r) => r.floor).filter((f): f is NonNullable<typeof f> => Boolean(f));
    const rows = buildMaterialLegend(house, floors, mat, "cs");
    expect(new Set(rows.map((r) => r.role)).size).toBe(rows.length);
    for (const f of new Set(floors)) expect(rows.map((r) => r.role)).toContain(`floor_${f}`);
    for (const r of rows) {
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(rows.map((r) => r.role)).toContain("glass");
  });
});
