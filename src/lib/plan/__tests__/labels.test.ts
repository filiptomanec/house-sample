// Placement of plan texts: invariants for every room and several scales (phone to wide desktop), no numbers of the house.
import { describe, expect, it } from "vitest";
import { derived } from "@/lib/model/instance";
import { buildPlanDrawing } from "../planGeometry";
import { HALO, MONO_W, SANS_W, fontSizes, itemLabel, layoutRoomLabels, layoutWindowLabels } from "../labels";

const drawing = buildPlanDrawing(derived);
const scales = [10, 14, 25, 40, 70];
const inputs = drawing.rooms.map((r, i) => ({ id: r.id, number: String(i + 1), area: (r.area).toFixed(1).replace(".", ","), at: r.label.at, spanX: r.label.spanX, spanY: r.label.spanY }));

describe("fontSizes", () => {
  it("holds the on-screen size while the size in metres stays in range", () => {
    for (const s of scales) {
      const f = fontSizes(s);
      for (const v of Object.values(f)) expect(v).toBeGreaterThan(0);
      expect(f.number).toBeGreaterThanOrEqual(0.26);
      expect(f.number).toBeLessThanOrEqual(0.6);
    }
    expect(fontSizes(40).number * 40).toBeCloseTo(12, 6);
    expect(fontSizes(10).number).toBe(0.6); // phone: capped in metres
  });
});

describe("layoutRoomLabels", () => {
  it.each(scales)("keeps every label inside the free span of its room at %d px/m", (s) => {
    const labels = layoutRoomLabels(inputs, s);
    expect(labels).toHaveLength(inputs.length);
    for (const [i, l] of labels.entries()) {
      const r = inputs[i], [a, b] = r.spanX;
      const wN = (r.number.length * MONO_W) * l.number.fs, wA = (r.area.length * MONO_W) * l.area.fs;
      expect(l.number.fs).toBeGreaterThan(0);
      expect(l.area.fs).toBeLessThanOrEqual(l.number.fs + 1e-9);
      if (l.mode === "stack") {
        const w = Math.max(wN, wA);
        expect(l.number.x - w / 2).toBeGreaterThanOrEqual(a - 1e-9);
        expect(l.number.x + w / 2).toBeLessThanOrEqual(b + 1e-9);
        expect(l.area.y).toBeGreaterThan(l.number.y);
        // the pair fits into the height at the label point
        const top = l.number.y - l.number.fs * 0.75, bottom = l.area.y + l.area.fs * 0.25;
        expect(bottom - top).toBeLessThanOrEqual((r.spanY[1] - r.spanY[0]) * 1.001);
      } else {
        expect(l.number.x).toBeGreaterThanOrEqual(a - 1e-9);
        expect(l.area.x + wA).toBeLessThanOrEqual(b + 1e-9);
        expect(l.area.x).toBeGreaterThan(l.number.x + wN - 1e-9);
      }
    }
  });

  it("dims a label that lies under a box and leaves the others alone", () => {
    const r = inputs[0];
    const near = layoutRoomLabels([r], 30, [{ cx: r.at[0], cy: r.at[1], hw: 0.5, hh: 0.5 }])[0];
    const far = layoutRoomLabels([r], 30, [{ cx: r.at[0] + 50, cy: r.at[1], hw: 0.5, hh: 0.5 }])[0];
    expect(near.dim).toBe(true);
    expect(far.dim).toBe(false);
  });

  it("uses a row in a low room and a stack in a tall one", () => {
    const wide = layoutRoomLabels([{ id: "a", number: "7", area: "9,5", at: [5, -5], spanX: [0, 10], spanY: [-5.5, -4.5] }], 30)[0];
    const tall = layoutRoomLabels([{ id: "b", number: "7", area: "9,5", at: [5, -5], spanX: [0, 10], spanY: [-8, -2] }], 30)[0];
    expect(wide.mode).toBe("stack"); // 1 m is enough at 30 px/m
    const thin = layoutRoomLabels([{ id: "c", number: "7", area: "9,5", at: [5, -5], spanX: [0, 10], spanY: [-5.2, -4.8] }], 30)[0];
    expect(thin.mode).toBe("row");
    expect(tall.mode).toBe("stack");
  });
});

