import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { deg2rad, pointInPolygon, type XY } from "../geometry";
import { createTerrain, gridHeight, gridToMesh, latticeHash, valueNoise, type TerrainParams } from "../terrain";
import { parseSite } from "../siteSchema";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = parseSite(siteRaw);
const terrain = createTerrain(site.terrain, FIXTURE_BEARING_DEG);
const params = site.terrain;
const plateau = params.plateau.rects[0];

/** Deterministic pseudo-random points for sampling. */
function samples(n: number, x0: number, y0: number, x1: number, y1: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < n; i++) out.push([x0 + ((i * 0.6180339887) % 1) * (x1 - x0), y0 + ((i * 0.7548776662) % 1) * (y1 - y0)]);
  return out;
}

describe("analytic plane", () => {
  const flat: TerrainParams = {
    zeroLevelAsl: 240,
    plane: { origin: [0, 0], z0: 0.5, slopeSouthPct: 3, slopeWestPct: 1 },
    waves: [],
    plateau: { level: 0, rects: [[1000, 1000, 1001, 1001]], blend: 8 },
  };

  it("falls to the true south and the true west by the given percentages", () => {
    const t = createTerrain(flat, 0); // house frame = true frame
    expect(t.groundAt(0, 0)).toBeCloseTo(0.5, 12);
    expect(t.groundAt(0, 10)).toBeCloseTo(0.5 + 0.3, 12); // 10 m north
    expect(t.groundAt(0, -10)).toBeCloseTo(0.5 - 0.3, 12); // 10 m south
    expect(t.groundAt(10, 0)).toBeCloseTo(0.5 + 0.1, 12); // 10 m east: higher
    expect(t.groundAt(-10, 0)).toBeCloseTo(0.5 - 0.1, 12); // 10 m west: lower
  });

  it("rotates with the house axis bearing", () => {
    const t = createTerrain(flat, 12);
    // house +y points 12 degrees east of north; gradient in house frame follows from the rotation
    const phi = deg2rad(12);
    expect(t.slopeAt(0, 0).gx).toBeCloseTo(-0.03 * Math.sin(phi) + 0.01 * Math.cos(phi), 6);
    expect(t.slopeAt(0, 0).gy).toBeCloseTo(0.03 * Math.cos(phi) + 0.01 * Math.sin(phi), 6);
    const s = t.slopeAt(0, 0);
    expect(s.slopePct).toBeCloseTo(Math.hypot(3, 1), 4);
    // The fall line points to about 198 degrees true (south, a little west)
    expect(s.downhillTrueAzimuth).toBeCloseTo((180 + Math.atan(1 / 3) * (180 / Math.PI)) % 360, 3);
  });
});

describe("levelled plateau", () => {
  it("is exactly the plateau level (+-0.000) everywhere inside the levelled rectangles", () => {
    for (const [x, y] of samples(400, plateau[0], plateau[1], plateau[2], plateau[3])) {
      expect(terrain.groundAt(x, y)).toBe(params.plateau.level);
      expect(terrain.plateauWeight(x, y)).toBe(1);
    }
  });

  it("covers the house and its flat outdoor areas (outline, terrace, paving, pool deck): the lawn there is the plateau level", () => {
    const inside = (p: XY) => params.plateau.rects.some((r) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]);
    const corners = (r: readonly number[]): XY[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    const pts: XY[] = [...FIXTURE_HOUSE.footprint, ...FIXTURE_HOUSE.outdoor.filter((o) => !["drive", "path"].includes(o.type) && !o.covered).flatMap((o) => corners(o.rect!))];
    for (const p of pts) {
      expect(inside(p), `${p}`).toBe(true);
      expect(terrain.groundAt(p[0], p[1])).toBe(params.plateau.level);
    }
    // the lawn around the house lies below the finished floor, so the plinth of the facade shows
    expect(params.plateau.level).toBeLessThan(0);
  });

  it("returns to natural ground beyond the transition", () => {
    const x = plateau[0] - params.plateau.blend - 1;
    expect(terrain.plateauWeight(x, 5)).toBe(0);
    expect(terrain.groundAt(x, 5)).toBeCloseTo(terrain.naturalAt(x, 5), 12);
  });

  it("transition is smooth: value and slope are continuous across the plateau edge", () => {
    const edgeX = plateau[2];
    const y = 3;
    const inside = terrain.slopeAt(edgeX - 0.2, y), outside = terrain.slopeAt(edgeX + 0.2, y);
    expect(Math.abs(outside.slopePct - inside.slopePct)).toBeLessThan(0.6);
    expect(Math.abs(terrain.groundAt(edgeX + 0.01, y) - terrain.groundAt(edgeX, y))).toBeLessThan(2e-4);
  });

  it("is smooth everywhere: bounded second differences and no jumps", () => {
    const h = 0.5;
    let worst = 0;
    for (const [x, y] of samples(3000, -40, -45, 60, 55)) {
      for (const [dx, dy] of [[h, 0], [0, h], [h, h]]) {
        const d2 = Math.abs(terrain.groundAt(x + dx, y + dy) - 2 * terrain.groundAt(x, y) + terrain.groundAt(x - dx, y - dy)) / (dx * dx + dy * dy);
        worst = Math.max(worst, d2);
      }
    }
    expect(worst).toBeLessThan(0.05); // curvature 1/m: no creases
  });

  it("no jump between neighbouring points on a fine line across the whole domain", () => {
    let prev = terrain.groundAt(-40, 2);
    for (let x = -39.9; x <= 60; x += 0.1) {
      const z = terrain.groundAt(x, 2);
      expect(Math.abs(z - prev)).toBeLessThan(0.1 * 0.2); // at most 20 % slope between samples
      prev = z;
    }
  });

  it("transition width and plateau level follow the parameters", () => {
    const t = createTerrain({ ...params, plateau: { ...params.plateau, level: 0.3, blend: 6 } }, FIXTURE_BEARING_DEG);
    expect(t.groundAt(5, 5)).toBe(0.3);
    expect(t.plateauWeight(plateau[2] + 6, 0)).toBe(0);
    expect(t.plateauWeight(plateau[2] + 3, 0)).toBeCloseTo(0.5, 12);
  });
});

