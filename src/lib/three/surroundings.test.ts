import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { fromScene } from "./frame";
import { DROPPED_KERB_REVEAL, pointInPolygon, projectToPolyline, type XY } from "@/lib/model/site";
import { PILLAR_LAYOUT, SURROUNDINGS, binsOnPads, boardRows, fenceSpans, gateLeaf, kerbPieces, neighbourMeshes, ridgeRise, rotatedRect, splitPolyline } from "./surroundings";

const ctx = getHouseContext();

const area = (ring: [number, number][]) => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);

describe("rotatedRect", () => {
  it("is a counter-clockwise rectangle of the given size about the centre, whatever the angle", () => {
    for (const rot of [0, 2, 37, 90, 181, -15]) {
      const ring = rotatedRect([5, -3], [10, 4], rot);
      expect(area(ring)).toBeCloseTo(40, 9);
      const cx = ring.reduce((s, p) => s + p[0], 0) / 4, cy = ring.reduce((s, p) => s + p[1], 0) / 4;
      expect(cx).toBeCloseTo(5, 9);
      expect(cy).toBeCloseTo(-3, 9);
      expect(Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1])).toBeCloseTo(10, 9);
    }
  });

  it("grows by the same amount on every side", () => {
    expect(area(rotatedRect([0, 0], [10, 4], 30, 0.5))).toBeCloseTo(11 * 5, 9);
  });
});

describe("splitPolyline", () => {
  it("cuts a path into pieces that are no longer than the step and join end to start", () => {
    const path: [number, number][] = [[0, 0], [7, 0], [7, 5]];
    const pieces = splitPolyline(path, 2);
    for (const [a, b] of pieces) expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(2 + 1e-9);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toEqual(pieces[i - 1][1]);
    const total = pieces.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    expect(total).toBeCloseTo(12, 9);
  });
});

describe("neighbour houses", () => {
  const { walls, roofs } = neighbourMeshes(ctx);
  const heights = (mb: typeof walls) => {
    const p = mb.positions;
    const ys: number[] = [];
    for (let i = 1; i < p.length; i += 3) ys.push(p[i]);
    return ys;
  };
  const houses = ctx.site.model.neighbours;

  it("builds walls and a roof for every neighbour", () => {
    expect(houses.length).toBeGreaterThan(0);
    expect(walls.triangleCount).toBeGreaterThan(houses.length * 8);
    expect(roofs.triangleCount).toBeGreaterThan(houses.length * 4);
  });

  it("has the wall tops at the eave height above the ground of the house and the roof above them", () => {
    for (const nb of houses) {
      const h = nb.house;
      const top = ctx.site.terrain.groundAt(h.center[0], h.center[1]) + h.eaveHeight;
      // wall tops of this house are among the wall vertices at that height
      expect(heights(walls).some((y) => Math.abs(y - top) < 1e-6)).toBe(true);
    }
    const maxRoof = Math.max(...heights(roofs)), maxWall = Math.max(...heights(walls));
    expect(maxRoof).toBeGreaterThan(maxWall - 1e-9);
  });

  it("keeps the eave below the wall top by the overhang times the slope, and the ridge above it by the shorter half-span times the slope", () => {
    for (const nb of houses) {
      const { size, roof, eaveHeight, center } = nb.house;
      const top = ctx.site.terrain.groundAt(center[0], center[1]) + eaveHeight;
      if (roof.kind === "flat") continue;
      const t = Math.tan((roof.pitchDeg * Math.PI) / 180);
      expect(ridgeRise(roof.pitchDeg, size[0] / 2, size[1] / 2)).toBeCloseTo((Math.min(size[0], size[1]) / 2) * t, 9);
      const ys = heights(roofs);
      expect(ys.some((y) => Math.abs(y - (top - roof.overhang * t)) < 1e-6), nb.id).toBe(true);
      expect(ys.some((y) => Math.abs(y - (top + ridgeRise(roof.pitchDeg, size[0] / 2, size[1] / 2))) < 1e-6), nb.id).toBe(true);
    }
  });

  it("stays on its own plot: every vertex of the walls is inside the neighbour's plot", () => {
    const p = walls.positions;
    const plots = ctx.site.zones.neighbours.map((z) => z.plot);
    const inside = (x: number, y: number, ring: [number, number][]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
      return c;
    };
    for (let i = 0; i < p.length; i += 3) {
      const [x, y] = fromScene([p[i], p[i + 1], p[i + 2]]);
      expect(plots.some((ring) => inside(x, y, ring)), `vertex ${i / 3}`).toBe(true);
    }
  });

  it("sinks the walls below the ground at the house", () => {
    expect(Math.min(...heights(walls))).toBeLessThan(ctx.site.terrain.groundAt(houses[0].house.center[0], houses[0].house.center[1]));
    expect(SURROUNDINGS.wallSink).toBeGreaterThan(0);
  });
});

