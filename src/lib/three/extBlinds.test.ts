import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { EXT_BLIND_SPEC, blindSections, slatHeights } from "./extBlinds";
import { outwardNormalHouse } from "./frame";

const ctx = getHouseContext();
const sections = blindSections(ctx);
const ring = ctx.derived.outline.polygons[0].pts;

const insideRing = (x: number, y: number) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
  return c;
};
const distToEdges = (x: number, y: number) =>
  Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  }));

describe("blind sections", () => {
  const blinded = ctx.derived.openings.filter((o) => o.blind);

  it("exist for exactly the openings the shading rule gives a blind, and for no others", () => {
    expect(blinded.length).toBeGreaterThan(0);
    expect(new Set(sections.map((s) => s.opening))).toEqual(new Set(blinded.map((o) => o.id)));
  });

  it("tile the width of the opening exactly, none wider than the product allows", () => {
    for (const o of blinded) {
      const parts = sections.filter((s) => s.opening === o.id);
      expect(parts.reduce((w, s) => w + s.width, 0), o.id).toBeCloseTo(o.w, 9);
      expect(parts.length).toBe(Math.max(1, Math.ceil(o.w / EXT_BLIND_SPEC.maxSectionWidth - 1e-9)));
      for (const s of parts) {
        expect(s.width).toBeLessThanOrEqual(EXT_BLIND_SPEC.maxSectionWidth + 1e-9);
        expect(s.width).toBeCloseTo(parts[0].width, 9);
      }
      // consecutive sections join: the next one starts where the previous ends along the wall
      for (let k = 1; k < parts.length; k++) {
        const a = parts[k - 1], b = parts[k];
        expect(b.origin[0]).toBeCloseTo(a.origin[0] + a.along[0] * a.width, 9);
        expect(b.origin[1]).toBeCloseTo(a.origin[1] + a.along[1] * a.width, 9);
      }
    }
  });

  it("lie between the ends of the opening along its wall", () => {
    for (const o of blinded) {
      const parts = sections.filter((s) => s.opening === o.id);
      const coord = (p: readonly [number, number]) => (o.orient === "h" ? p[0] : p[1]);
      const ends = parts.flatMap((s) => [coord(s.origin), coord(s.origin) + (o.orient === "h" ? s.along[0] : s.along[1]) * s.width]);
      expect(Math.min(...ends), o.id).toBeCloseTo(o.from, 9);
      expect(Math.max(...ends), o.id).toBeCloseTo(o.to, 9);
    }
  });

  it("start on the outer face of the wall: half the wall thickness from the axis and on the outline of the building", () => {
    for (const s of sections) {
      const o = ctx.derived.openings.find((x) => x.id === s.opening)!;
      const wall = ctx.derived.walls.find((w) => w.id === o.wallId)!;
      const across = o.orient === "h" ? s.origin[1] - wall.at : s.origin[0] - wall.at;
      expect(Math.abs(across)).toBeCloseTo(wall.t / 2, 9);
      expect(distToEdges(s.origin[0], s.origin[1])).toBeLessThan(1e-6);
    }
  });

  it("face away from the building: the normal is the outward normal of the opening, along is perpendicular to it", () => {
    for (const s of sections) {
      const o = ctx.derived.openings.find((x) => x.id === s.opening)!;
      const n = outwardNormalHouse(o.azimuth!);
      expect(s.normal[0]).toBeCloseTo(n[0], 9);
      expect(s.normal[1]).toBeCloseTo(n[1], 9);
      expect(s.along[0] * s.normal[0] + s.along[1] * s.normal[1]).toBeCloseTo(0, 9);
      const mid = [s.origin[0] + (s.along[0] * s.width) / 2, s.origin[1] + (s.along[1] * s.width) / 2];
      expect(insideRing(mid[0] + n[0] * 0.1, mid[1] + n[1] * 0.1)).toBe(false);
      expect(insideRing(mid[0] - n[0] * 0.1, mid[1] - n[1] * 0.1)).toBe(true);
    }
  });

  it("takes the heights from the opening and the box height from the shading rule", () => {
    for (const s of sections) {
      const o = ctx.derived.openings.find((x) => x.id === s.opening)!;
      expect(s.sill).toBe(o.sill);
      expect(s.head).toBe(o.head);
      expect(s.boxHeight).toBe(ctx.house.shading.blinds.boxHeight);
    }
  });
});

describe("the curtain stands behind the facade", () => {
  const { reveal, slatWidth, slatThickness, railDepth, boxDepth } = EXT_BLIND_SPEC;
  // half the depth the slat box reaches for a tilt, seen across the wall (0 = horizontal and open, 90 = closed)
  const halfDepth = (tiltDeg: number) => {
    const t = (tiltDeg * Math.PI) / 180;
    return (slatWidth / 2) * Math.cos(t) + (slatThickness / 2) * Math.sin(t);
  };

  it("keeps every slat at least 1 cm behind the outer face of the wall at every tilt", () => {
    for (let tilt = 0; tilt <= 90; tilt += 5) expect(reveal - halfDepth(tilt), `tilt ${tilt}`).toBeGreaterThanOrEqual(0.01 - 1e-9);
    expect(reveal - railDepth / 2).toBeGreaterThanOrEqual(0.01 - 1e-9);
    expect(reveal - boxDepth / 2).toBeGreaterThan(0);
  });

  it("keeps the open slats in front of the glazing frame, which the pipeline sets back from the face", () => {
    const params = readFileSync(join(__dirname, "..", "..", "..", "pipeline", "blender", "hb", "params.py"), "utf8");
    const setback = Number(/"setback":\s*([\d.]+)/.exec(params)?.[1]);
    expect(setback).toBeGreaterThan(0);
    expect(reveal + halfDepth(0)).toBeLessThanOrEqual(setback - 0.005 + 1e-9);
  });
});

describe("slatHeights", () => {
  const s = { sill: 0.9, head: 2.4 };

  it("has no slat with the blind raised and fills the opening from the head down when lowered", () => {
    expect(slatHeights(s, 0)).toEqual([]);
    const all = slatHeights(s, 1);
    expect(all.length).toBeGreaterThan(10);
    for (let i = 1; i < all.length; i++) expect(all[i - 1] - all[i]).toBeCloseTo(EXT_BLIND_SPEC.slatPitch, 9);
    expect(all[0]).toBeLessThan(s.head);
    expect(all[all.length - 1]).toBeGreaterThanOrEqual(s.sill - 1e-9);
  });

  it("lowers monotonically: a deeper drop never has fewer slats, and the slats it had stay where they were", () => {
    let prev: number[] = [];
    for (const drop of [0, 0.2, 0.5, 0.8, 1]) {
      const z = slatHeights(s, drop);
      expect(z.length).toBeGreaterThanOrEqual(prev.length);
      expect(z.slice(0, prev.length)).toEqual(prev);
      prev = z;
    }
  });
});
