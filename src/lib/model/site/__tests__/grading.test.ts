// Levels: flat slabs and the drive / path ramps, and the terrain that follows them (never covering a slab).
import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_OUTDOOR_TOP } from "../../catalog";
import { pointInPolygon, rectToPolygon, type XY } from "../geometry";
import { RAMP_GATE_RISE, RAMP_MAX_SLOPE, gradeOutdoor } from "../grading";
import { createSite } from "../index";
import { accessGeometry } from "../layout";
import { parseSite } from "../siteSchema";
import type { OutdoorInput } from "../stats";
import { SLAB_GROUND_GAP, SLAB_SIDE_BLEND, createTerrain, planeZ, type TerrainParams } from "../terrain";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = parseSite(siteRaw);
const houseFile = path.resolve(__dirname, "../../../../../model/house.json");
const MODEL_OUTDOOR = (JSON.parse(readFileSync(houseFile, "utf8")) as { outdoor: OutdoorInput[] }).outdoor;

/** Samples the inside of a polygon on a regular grid (cell centres). */
function samples(poly: readonly XY[], step: number): XY[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const out: XY[] = [];
  for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) if (pointInPolygon([x, y], poly)) out.push([x, y]);
  return out;
}

describe("grading of a synthetic slope", () => {
  // a plain plane rising 5 % to the north, no plateau effect near the slab
  const params: TerrainParams = {
    zeroLevelAsl: 0,
    plane: { origin: [0, 0], z0: 0, slopeSouthPct: 5, slopeWestPct: 0 },
    waves: [],
    plateau: { level: -0.2, rects: [[-100, -100, -90, -90]], blend: 3 },
  };
  const slab = { polygon: [[0, 0], [4, 0], [4, 10], [0, 10]] as XY[], plane: { z0: -0.1, ox: 0, oy: 0, gx: 0, gy: 0.02 } };
  const t = createTerrain(params, 0, [slab]);

  it("inside the slab the ground stays SLAB_GROUND_GAP under the top, or lower", () => {
    for (const [x, y] of samples(slab.polygon, 0.25)) {
      expect(t.groundAt(x, y)).toBeLessThanOrEqual(planeZ(slab.plane, x, y) - SLAB_GROUND_GAP + 1e-12);
      expect(t.groundAt(x, y)).toBeLessThanOrEqual(t.baseAt(x, y) + 1e-12);
    }
  });
  it("beyond the side blend the ground is untouched, and the transition is continuous", () => {
    for (const [x, y] of [[-SLAB_SIDE_BLEND - 0.01, 5], [4 + SLAB_SIDE_BLEND + 0.01, 8], [2, 10 + SLAB_SIDE_BLEND + 0.01]] as XY[]) expect(t.groundAt(x, y)).toBe(t.baseAt(x, y));
    let worst = 0;
    for (let x = -1.5; x <= 5.5; x += 0.01) {
      const a = t.groundAt(x, 7), b = t.groundAt(x + 0.01, 7);
      worst = Math.max(worst, Math.abs(b - a));
    }
    expect(worst).toBeLessThan(0.02);
  });
  it("where the ground is already lower than the slab nothing changes", () => {
    for (const [x, y] of samples(slab.polygon, 0.5)) if (t.baseAt(x, y) < planeZ(slab.plane, x, y) - SLAB_GROUND_GAP) expect(t.groundAt(x, y)).toBe(t.baseAt(x, y));
  });
});

describe("ramps of the drive and the walkway", () => {
  const base = createTerrain(site.terrain, FIXTURE_BEARING_DEG);
  const access = accessGeometry(site, FIXTURE_HOUSE.outdoor);
  const { grades, slabs } = gradeOutdoor(FIXTURE_HOUSE.outdoor, base.baseAt, access);

  it("the access strips are ramps from their top at the house end to the gate; everything else is flat at its top", () => {
    grades.forEach((g, i) => {
      const o = FIXTURE_HOUSE.outdoor[i];
      expect(g.top).toBe(o.top ?? DEFAULT_OUTDOOR_TOP);
      const isAccess = i === access.driveIndex || i === access.walkIndex;
      expect(g.kind).toBe(isAccess ? "ramp" : "flat");
      if (!g.ramp) {
        expect(g.corners.every((z) => z === g.top)).toBe(true);
        return;
      }
      const gate = i === access.driveIndex ? access.driveGate.center : access.walkGate.center;
      expect(g.ramp.gate).toEqual(gate);
      expect(g.ramp.z1).toBeCloseTo(base.baseAt(gate[0], gate[1]) + RAMP_GATE_RISE, 12);
      expect(planeZ(g.plane, gate[0], gate[1])).toBeCloseTo(g.ramp.z1, 12);
      expect(planeZ(g.plane, o.rect![0], o.rect![1])).toBeCloseTo(g.top, 12);
      expect(Math.abs(g.ramp.slope)).toBeLessThanOrEqual(RAMP_MAX_SLOPE);
      // the apron continues the same plane to the boundary
      if (g.ramp.apron) g.ramp.apron.polygon.forEach((p, k) => expect(g.ramp!.apron!.z[k]).toBeCloseTo(planeZ(g.plane, p[0], p[1]), 12));
    });
    expect(slabs.length).toBe(FIXTURE_HOUSE.outdoor.length + [access.driveApron, access.walkApron].filter((a) => a.length).length);
  });
  it("without the access every slab is flat", () => {
    for (const g of gradeOutdoor(FIXTURE_HOUSE.outdoor, base.baseAt).grades) expect(g.kind).toBe("flat");
  });
});

describe("the model: every slab stays above the graded terrain", () => {
  const s = createSite(siteRaw, FIXTURE_BEARING_DEG, MODEL_OUTDOOR);
  const placed = s.withHouse(MODEL_OUTDOOR);

  it("on a 0.25 m grid every outdoor slab and apron top is at least 4 mm above the ground", () => {
    let n = 0;
    for (const slab of placed.grading.slabs) {
      for (const [x, y] of samples(slab.polygon, 0.25)) {
        n++;
        expect(planeZ(slab.plane, x, y) - s.terrain.groundAt(x, y), `${x},${y}`).toBeGreaterThanOrEqual(0.004);
      }
    }
    expect(n).toBeGreaterThan(500);
  });
  it("the ramps are no steeper than the limit", () => {
    for (const g of placed.grading.grades) if (g.ramp) expect(Math.abs(g.ramp.slope)).toBeLessThanOrEqual(RAMP_MAX_SLOPE);
  });
  it("createSite with the outdoor areas uses the graded terrain; without them the plateau terrain", () => {
    expect(s.terrain.slabs.length).toBe(placed.grading.slabs.length);
    expect(createSite(siteRaw, FIXTURE_BEARING_DEG).terrain.slabs).toHaveLength(0);
    // away from every slab both agree
    const far: XY = [s.bounds.x0 + 1, s.bounds.y0 + 1];
    expect(s.terrain.groundAt(...far)).toBe(createSite(siteRaw, FIXTURE_BEARING_DEG).terrain.groundAt(...far));
    for (const o of MODEL_OUTDOOR) if (o.rect) for (const p of rectToPolygon(o.rect)) expect(Number.isFinite(s.terrain.groundAt(p[0], p[1]))).toBe(true);
  });
});