describe("layoutWindowLabels", () => {
  const exterior = drawing.openings.filter((o) => o.facade);
  const items = exterior.map((o) => ({ id: o.id, text: `${Math.round(o.w * 1000)} × ${Math.round(o.h * 1000)}`, at: o.facade!.at, out: o.facade!.out }));
  const v = drawing.viewBox, bounds: [number, number, number, number] = [v.x, v.y, v.x + v.w, v.y + v.h];

  it.each([0.19, 0.3, 0.42])("keeps labels of one facade apart and inside the drawing (font %d m)", (fs) => {
    const labels = layoutWindowLabels(items, fs, bounds);
    expect(labels).toHaveLength(items.length);
    const box = (l: (typeof labels)[number]) => (l.rot === 0 ? [l.x - l.len / 2, l.y - l.height / 2, l.x + l.len / 2, l.y + l.height / 2] : [l.x - l.height / 2, l.y - l.len / 2, l.x + l.height / 2, l.y + l.len / 2]);
    for (const l of labels) {
      const b = box(l);
      expect(b[0]).toBeGreaterThanOrEqual(bounds[0] - 1e-9);
      expect(b[2]).toBeLessThanOrEqual(bounds[2] + 1e-9);
      expect(b[1]).toBeGreaterThanOrEqual(bounds[1] - 1e-9);
      expect(b[3]).toBeLessThanOrEqual(bounds[3] + 1e-9);
    }
    // labels of one facade (same outward direction) do not overlap, except where the drawing edge pins them
    const sameFacade = (a: number, b: number) => items[a].out[0] === items[b].out[0] && items[a].out[1] === items[b].out[1];
    let overlaps = 0;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      if (!sameFacade(i, j)) continue;
      const p = box(labels[i]), q = box(labels[j]);
      if (p[0] < q[2] - 1e-6 && q[0] < p[2] - 1e-6 && p[1] < q[3] - 1e-6 && q[1] < p[3] - 1e-6) overlaps++;
    }
    expect(overlaps).toBe(0);
  });

  it("turns labels on vertical facades", () => {
    const labels = layoutWindowLabels(items, 0.3, bounds);
    for (const [i, l] of labels.entries()) expect(l.rot).toBe(Math.abs(items[i].out[0]) > Math.abs(items[i].out[1]) ? -90 : 0);
  });
});

describe("itemLabel", () => {
  it("fits a name into its rectangle when it can, on one or two lines", () => {
    const one = itemLabel("Sofa", 2.2, 0.95, 0.4, 0.1);
    expect(one.over).toBe(false);
    expect(one.lines).toEqual(["Sofa"]);
    expect(Math.max(...one.lines.map((l) => l.length)) * SANS_W * one.fs).toBeLessThanOrEqual(2.2);
    const two = itemLabel("Kitchen island unit", 0.8, 0.8, 0.4, 0.05);
    expect(two.lines.length).toBeGreaterThan(1);
    expect(two.over).toBe(false);
  });

  it("writes along the long side and overflows at the minimum size when nothing fits", () => {
    expect(itemLabel("Wardrobe", 0.6, 2, 0.4, 0.1).vertical).toBe(true);
    const tiny = itemLabel("Washing machine", 0.2, 0.2, 0.4, 0.14);
    expect(tiny.over).toBe(true);
    expect(tiny.fs).toBe(0.14);
  });

  it("has a halo thickness that is a fraction of the em", () => {
    expect(HALO).toBeGreaterThan(0);
    expect(HALO).toBeLessThan(1);
  });
});
