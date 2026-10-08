// Placement of plan texts: invariants for every room and several scales (phone to wide desktop), no numbers of the house.
import { describe, expect, it } from "vitest";
import { derived } from "@/lib/model/instance";
import { buildPlanDrawing } from "../planGeometry";
import { HALO, MIN_LABEL_PX, MONO_W, OUTDOOR_TRACKING, SANS_W, fontSizes, itemLabel, layoutOutdoorLabels, layoutRoomLabels, layoutWindowLabels } from "../labels";

const drawing = buildPlanDrawing(derived, { garden: true });
const scales = [10, 14, 25, 40, 70];
const inputs = drawing.rooms.map((r, i) => ({ id: r.id, number: String(i + 1), area: (r.area).toFixed(1).replace(".", ","), at: r.label.at, spanX: r.label.spanX, spanY: r.label.spanY }));

describe("fontSizes", () => {
  it("holds the on-screen size while the size in metres stays in range", () => {
    for (const s of scales) {
      const f = fontSizes(s);
      for (const v of Object.values(f)) expect(v).toBeGreaterThan(0);
      expect(f.number).toBeGreaterThanOrEqual(0.26);
      expect(f.number).toBeLessThanOrEqual(0.9);
      expect(f.area).toBeLessThanOrEqual(f.number);
    }
    expect(fontSizes(40).number * 40).toBeCloseTo(12, 6);
    // a phone (about 13 px per metre): the number is still at least the smallest readable size on screen
    expect(fontSizes(13).number * 13).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    expect(fontSizes(5).number).toBe(0.9); // capped in metres
  });
});

describe("layoutRoomLabels", () => {
  it.each(scales)("keeps every label inside the free span of its room, or at the smallest readable size on its point, at %d px/m", (s) => {
    const labels = layoutRoomLabels(inputs, s);
    expect(labels).toHaveLength(inputs.length);
    for (const [i, l] of labels.entries()) {
      const r = inputs[i], [a, b] = r.spanX;
      // never smaller on screen than the minimum (two colliding small labels may give up a quarter of it)
      expect(l.number.fs * s).toBeGreaterThanOrEqual(MIN_LABEL_PX * 0.75 - 1e-9);
      if (!l.area) {
        // too small a room for the whole label: the number alone, at the smallest size centred on the label point, or
        // larger and inside the span
        const wN = (r.number.length * MONO_W) * l.number.fs;
        if (l.number.fs * s <= MIN_LABEL_PX + 1e-9) expect(l.number.x).toBeCloseTo(r.at[0], 9);
        else { expect(l.number.x - wN / 2).toBeGreaterThanOrEqual(a - 1e-9); expect(l.number.x + wN / 2).toBeLessThanOrEqual(b + 1e-9); }
        continue;
      }
      const wN = (r.number.length * MONO_W) * l.number.fs, wA = (r.area.length * MONO_W) * l.area.fs;
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

  it("shows the area beside the number on a desktop scale in every room large enough for it", () => {
    const labels = layoutRoomLabels(inputs, 40);
    const roomy = inputs.filter((r) => r.spanX[1] - r.spanX[0] > 2.5 && r.spanY[1] - r.spanY[0] > 1.5).map((r) => r.id);
    expect(roomy.length).toBeGreaterThan(0);
    for (const l of labels) if (roomy.includes(l.id)) expect(l.area).not.toBeNull();
  });

  it("parts two small labels that would meet on a narrow phone", () => {
    const a = { id: "a", number: "1.12", area: "5,3", at: [0, 0] as [number, number], spanX: [-0.9, 0.9] as [number, number], spanY: [-1.5, 1.5] as [number, number] };
    const b = { ...a, id: "b", at: [2, 0] as [number, number], spanX: [1.1, 2.9] as [number, number] };
    const s = 9;
    const [la, lb] = layoutRoomLabels([a, b], s);
    expect(la.area).toBeNull();
    expect(lb.area).toBeNull();
    const half = (l: typeof la) => ((4 * MONO_W + HALO) * l.number.fs) / 2;
    expect(half(la) + half(lb)).toBeLessThanOrEqual(2 + 1e-6);
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

describe("layoutOutdoorLabels", () => {
  const named = drawing.outdoor.filter((o) => o.name !== null);
  const items = named.map((o) => ({ id: o.id, text: o.name!.cs, at: o.label.at, w: o.label.w, h: o.label.h, rect: o.rect }));
  const v = drawing.viewBox, bounds: [number, number, number, number] = [v.x, v.y, v.x + v.w, v.y + v.h];
  const house = drawing.rooms.flatMap((r) => r.rings).map((q): [number, number, number, number] => {
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  const boxOf = (l: { x: number; y: number; rot: number; len: number; height: number }) =>
    (l.rot === 0 ? [l.x - l.len / 2, l.y - l.height / 2, l.x + l.len / 2, l.y + l.height / 2] : [l.x - l.height / 2, l.y - l.len / 2, l.x + l.height / 2, l.y + l.len / 2]);
  const hit = (a: number[], b: readonly number[]) => a[0] < b[2] - 1e-9 && b[0] < a[2] - 1e-9 && a[1] < b[3] - 1e-9 && b[1] < a[3] - 1e-9;

  it.each([0.2, 0.3, 0.42])("names fit their area or sit beside it clear of the house and of each other, inside the drawing (font %d m)", (fs) => {
    expect(items.length).toBeGreaterThan(0);
    const labels = layoutOutdoorLabels(items, fs, house, bounds);
    for (const l of labels) {
      const b = boxOf(l), it = items.find((q) => q.id === l.id)!;
      expect(l.len).toBeCloseTo(l.text.length * (MONO_W + OUTDOOR_TRACKING) * fs, 9);
      expect(b[0]).toBeGreaterThanOrEqual(bounds[0] - 1e-9);
      expect(b[2]).toBeLessThanOrEqual(bounds[2] + 1e-9);
      expect(b[1]).toBeGreaterThanOrEqual(bounds[1] - 1e-9);
      expect(b[3]).toBeLessThanOrEqual(bounds[3] + 1e-9);
      if (l.inside) {
        // inside the free cell of its own area
        expect(b[0]).toBeGreaterThanOrEqual(it.at[0] - it.w / 2 - 1e-9);
        expect(b[2]).toBeLessThanOrEqual(it.at[0] + it.w / 2 + 1e-9);
      } else for (const h of house) expect(hit(b, h)).toBe(false);
    }
    labels.forEach((p, i) => labels.forEach((q, j) => { if (i < j) expect(hit(boxOf(p), boxOf(q))).toBe(false); }));
  });

  it("writes a name along a tall narrow cell and leaves out a name that fits nowhere", () => {
    const tall = layoutOutdoorLabels([{ id: "t", text: "TERRACE", at: [0, 0], w: 0.8, h: 6, rect: [-0.4, -3, 0.4, 3] }], 0.3, [], [-10, -10, 10, 10]);
    expect(tall[0].rot).toBe(-90);
    expect(tall[0].inside).toBe(true);
    const none = layoutOutdoorLabels([{ id: "n", text: "A LONG NAME", at: [0, 0], w: 0.5, h: 0.5, rect: [-0.25, -0.25, 0.25, 0.25] }], 0.3, [[-5, -5, 5, 5]], [-2, -2, 2, 2]);
    expect(none).toEqual([]);
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
