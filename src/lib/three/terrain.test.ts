import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { projectToPolyline, type XY } from "@/lib/model/site";
import { FIELD_ROWS, GROUND_ROLE_FALLBACK, HORIZON, TERRAIN_DROP, fieldRows, groundLayers, horizonGeometry, latticeLines, terrainGeometry, treeLine, uncoveredBoundary, type GroundRole } from "./terrain";
import type { HouseContext } from "./context";
import { generatedMaterial } from "./style";

const ctx = getHouseContext();
const g = ctx.site.terrain;

describe("terrainGeometry", () => {
  const step = 3;
  const data = terrainGeometry(ctx, step);
  const n = data.positions.length / 3;
  const vertex = (i: number) => ({ x: data.positions[i * 3], h: data.positions[i * 3 + 1], y: -data.positions[i * 3 + 2] });

  it("covers exactly the plot bounding box plus the margin of the domain", () => {
    const b = ctx.site.bounds;
    expect(data.bounds).toEqual({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
    const xs = Array.from({ length: n }, (_, i) => vertex(i).x), ys = Array.from({ length: n }, (_, i) => vertex(i).y);
    expect(Math.min(...xs)).toBeCloseTo(b.x0, 4);
    expect(Math.max(...xs)).toBeCloseTo(b.x1, 4);
    expect(Math.min(...ys)).toBeCloseTo(b.y0, 4);
    expect(Math.max(...ys)).toBeCloseTo(b.y1, 4);
  });

  it("has the kernel height outside the plateau and the plateau level minus the drop inside it", () => {
    let outside = 0, inside = 0;
    for (let i = 0; i < n; i++) {
      const { x, y, h } = vertex(i);
      const k = g.plateauWeight(x, y);
      // the scene vertex is the house point (x, y) lowered by the drop in proportion to the plateau weight
      expect(h).toBeCloseTo(g.groundAt(x, y) - TERRAIN_DROP * k, 4);
      if (k === 0) { outside++; expect(h).toBeCloseTo(g.groundAt(x, y), 4); }
      if (k === 1) { inside++; expect(h).toBeCloseTo(g.params.plateau.level - TERRAIN_DROP, 4); }
    }
    expect(outside).toBeGreaterThan(0);
    expect(inside).toBeGreaterThan(0);
  });

  it("has unit normals that agree with the slope of the ground and point up", () => {
    const h = 0.05;
    for (let i = 0; i < n; i += 7) {
      const nx = data.normals[i * 3], ny = data.normals[i * 3 + 1], nz = data.normals[i * 3 + 2];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      expect(ny).toBeGreaterThan(0.9);
      // independent oracle: the normal of the surface z = ground(x, y) is (-gx, 1, +gy) in the scene frame (house y is scene -z)
      const { x, y } = vertex(i);
      const gx = (g.groundAt(x + h, y) - g.groundAt(x - h, y)) / (2 * h), gy = (g.groundAt(x, y + h) - g.groundAt(x, y - h)) / (2 * h);
      const l = Math.hypot(gx, gy, 1);
      expect(nx).toBeCloseTo(-gx / l, 1);
      expect(nz).toBeCloseTo(gy / l, 1);
    }
  });

  it("has indices in range and every triangle counter-clockwise seen from above", () => {
    expect(data.indices.length % 3).toBe(0);
    let down = 0;
    for (let t = 0; t < data.indices.length; t += 3) {
      const [a, b, c] = [data.indices[t], data.indices[t + 1], data.indices[t + 2]];
      for (const v of [a, b, c]) expect(v).toBeLessThan(n);
      const p = (i: number) => [data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      // y component of the cross product: positive when the triangle faces up
      if (u[2] * v[0] - u[0] * v[2] <= 0) down++;
    }
    expect(down).toBe(0);
  });

  it("maps the texture coordinates of the corners to the unit square, east to u and north to v", () => {
    const uv = data.uvs;
    for (let i = 0; i < n; i++) {
      const { x, y } = vertex(i);
      expect(uv[i * 2]).toBeCloseTo((x - data.bounds.x0) / (data.bounds.x1 - data.bounds.x0), 4);
      expect(uv[i * 2 + 1]).toBeCloseTo((y - data.bounds.y0) / (data.bounds.y1 - data.bounds.y0), 4);
    }
  });

  it("is finer with a smaller step and agrees with the coarser mesh where the vertices coincide", () => {
    const fine = terrainGeometry(ctx, 1.5);
    expect(fine.positions.length).toBeGreaterThan(data.positions.length * 3);
    // the corner vertices are the same points
    expect(fine.positions[1]).toBeCloseTo(data.positions[1], 5);
  });
});

describe("groundLayers", () => {
  const layers = groundLayers(ctx);
  const b = ctx.site.bounds;

  it("starts with the lawn over the whole domain and paints in the documented order", () => {
    expect(layers[0].role).toBe("lawn");
    const xs = layers[0].points.map((p) => p[0]), ys = layers[0].points.map((p) => p[1]);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([b.x0, b.y0, b.x1, b.y1]);
    const rank = (r: GroundRole) => ["lawn", "field", "neighbour", "verge", "carriageway", "kerb", "marking", "mulch", "gravel", "path", "drive_paving", "terrace_paving"].indexOf(r);
    // field, neighbours and the street come before the beds and the paved areas
    const first = (role: GroundRole) => layers.findIndex((l) => l.role === role);
    expect(first("field")).toBeLessThan(first("neighbour"));
    expect(first("neighbour")).toBeLessThan(first("verge"));
    expect(first("verge")).toBeLessThan(first("carriageway"));
    for (const bed of ctx.site.model.beds) expect(first("carriageway")).toBeLessThan(layers.findIndex((l) => l.role === bed.kind && l.points === bed.polygon));
    expect(rank("lawn")).toBeLessThan(rank("terrace_paving"));
  });

  it("takes the beds and the paved areas from the data, with the role of their kind and surface", () => {
    for (const bed of ctx.site.model.beds) {
      const l = layers.find((x) => x.points === bed.polygon);
      expect(l?.role, bed.id).toBe(bed.kind);
    }
    for (const p of ctx.site.model.paved) {
      const l = layers.find((x) => x.points === p.polygon);
      expect(l?.role, p.id).toBe(p.surface);
    }
  });

  it("paints the driveway and the walkway across the verge, the pavement of the street and the outdoor slabs (not the pool)", () => {
    const a = ctx.layout.access;
    expect(layers.some((l) => l.points === a.driveVerge && l.role === "drive_paving")).toBe(true);
    expect(layers.some((l) => l.points === a.walkVerge && l.role === "path")).toBe(true);
    expect(layers.some((l) => l.role === "pavement" && l.points === ctx.site.zones.street.pavement)).toBe(true);
    for (const o of ctx.derived.outdoor) {
      const painted = layers.some((l) => l.kind === "fill" && l.role === o.role && l.points.length === 4 && l.points[0][0] === o.rect[0] && l.points[0][1] === o.rect[1]);
      if (o.pool) expect(painted, o.id).toBe(false);
      else if (o.role in GROUND_ROLE_FALLBACK) expect(painted, o.id).toBe(true);
    }
  });

  it("paints the plot edge only where no fence (or its gate or pillar) covers it", () => {
    const lines = layers.filter((l) => l.kind === "line" && l.width === layers.find((x) => x.kind === "line" && uncoveredBoundary(ctx).includes(x.points as never))?.width);
    const pieces = uncoveredBoundary(ctx);
    for (const piece of pieces) expect(lines.some((l) => l.points === piece)).toBe(true);
    // every painted piece lies on the plot ring and away from every fence part
    for (const piece of pieces) for (const p of piece) {
      for (const f of ctx.layout.fences) for (const part of f.parts) {
        if (part.length >= 2) expect(projectToPolyline(p, part).d).toBeGreaterThan(0.1);
      }
    }
  });

  it("has only shapes of at least a line or a polygon and every shape touches the domain", () => {
    for (const l of layers) {
      expect(l.points.length).toBeGreaterThanOrEqual(l.kind === "fill" ? 3 : 2);
      const xs = l.points.map((p) => p[0]), ys = l.points.map((p) => p[1]);
      expect(Math.max(...xs) >= b.x0 && Math.min(...xs) <= b.x1 && Math.max(...ys) >= b.y0 && Math.min(...ys) <= b.y1, l.role).toBe(true);
      if (l.kind === "line") expect(l.width ?? 0).toBeGreaterThan(0);
    }
  });

  it("has a colour in the style for every role of the painted ground", () => {
    for (const role of Object.keys(GROUND_ROLE_FALLBACK) as GroundRole[]) {
      expect(generatedMaterial(ctx.style, role, GROUND_ROLE_FALLBACK[role]).color, role).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const l of layers) expect(GROUND_ROLE_FALLBACK[l.role]).toBeDefined();
  });
});

describe("ground voids (the pool basin)", () => {
  const data = terrainGeometry(ctx, 1);
  it("has a lattice line on every edge of every void and no triangle inside a void", () => {
    expect(ctx.derived.groundVoids.length).toBeGreaterThan(0);
    for (const v of ctx.derived.groundVoids) {
      for (const x of [v[0], v[2]]) expect(Array.from(data.xs).some((q) => Math.abs(q - x) < 1e-9)).toBe(true);
      for (const y of [v[1], v[3]]) expect(Array.from(data.ys).some((q) => Math.abs(q - y) < 1e-9)).toBe(true);
    }
    const P = data.positions;
    for (let t = 0; t < data.indices.length; t += 3) {
      let cx = 0, cy = 0;
      for (let k = 0; k < 3; k++) { const i = data.indices[t + k]; cx += P[i * 3] / 3; cy += -P[i * 3 + 2] / 3; }
      for (const v of ctx.derived.groundVoids) expect(cx > v[0] && cx < v[2] && cy > v[1] && cy < v[3]).toBe(false);
    }
  });

  it("keeps the ground around a void closed: the cells next to it are there", () => {
    const P = data.positions;
    const v = ctx.derived.groundVoids[0];
    const near = (x: number, y: number) => {
      for (let t = 0; t < data.indices.length; t += 3) {
        let cx = 0, cy = 0;
        for (let k = 0; k < 3; k++) { const i = data.indices[t + k]; cx += P[i * 3] / 3; cy += -P[i * 3 + 2] / 3; }
        if (Math.abs(cx - x) < 0.7 && Math.abs(cy - y) < 0.7) return true;
      }
      return false;
    };
    expect(near(v[0] - 0.4, (v[1] + v[3]) / 2)).toBe(true);
    expect(near(v[2] + 0.4, (v[1] + v[3]) / 2)).toBe(true);
  });
});

describe("latticeLines", () => {
  it("runs from lo to hi about `step` apart (a line near a cut snaps to it), ascending, through every cut inside the range", () => {
    const lines = latticeLines(-3, 17, 2, [1.3, 4.7, 30]);
    expect(lines[0]).toBe(-3);
    expect(lines[lines.length - 1]).toBe(17);
    for (let i = 1; i < lines.length; i++) { expect(lines[i]).toBeGreaterThan(lines[i - 1]); expect(lines[i] - lines[i - 1]).toBeLessThanOrEqual(2 * 1.3 + 1e-9); }
    expect(lines).toContain(1.3);
    expect(lines).toContain(4.7);
    expect(lines).not.toContain(30);
  });
});

describe("uncoveredBoundary", () => {
  it("is the whole plot ring when there is no fence", () => {
    const bare = { ...ctx, layout: { ...ctx.layout, fences: [] } } as unknown as HouseContext;
    const pieces = uncoveredBoundary(bare);
    expect(pieces).toHaveLength(1);
    const perimeter = ctx.site.plot.reduce((s, p, i, r) => s + Math.hypot(r[(i + 1) % r.length][0] - p[0], r[(i + 1) % r.length][1] - p[1]), 0);
    const len = pieces[0].reduce((s, p, i, r) => (i ? s + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0);
    expect(len).toBeCloseTo(perimeter, 1);
  });

  it("leaves out everything a fence of the model covers (the model fences every edge)", () => {
    const pieces = uncoveredBoundary(ctx);
    const total = pieces.reduce((s, piece) => s + piece.reduce((q, p, i, r) => (i ? q + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0), 0);
    expect(total).toBeLessThan(1);
  });
});

describe("fieldRows", () => {
  it("cuts the field into bands of FIELD_ROWS.width every FIELD_ROWS.period along its edge, inside its depth", () => {
    const field = ctx.site.zones.field as XY[];
    const rows = fieldRows(field);
    expect(rows.length).toBeGreaterThan(0);
    const [a0, , , d0] = field;
    const depth = Math.hypot(d0[0] - a0[0], d0[1] - a0[1]);
    const u = [(d0[0] - a0[0]) / depth, (d0[1] - a0[1]) / depth];
    rows.forEach((r, i) => {
      const s0 = (r[0][0] - a0[0]) * u[0] + (r[0][1] - a0[1]) * u[1], s1 = (r[3][0] - a0[0]) * u[0] + (r[3][1] - a0[1]) * u[1];
      expect(s0).toBeCloseTo(i * FIELD_ROWS.period, 6);
      expect(s1 - s0).toBeCloseTo(FIELD_ROWS.width, 6);
      expect(s1).toBeLessThanOrEqual(depth + 1e-6);
    });
  });
});

describe("the horizon", () => {
  const ring = horizonGeometry(ctx);
  it("starts under the border of the terrain and reaches HORIZON.radius from the centre of the domain", () => {
    const b = ctx.site.bounds;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    let far = 0;
    for (let i = 0; i < ring.positions.length; i += 3) far = Math.max(far, Math.max(Math.abs(ring.positions[i] - cx), Math.abs(-ring.positions[i + 2] - cy)));
    expect(far).toBeCloseTo(HORIZON.radius, 0);
    // the first ring lies just inside the domain edge and below the ground there
    const M = 4 * HORIZON.segments;
    for (let i = 0; i < M; i++) {
      const x = ring.positions[i * 3], y = -ring.positions[i * 3 + 2], z = ring.positions[i * 3 + 1];
      const gx = Math.min(b.x1, Math.max(b.x0, x)), gy = Math.min(b.y1, Math.max(b.y0, y));
      expect(z).toBeLessThan(ctx.site.terrain.groundAt(gx, gy));
    }
  });

  it("has valid indices, triangles facing up", () => {
    const P = ring.positions, n = P.length / 3;
    for (let t = 0; t < ring.indices.length; t += 3) {
      const [a, b2, c] = [ring.indices[t], ring.indices[t + 1], ring.indices[t + 2]];
      for (const i of [a, b2, c]) expect(i).toBeLessThan(n);
      const ux = P[b2 * 3] - P[a * 3], uz = P[b2 * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
      // y of (u x v) in the scene frame: positive = facing up
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });

  it("puts the distant tree line between its radii and leaves the street open", () => {
    const b = ctx.site.bounds;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const st = ctx.site.zones.street.centreLine;
    const dir = Math.atan2(st[1][1] - st[0][1], st[1][0] - st[0][0]);
    const trees = treeLine(ctx);
    expect(trees.length).toBeGreaterThan(20);
    for (const t of trees) {
      const d = Math.hypot(t.centre[0] - cx, t.centre[1] - cy);
      expect(d).toBeGreaterThan(HORIZON.trees.from - 3 * t.radii[0] - 1);
      expect(d).toBeLessThan(HORIZON.trees.to + 3 * t.radii[0] + 1);
      const a = Math.atan2(t.centre[1] - cy, t.centre[0] - cx);
      const off = (x: number) => Math.abs(((a - x + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(Math.min(off(dir), off(dir + Math.PI))).toBeGreaterThan(((HORIZON.trees.gapDeg - 6) * Math.PI) / 180);
    }
  });
});