describe("natural terrain of the model", () => {
  it("its plane falls by the stated percentages towards the field and the west (waves and noise aside)", () => {
    const plane = createTerrain({ ...params, waves: [], noise: undefined }, FIXTURE_BEARING_DEG);
    const b = deg2rad(FIXTURE_BEARING_DEG);
    // along the house +y axis (true azimuth = bearing) the plane rises by sS cos(b) + sW sin(b) per 100 m
    const alongAxis = ((plane.naturalAt(11.5, 40) - plane.naturalAt(11.5, -40)) / 80) * 100;
    expect(alongAxis).toBeCloseTo(params.plane.slopeSouthPct * Math.cos(b) + params.plane.slopeWestPct * Math.sin(b), 9);
    expect(params.plane.slopeSouthPct).toBeGreaterThanOrEqual(0); // the garden never rises towards the field
    const g = plane.slopeAt(11.5, -30);
    expect(g.downhillTrueAzimuth).toBeCloseTo(180 + (Math.atan2(params.plane.slopeWestPct, params.plane.slopeSouthPct) * 180) / Math.PI, 3);
  });

  it("puts the street below the finished floor and the garden boundary below the street (water runs away from the house)", () => {
    const street: XY = [11.5, 24]; // the street is the north edge of the plot (site.test.ts checks the orientation)
    expect(terrain.naturalAt(...street)).toBeLessThan(0);
    expect(terrain.naturalAt(11.5, -16)).toBeLessThan(terrain.naturalAt(...street));
  });

  it("is deterministic: same parameters give identical heights; the seed changes the micro relief", () => {
    const t2 = createTerrain(JSON.parse(JSON.stringify(params)), FIXTURE_BEARING_DEG);
    for (const [x, y] of samples(50, -30, -30, 50, 50)) expect(t2.groundAt(x, y)).toBe(terrain.groundAt(x, y));
    const other = createTerrain({ ...params, noise: { ...(params.noise as NonNullable<typeof params.noise>), seed: 99 } }, FIXTURE_BEARING_DEG);
    expect(other.naturalAt(30, -20)).not.toBe(terrain.naturalAt(30, -20));
  });

  it("lattice noise is in [-1, 1], reproducible and continuous", () => {
    for (const [x, y] of samples(500, -50, -50, 50, 50)) {
      const v = valueNoise(x, y, 7);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(valueNoise(x, y, 7)).toBe(v);
      expect(Math.abs(valueNoise(x + 1e-4, y, 7) - v)).toBeLessThan(2e-3);
    }
    expect(latticeHash(3, 4, 5)).toBe(latticeHash(3, 4, 5));
    expect(latticeHash(3, 4, 5)).not.toBe(latticeHash(4, 3, 5));
  });

  it("slope of the graded terrain inside the plot stays gentle (mean below 5 %, p95 below 12 %)", () => {
    let sum = 0, n = 0;
    const slopes: number[] = [];
    for (const [x, y] of samples(2000, -5, -16, 28, 22)) {
      if (!pointInPolygon([x, y], site.plot.polygon as XY[])) continue;
      const s = terrain.slopeAt(x, y).slopePct;
      slopes.push(s);
      sum += s;
      n++;
    }
    slopes.sort((a, b) => a - b);
    expect(sum / n).toBeLessThan(5);
    expect(slopes[Math.floor(0.95 * n)]).toBeLessThan(12);
  });

  it("the finished floor sits close to the natural ground (earthworks stay moderate)", () => {
    expect(Math.abs(terrain.naturalAt(11.5, 4.7))).toBeLessThan(0.3);
  });
});

describe("height grid and mesh", () => {
  const bbox = { x0: -10, y0: -10, x1: 30, y1: 25 };
  const g = terrain.grid(bbox, 1);

  it("grid nodes equal groundAt and bilinear sampling reproduces nodes", () => {
    expect(g.nx).toBe(41);
    expect(g.ny).toBe(36);
    for (let k = 0; k < 20; k++) {
      const i = (k * 7) % g.nx, j = (k * 5) % g.ny;
      expect(g.z[j * g.nx + i]).toBe(terrain.groundAt(g.x0 + i, g.y0 + j));
      expect(gridHeight(g, g.x0 + i, g.y0 + j)).toBeCloseTo(g.z[j * g.nx + i], 12);
    }
  });

  it("mesh has the right counts, upward normals and consistent winding", () => {
    const m = gridToMesh(g);
    expect(m.positions.length).toBe(g.nx * g.ny * 3);
    expect(m.indices.length).toBe((g.nx - 1) * (g.ny - 1) * 6);
    for (let k = 2; k < m.normals.length; k += 3) expect(m.normals[k]).toBeGreaterThan(0.9);
    // first triangle is counter-clockwise seen from +z
    const [a, b, c] = [m.indices[0], m.indices[1], m.indices[2]].map((i) => [m.positions[i * 3], m.positions[i * 3 + 1]]);
    expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
  });
});