const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe("the boundary: one slat fence, two gates and the pillar", () => {
  const { fences, gates, pillars } = ctx.layout;

  it("closes the plot: every point of a fence path is on a fence part, or in an opening a gate or the pillar stands in", () => {
    expect(fences.length).toBeGreaterThan(0);
    for (const f of fences) {
      const len = f.path.reduce((q, p, i, r) => (i ? q + dist(r[i - 1], p) : 0), 0);
      for (let s0 = 0.05; s0 < len - 0.05; s0 += 0.1) {
        // the point at arc length s0 on the path
        let s = s0, p: XY = f.path[0];
        for (let i = 1; i < f.path.length; i++) {
          const l = dist(f.path[i - 1], f.path[i]);
          if (s <= l) { const t = s / l; p = [f.path[i - 1][0] + (f.path[i][0] - f.path[i - 1][0]) * t, f.path[i - 1][1] + (f.path[i][1] - f.path[i - 1][1]) * t]; break; }
          s -= l;
        }
        const onPart = f.parts.some((part) => part.length >= 2 && projectToPolyline(p, part).d < 1e-6);
        const inGap = f.gaps.find((g) => s0 >= g.from - 1e-6 && s0 <= g.to + 1e-6);
        expect(onPart || (inGap !== undefined && inGap.kind !== "opening"), `${f.id} at ${s0.toFixed(2)}`).toBe(true);
      }
    }
  });

  it("fills every gate opening with its closed leaf between its posts", () => {
    expect(gates.length).toBe(2);
    for (const g of gates) {
      const leaf = gateLeaf(g);
      expect(dist(leaf.boarded[0], leaf.boarded[1])).toBeCloseTo(g.leaf, 9);
      // the boarded leaf spans from post to post (the posts stand just beyond its ends)
      const ends = leaf.boarded.map((e) => Math.min(...g.posts.map((q) => dist(e, [q[0] + g.inward[0] * leaf.offset, q[1] + g.inward[1] * leaf.offset]))));
      for (const d of ends) expect(d).toBeCloseTo(g.postSize / 2, 6);
      if (g.kind === "sliding") {
        expect(leaf.tail).not.toBeNull();
        expect(dist(leaf.tail![0], leaf.tail![1])).toBeCloseTo(g.tail, 9);
        expect(leaf.offset).toBeGreaterThan(0); // on the plot side of the fence
      } else {
        expect(leaf.tail).toBeNull();
        expect(leaf.offset).toBe(0); // in the fence line
      }
    }
  });

  it("stands the posts of a slat fence at most postSpacing apart along each part, and the spans follow them", () => {
    for (const f of fences.filter((x) => x.kind === "slat_fence")) {
      expect(f.posts.length).toBeGreaterThan(4);
      for (const part of f.parts) {
        const spans = fenceSpans(part, f.postSpacing!);
        for (const [a, b] of spans) expect(dist(a, b)).toBeLessThanOrEqual(f.postSpacing! + 1e-9);
        // every joint between two spans carries one of the kernel's posts
        spans.slice(1).forEach(([a]) => expect(f.posts.some((q) => dist(q, a) < 1e-6)).toBe(true));
      }
    }
  });

  it("stacks the boards from the plinth up to the fence height, one slat pitch apart", () => {
    for (const f of fences.filter((x) => x.kind === "slat_fence")) {
      const rows = boardRows(f);
      const pitch = f.slat!.board + f.slat!.gap;
      expect(rows.length).toBeGreaterThan(5);
      expect(rows[0][0]).toBeCloseTo(f.plinthHeight ?? 0, 9);
      for (let i = 0; i < rows.length; i++) {
        expect(rows[i][1] - rows[i][0]).toBeCloseTo(f.slat!.board, 9);
        if (i) expect(rows[i][0] - rows[i - 1][0]).toBeCloseTo(pitch, 9);
      }
      expect(rows[rows.length - 1][1]).toBeLessThanOrEqual(f.height + 1e-9);
      expect(f.height - rows[rows.length - 1][1]).toBeLessThan(pitch);
    }
  });

  it("has a pillar beside the walk gate whose items fit on its face without overlapping", () => {
    expect(pillars.length).toBeGreaterThan(0);
    const items = Object.values(PILLAR_LAYOUT);
    for (const it of items) for (const r of [it.u, it.v]) { expect(r[0]).toBeGreaterThanOrEqual(0); expect(r[1]).toBeLessThanOrEqual(1); expect(r[1]).toBeGreaterThan(r[0]); }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const overlap = a.u[0] < b.u[1] && b.u[0] < a.u[1] && a.v[0] < b.v[1] && b.v[0] < a.v[1];
      expect(overlap, `${Object.keys(PILLAR_LAYOUT)[i]} / ${Object.keys(PILLAR_LAYOUT)[j]}`).toBe(false);
    }
    for (const pl of pillars) for (const item of pl.items) expect(PILLAR_LAYOUT[item], item).toBeDefined();
  });
});

