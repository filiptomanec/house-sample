// Outdoor slabs and the pool built from the derived data where the GLB lacks them: the cut-outs, the tops on the grade planes
// (the drive and the path are ramps), nothing built when the GLB has everything.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { buildOutdoorFallback, outdoorFallback, rectMinusRects, slabTop, type Rect4 } from "./outdoor";

const ctx = getHouseContext();
const area = (r: Rect4) => (r[2] - r[0]) * (r[3] - r[1]);
const overlap = (a: Rect4, b: Rect4) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

describe("rectMinusRects", () => {
  it("tiles the rectangle minus the holes with disjoint rectangles of the right area", () => {
    const cases: [Rect4, Rect4[]][] = [
      [[0, 0, 10, 6], []],
      [[0, 0, 10, 6], [[2, 1, 5, 3]]],
      [[0, 0, 10, 6], [[2, 1, 5, 3], [6, 2, 12, 4]]],
      [[0, 0, 10, 6], [[-1, -1, 11, 7]]],
      [[0, 0, 10, 6], [[20, 20, 30, 30]]],
    ];
    for (const [r, holes] of cases) {
      const parts = rectMinusRects(r, holes);
      const clipped = holes.map((h) => overlap(r, h));
      const expected = area(r) - clipped.reduce((s, x) => s + x, 0);
      expect(parts.reduce((s, p) => s + area(p), 0)).toBeCloseTo(expected, 9);
      for (let i = 0; i < parts.length; i++) {
        for (const h of holes) expect(overlap(parts[i], h)).toBeCloseTo(0, 12);
        for (let j = i + 1; j < parts.length; j++) expect(overlap(parts[i], parts[j])).toBeCloseTo(0, 12);
        expect(parts[i][0] >= r[0] && parts[i][2] <= r[2] && parts[i][1] >= r[1] && parts[i][3] <= r[3]).toBe(true);
      }
    }
  });
});

describe("outdoorFallback", () => {
  it("builds nothing when the GLB holds every area and the water", () => {
    const ids = new Set(ctx.derived.outdoor.map((o) => o.id));
    const plan = outdoorFallback(ctx, ids, new Set(["water"]));
    expect(plan.slabs).toHaveLength(0);
    expect(plan.pools).toHaveLength(0);
  });

  it("builds every missing area as its rect minus its holes, on its grade plane, and every missing pool with its coping, liner and water", () => {
    const plan = outdoorFallback(ctx, new Set(), new Set());
    for (const o of ctx.derived.outdoor) {
      const mine = plan.slabs.filter((s) => s.id === o.id);
      expect(mine.length, o.id).toBeGreaterThan(0);
      for (const s of mine) expect(s.role).toBe(o.role);
      if (o.pool) {
        const p = plan.pools.find((x) => x.id === o.id)!;
        expect(p.water).toEqual(o.pool.water);
        expect(p.floorZ).toBeLessThan(p.waterZ);
        expect(p.waterZ).toBeLessThan(p.top);
        // the coping ring: outer minus water
        expect(mine.reduce((sum, s) => sum + area(s.rect), 0)).toBeCloseTo(area(o.pool.outer as Rect4) - area(o.pool.water as Rect4), 6);
      } else {
        const holes = o.holes.reduce((sum, h) => sum + overlap(o.rect as Rect4, h as Rect4), 0);
        expect(mine.reduce((sum, s) => sum + area(s.rect), 0)).toBeCloseTo(area(o.rect as Rect4) - holes, 6);
        // the top follows the grade plane of the area (the ramps of the drive and the path included)
        const [x0, y0, x1, y1] = o.rect;
        for (const [x, y] of [[x0, y0], [x1, y1]] as const) {
          const pl = o.grade.plane;
          expect(slabTop(mine[0], x, y)).toBeCloseTo(pl.z0 + pl.gx * (x - pl.ox) + pl.gy * (y - pl.oy), 9);
        }
      }
    }
  });

  it("puts the slabs of a deck with a pool around the hole, never over the water", () => {
    const plan = outdoorFallback(ctx, new Set(), new Set());
    for (const o of ctx.derived.outdoor.filter((x) => x.pool)) {
      for (const s of plan.slabs.filter((x) => x.id !== o.id)) expect(overlap(s.rect, o.pool!.water as Rect4), s.id).toBeCloseTo(0, 9);
    }
  });
});

describe("buildOutdoorFallback", () => {
  it("makes one mesh per role, the water at the water level, all of it in the scene frame", () => {
    const plan = outdoorFallback(ctx, new Set(), new Set());
    const mats = new Map<string, THREE.Material>();
    const group = buildOutdoorFallback(plan, (role) => { const m = new THREE.MeshStandardMaterial({ name: role }); mats.set(role, m); return m; });
    const roles = group.children.map((c) => c.userData.role as string);
    expect(new Set(roles).size).toBe(roles.length);
    expect(roles).toEqual(expect.arrayContaining(["water", "pool_liner"]));
    const water = group.children.find((c) => c.userData.role === "water") as THREE.Mesh;
    water.geometry.computeBoundingBox();
    const bb = water.geometry.boundingBox!;
    expect(bb.min.y).toBeCloseTo(plan.pools[0].waterZ, 6);
    expect(bb.max.y).toBeCloseTo(plan.pools[0].waterZ, 6);
    // scene z is minus house y
    expect(-bb.max.z).toBeCloseTo(plan.pools[0].water[1], 6);
    for (const c of group.children) expect(c.userData.fallback).toBe(true);
  });
});
