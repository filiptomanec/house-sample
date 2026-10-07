import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { GROUND_ROLE_FALLBACK, TERRAIN_DROP, groundLayers, terrainGeometry, type GroundRole } from "./terrain";
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

  it("paints the driveway and the walkway across the verge and ends with the plot edge as a closed line", () => {
    const a = ctx.layout.access;
    expect(layers.some((l) => l.points === a.driveVerge && l.role === "drive_paving")).toBe(true);
    expect(layers.some((l) => l.points === a.walkVerge && l.role === "path")).toBe(true);
    const last = layers[layers.length - 1];
    expect(last.kind).toBe("line");
    expect(last.closed).toBe(true);
    expect(last.points).toBe(ctx.site.plot);
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