describe("street kerb and bins", () => {
  it("runs the kerb along the carriageway, dropped exactly where the drive and the walk cross it", () => {
    const pieces = kerbPieces(ctx);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < pieces.length; i++) expect(dist(pieces[i - 1].to, pieces[i].from)).toBeLessThan(1e-6);
    const dropped = pieces.filter((k) => k.height === DROPPED_KERB_REVEAL);
    expect(dropped).toHaveLength(2);
    for (const k of pieces.filter((x) => x.height !== DROPPED_KERB_REVEAL)) expect(k.height).toBe(ctx.site.model.street.kerbHeight);
    // each dropped piece lies across the drive or the walk crossing
    const a = ctx.layout.access;
    for (const k of dropped) {
      const mid: XY = [(k.from[0] + k.to[0]) / 2, (k.from[1] + k.to[1]) / 2];
      const near = [a.driveKerb, a.walkKerb].some((poly) => poly.length >= 3 && Math.min(...poly.map((q) => dist(q, mid))) < Math.max(...poly.map((q) => dist(q, mid))) + 1e-9 && projectToPolyline(mid, [...poly, poly[0]]).d < 0.5);
      expect(near).toBe(true);
    }
  });

  it("stands the bins on their pad (a paved area of kind bins), inside it", () => {
    const bins = binsOnPads(ctx);
    const pads = ctx.site.model.paved.filter((p) => p.kind === "bins");
    expect(pads.length).toBeGreaterThan(0);
    expect(bins.length).toBeGreaterThan(0);
    for (const b of bins) {
      const ring = rotatedRect(b.center, b.size, b.rotDeg);
      expect(pads.some((p) => ring.every((q) => pointInPolygon(q, p.polygon)))).toBe(true);
    }
  });
});
