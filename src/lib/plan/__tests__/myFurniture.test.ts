// "My furniture" and the measuring tool: pure rules, round trips of stored data, hostile input.
import { describe, expect, it } from "vitest";
import { FURNITURE } from "@/lib/model/catalog";
import {
  MAX_ITEMS, PRESET_TYPES, SIZE_RANGE, SNAP, addItem, footprint, itemRect, measure, moveItem, newItem, parseItems, placeItem, rotateItem, serializeItems, snap, snapPt,
  type MyItem,
} from "../myFurniture";

const bounds: [number, number, number, number] = [-2, -3, 20, 12];
const sample = (over: Partial<MyItem> = {}): MyItem => ({ kind: "custom", w: 1.2, d: 0.6, x: 4, y: 3, rot: 0, ...over });

describe("presets", () => {
  it("offers fourteen distinct pieces of the catalogue", () => {
    expect(PRESET_TYPES).toHaveLength(14);
    expect(new Set(PRESET_TYPES).size).toBe(14);
    for (const t of PRESET_TYPES) expect(FURNITURE[t].name.cs.length).toBeGreaterThan(0);
  });
});

describe("snapping", () => {
  it("snaps to the 5 cm grid and is idempotent", () => {
    for (const v of [0, 0.024, 0.026, 1.4499, -3.333, 17.771]) {
      const s = snap(v);
      expect(Math.abs(s - v)).toBeLessThanOrEqual(SNAP / 2 + 1e-9);
      expect(Math.abs(s / SNAP - Math.round(s / SNAP))).toBeLessThan(1e-9);
      expect(snap(s)).toBe(s);
    }
    expect(snap(1.4500000000000002)).toBe(1.45);
    expect(snapPt([0.51, 0.49])).toEqual([0.5, 0.5]);
  });
});

describe("geometry of an item", () => {
  it("swaps width and depth on quarter turns and keeps the area", () => {
    let i = sample();
    const area = i.w * i.d;
    for (const rot of [0, 90, 180, 270]) {
      expect(i.rot).toBe(rot);
      const f = footprint(i), r = itemRect(i);
      expect(f.w * f.d).toBeCloseTo(area, 12);
      expect(r[2] - r[0]).toBeCloseTo(f.w, 12);
      expect(r[3] - r[1]).toBeCloseTo(f.d, 12);
      expect((r[0] + r[2]) / 2).toBeCloseTo(i.x, 12); // turns about the centre
      expect((r[1] + r[3]) / 2).toBeCloseTo(i.y, 12);
      i = rotateItem(i);
    }
    expect(i).toEqual(sample());
  });

  it("keeps a moved item inside the bounds and on the grid", () => {
    const m = moveItem(sample({ x: 19.9 }), 5, -50, bounds);
    const r = itemRect(m);
    expect(r[2]).toBeLessThanOrEqual(bounds[2] + 1e-9);
    expect(r[1]).toBeGreaterThanOrEqual(bounds[1] - 1e-9);
    expect(placeItem(sample(), 1.234, 2.345, bounds).x).toBe(1.25);
  });

  it("centres an item that is larger than the area", () => {
    const m = placeItem(sample({ w: 6, d: 6 }), 100, 100, [0, 0, 4, 4]);
    expect([m.x, m.y]).toEqual([2, 2]);
  });

  it("creates catalogue and custom pieces, clamping custom sizes", () => {
    const bed = newItem("bed180", null, [5, 5], bounds);
    expect([bed.w, bed.d]).toEqual([FURNITURE.bed180.w, FURNITURE.bed180.d]);
    const huge = newItem("custom", { w: 99, d: 0.001 }, [5, 5], bounds);
    expect(huge.w).toBe(SIZE_RANGE[1]);
    expect(huge.d).toBe(SIZE_RANGE[0]);
  });

  it("caps the list and drops the oldest piece", () => {
    let list: MyItem[] = [];
    for (let i = 0; i < MAX_ITEMS + 5; i++) list = addItem(list, sample({ x: i }));
    expect(list).toHaveLength(MAX_ITEMS);
    expect(list[0].x).toBe(5);
  });
});

describe("stored data", () => {
  it("round-trips through JSON", () => {
    const items = [sample(), sample({ kind: "bed180", w: 1.8, d: 2, x: 7.25, y: -1, rot: 270 })];
    expect(parseItems(JSON.parse(JSON.stringify(serializeItems(items))))).toEqual(items);
  });

  it("returns null for data that is not a list and drops bad entries", () => {
    for (const bad of [null, 5, "x", [], {}, { items: "no" }]) expect(parseItems(bad)).toBeNull();
    const parsed = parseItems({ items: [sample(), { kind: "toString", w: 1, d: 1, x: 0, y: 0, rot: 0 }, { kind: "custom", w: "1", d: 1, x: 0, y: 0, rot: 0 },
      { kind: "custom", w: 1, d: 1, x: 0, y: 0, rot: 45 }, { kind: "custom", w: NaN, d: 1, x: 0, y: 0, rot: 0 }, null, 3, sample({ w: 50, x: 1e9 })] });
    expect(parsed).toHaveLength(2);
    expect(parsed![1].w).toBe(SIZE_RANGE[1]);
    expect(parsed![1].x).toBe(1000);
  });

  it("keeps at most MAX_ITEMS pieces", () => {
    const many = { items: Array.from({ length: MAX_ITEMS + 10 }, (_, i) => sample({ x: i })) };
    expect(parseItems(many)).toHaveLength(MAX_ITEMS);
  });
});

describe("measure", () => {
  it("gives the distance and its components (3-4-5 triangle and symmetry)", () => {
    const m = measure([1, 1], [4, 5]);
    expect(m).toEqual({ length: 5, dx: 3, dy: 4 });
    expect(measure([4, 5], [1, 1])).toEqual(m);
    expect(measure([2, 2], [2, 2]).length).toBe(0);
  });
});
