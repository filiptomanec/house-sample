import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { distToBoundary, nearestOnSegment, dist, rectToPolygon, type XY } from "../geometry";
import { houseSetbacks, SIDES } from "../setbacks";
import { analyzeSite, garageDriveLengths } from "../analyze";
import { parseSite, type SiteModel } from "../siteSchema";
import { plotPolygon } from "../layout";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = parseSite(siteRaw);
const plot = plotPolygon(site);
const house = FIXTURE_HOUSE.footprint;
const edgeKinds = site.plot.edges.map((e) => e.kind);

/** Brute force: densely sampled house outline against each plot edge. */
function bruteForce(edge: number): number {
  const a = plot[edge], b = plot[(edge + 1) % plot.length];
  let best = Infinity;
  for (let k = 0; k < house.length; k++) {
    const p = house[k], q = house[(k + 1) % house.length];
    const n = Math.ceil(dist(p, q) / 0.02);
    for (let i = 0; i <= n; i++) {
      const s: XY = [p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n];
      best = Math.min(best, dist(s, nearestOnSegment(s, a, b)));
    }
  }
  return best;
}

describe("houseSetbacks on a simple rectangle", () => {
  const sq: XY[] = [[0, 0], [20, 0], [20, 10], [0, 10]];
  const h = rectToPolygon([4, 2, 12, 7]);
  const s = houseSetbacks(h, sq);

  it("exact distances per side", () => {
    expect(s.house.W?.d).toBeCloseTo(4, 12);
    expect(s.house.E?.d).toBeCloseTo(8, 12);
    expect(s.house.S?.d).toBeCloseTo(2, 12);
    expect(s.house.N?.d).toBeCloseTo(3, 12);
    expect(s.min.d).toBeCloseTo(2, 12);
    expect(s.inside).toBe(true);
  });

  it("closest points lie on the house and on the boundary and span exactly the distance", () => {
    for (const side of SIDES) {
      const sb = s.house[side];
      expect(sb).toBeDefined();
      if (!sb) continue;
      expect(distToBoundary(sb.from, h)).toBeLessThan(1e-9);
      expect(distToBoundary(sb.to, sq)).toBeLessThan(1e-9);
      expect(dist(sb.from, sb.to)).toBeCloseTo(sb.d, 9);
    }
  });

  it("accepts either winding of the plot and keeps the edge kinds attached to the right edge", () => {
    const kinds = ["field", "neighbour", "street", "neighbour"];
    const ccw = houseSetbacks(h, sq, { edgeKinds: kinds });
    expect(ccw.byEdgeKind.street.d).toBeCloseTo(3, 12); // edge 2 is the top (y = 10)
    expect(ccw.byEdgeKind.field.d).toBeCloseTo(2, 12);
    // the clockwise ring (0,10) (20,10) (20,0) (0,0) lists its own edges: top, east, bottom, west
    const cw = houseSetbacks(h, [...sq].reverse(), { edgeKinds: ["street", "neighbour", "field", "neighbour"] });
    expect(cw.byEdgeKind.street.d).toBeCloseTo(3, 12);
    expect(cw.byEdgeKind.field.d).toBeCloseTo(2, 12);
  });

  it("reports houses that stick out of the plot", () => {
    expect(houseSetbacks(rectToPolygon([-1, 2, 5, 5]), sq).inside).toBe(false);
  });

  it("rotates the compass sides with the axis bearing", () => {
    const r = houseSetbacks(h, sq, { bearingDeg: 90 });
    // house north (+y) points true east, so the house N distance is the true E distance
    expect(r.trueNorth.E?.d).toBeCloseTo(r.house.N?.d as number, 12);
    expect(r.trueNorth.S?.d).toBeCloseTo(r.house.E?.d as number, 12);
    expect(r.trueNorth.W?.d).toBeCloseTo(r.house.S?.d as number, 12);
    expect(r.trueNorth.N?.d).toBeCloseTo(r.house.W?.d as number, 12);
  });
});

describe("set-backs of the house on the fictional plot", () => {
  const sb = houseSetbacks(house, plot, { bearingDeg: FIXTURE_BEARING_DEG, edgeKinds });

  it("every plot edge is measured and matches a dense brute-force sampling", () => {
    expect(sb.perEdge).toHaveLength(plot.length);
    sb.perEdge.forEach((e, i) => expect(Math.abs(e.d - bruteForce(i))).toBeLessThan(0.02));
  });

  it("the house is inside the plot and every side has a boundary (house frame and true compass)", () => {
    expect(sb.inside).toBe(true);
    for (const side of SIDES) {
      expect(sb.house[side], `house ${side}`).toBeDefined();
      expect(sb.trueNorth[side], `true ${side}`).toBeDefined();
    }
  });

  it("walls keep at least the minimum distance from every boundary", () => {
    expect(sb.min.d).toBeGreaterThanOrEqual(site.setbackRules.minToBoundary);
    for (const e of sb.perEdge) expect(e.d).toBeGreaterThanOrEqual(site.setbackRules.minToBoundary);
    // no house vertex is closer to any boundary edge than the reported minimum
    for (const p of house) expect(distToBoundary(p, plot)).toBeGreaterThanOrEqual(sb.min.d - 1e-9);
  });

  it("street, neighbour and field edges are told apart", () => {
    expect(sb.byEdgeKind.street.d).toBeCloseTo(sb.house.N?.d as number, 9);
    expect(sb.byEdgeKind.field.d).toBeCloseTo(sb.house.S?.d as number, 9);
    expect(sb.byEdgeKind.neighbour.d).toBeCloseTo(Math.min(sb.house.E?.d as number, sb.house.W?.d as number), 9);
  });

  it("eaves keep their own, smaller minimum; with a 12 degree axis rotation sides do not change", () => {
    const a = analyzeSite(site, FIXTURE_HOUSE);
    expect(a.roofSetbacks?.min.d).toBeGreaterThanOrEqual(site.setbackRules.minRoofEdgeToBoundary);
    expect(a.roofSetbacks?.min.d).toBeLessThan(a.setbacks.min.d);
    for (const side of SIDES) expect(sb.trueNorth[side]?.d).toBeCloseTo(sb.house[side]?.d as number, 12);
  });

  it("the drive in front of the garage reaches the street and is long enough", () => {
    const drives = garageDriveLengths(site, FIXTURE_HOUSE);
    expect(drives).toHaveLength(1);
    expect(drives[0].edgeKind).toBe("street");
    expect(drives[0].length).toBeGreaterThanOrEqual(site.setbackRules.minToStreetAtDriveway);
    expect(distToBoundary(drives[0].to, plot)).toBeLessThan(1e-9);
    expect(drives[0].from[1]).toBeCloseTo(12.05, 6); // outer face of the north wall
  });

  it("a plot that is too tight fails the checks", () => {
    const tight: SiteModel = { ...site, plot: { ...site.plot, polygon: [[-3, -10], [26, -10], [26, 18], [-3, 18]] } };
    const a = analyzeSite(tight, FIXTURE_HOUSE);
    expect(a.checks.find((c) => c.key === "boundary")?.ok).toBe(false);
    expect(a.ok).toBe(false);
  });
});
