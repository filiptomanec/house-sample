import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { polygonArea, rectToPolygon, type XY } from "../geometry";
import { cutFillVolume, plotStats, slopeStats } from "../stats";
import { analyzeSite, sitePaved } from "../analyze";
import { accessGeometry, plotPolygon } from "../layout";
import { createTerrain, type TerrainParams } from "../terrain";
import { parseSite } from "../siteSchema";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = parseSite(siteRaw);

/** Independent shoelace, written out here on purpose. */
function shoelace(p: XY[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return Math.abs(s) / 2;
}

describe("plotStats on a hand-made case", () => {
  const plot = rectToPolygon([0, 0, 20, 10]); // 200
  const footprint = rectToPolygon([2, 2, 8, 6]); // 24
  const outdoor = [
    { type: "terrace", covered: true, rect: [6, 2, 10, 6] as [number, number, number, number] }, // 16, overlaps the house by 8, so adds 8 roofed
    { type: "paving", covered: false, rect: [10, 2, 14, 4] as [number, number, number, number] }, // 8
    { type: "drive", covered: false, rect: [12, 3, 16, 5] as [number, number, number, number] }, // overlaps paving by 2, adds 6
    { type: "lawn", covered: false, rect: [14, 6, 19, 9] as [number, number, number, number] }, // green, ignored
  ];
  const paved = [{ kind: "pad", polygon: rectToPolygon([18, 0, 22, 2]) }]; // only 2 x 2 = 4 inside the plot

  it("built-up, paved and green areas count overlaps once and clip to the plot", () => {
    const s = plotStats(plot, footprint, outdoor, paved);
    expect(s.plotArea).toBeCloseTo(200, 9);
    expect(s.footprintArea).toBeCloseTo(24, 9);
    expect(s.coveredOutdoorArea).toBeCloseTo(8, 9);
    expect(s.builtUpArea).toBeCloseTo(32, 9);
    expect(s.pavedArea).toBeCloseTo(8 + 6 + 4, 9);
    expect(s.greenArea).toBeCloseTo(200 - 32 - 18, 9);
    expect(s.builtUpRatio).toBeCloseTo(0.16, 12);
    expect(s.imperviousRatio).toBeCloseTo(50 / 200, 12);
    expect(s.byOutdoorType.drive).toBeCloseTo(8, 9);
    expect(s.byPavedKind.pad).toBeCloseTo(4, 9);
  });

  it("built-up + paved + green always add up to the plot area", () => {
    const s = plotStats(plot, footprint, outdoor, paved);
    expect(s.builtUpArea + s.pavedArea + s.greenArea).toBeCloseTo(s.plotArea, 9);
    expect(s.builtUpRatio + s.pavedRatio + s.greenRatio).toBeCloseTo(1, 12);
  });
});

describe("statistics of the fictional plot", () => {
  const plot = plotPolygon(site);
  const a = analyzeSite(site, FIXTURE_HOUSE);

  it("plot area is an invented 1,100 to 1,300 m2 and equals an independent shoelace", () => {
    expect(a.plot.area).toBeGreaterThan(1100);
    expect(a.plot.area).toBeLessThan(1300);
    expect(a.plot.area).toBeCloseTo(shoelace(site.plot.polygon as XY[]), 9);
    expect(polygonArea(plot)).toBeCloseTo(a.stats.plotArea, 9);
  });

  it("is a quadrilateral that is neither a rectangle nor axis-parallel", () => {
    expect(plot).toHaveLength(4);
    const angles = plot.map((p, i) => {
      const q = plot[(i + 1) % 4];
      return (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    });
    // opposite edges are not parallel: a trapezoid-like irregular quadrilateral
    expect(Math.abs(angles[0] - angles[2] + 180)).toBeGreaterThan(1);
    expect(Math.abs(angles[1] - angles[3] + 180)).toBeGreaterThan(1);
  });

  it("built-up ratio is within the 35 % limit and equals the independent sum", () => {
    expect(a.stats.footprintArea).toBeCloseTo(shoelace(FIXTURE_HOUSE.footprint), 9);
    const roofedOutside = 6.65 * 5.4 /* covered terrace in the notch */ + 3.6 * 2.4 /* porch */;
    expect(a.stats.coveredOutdoorArea).toBeCloseTo(roofedOutside, 6);
    expect(a.stats.builtUpArea).toBeCloseTo(a.stats.footprintArea + roofedOutside, 6);
    expect(a.stats.builtUpRatio).toBeLessThanOrEqual(site.limits.maxBuiltUpRatio);
    expect(a.stats.greenRatio).toBeGreaterThanOrEqual(site.limits.minGreenRatio);
  });

  it("includes the aprons derived from the drive and path, and the declared hard surfaces", () => {
    const access = accessGeometry(site, FIXTURE_HOUSE.outdoor);
    const paved = sitePaved(site, access);
    expect(paved.filter((p) => p.kind === "apron")).toHaveLength(2);
    expect(a.stats.byPavedKind.apron).toBeGreaterThan(3);
    for (const p of site.paved) expect(a.stats.byPavedKind[p.kind]).toBeGreaterThan(0);
  });

  it("all rule checks pass", () => {
    for (const c of a.checks) expect(c.ok, `${c.key}: ${c.actual} vs ${c.limit}`).toBe(true);
    expect(a.ok).toBe(true);
    expect(a.checks.map((c) => c.key)).toEqual(expect.arrayContaining(["boundary", "roofEdge", "garageDrive", "builtUp", "green", "treeTrunk", "treeCrown"]));
  });
});

describe("slope statistics and earthworks", () => {
  const terrain = createTerrain(site.terrain, FIXTURE_BEARING_DEG);
  const plot = plotPolygon(site);

  it("slope classes partition the plot and the numbers are ordered", () => {
    const s = slopeStats(terrain, plot, { step: 1 });
    expect(s.classes.reduce((t, c) => t + c.ratio, 0)).toBeCloseTo(1, 12);
    expect(s.classes.reduce((t, c) => t + c.area, 0)).toBeCloseTo(s.area, 9);
    expect(s.area).toBeCloseTo(polygonArea(plot), -1);
    expect(s.slopeMeanPct).toBeLessThanOrEqual(s.slopeP95Pct);
    expect(s.slopeP95Pct).toBeLessThanOrEqual(s.slopeMaxPct);
    expect(s.zMin).toBeLessThan(s.zMean);
    expect(s.zMean).toBeLessThan(s.zMax);
    expect(s.meanDownhillTrueAzimuth).toBeGreaterThan(160);
    expect(s.meanDownhillTrueAzimuth).toBeLessThan(220);
  });

  it("a pure plane has constant slope and no earthworks without a plateau effect", () => {
    const p: TerrainParams = {
      zeroLevelAsl: 240,
      plane: { origin: [0, 0], z0: 0, slopeSouthPct: 3, slopeWestPct: 0 },
      waves: [],
      plateau: { level: 0, rects: [[500, 500, 501, 501]], blend: 8 },
    };
    const t = createTerrain(p, 0);
    const s = slopeStats(t, rectToPolygon([-10, -10, 10, 10]), { step: 1 });
    expect(s.slopeMeanPct).toBeCloseTo(3, 6);
    expect(s.slopeMaxPct).toBeCloseTo(3, 6);
    expect(s.meanDownhillTrueAzimuth).toBeCloseTo(180, 6);
    const cf = cutFillVolume(t, rectToPolygon([-10, -10, 10, 10]), 1);
    expect(cf.cut).toBe(0);
    expect(cf.fill).toBe(0);
  });

  it("cut and fill balance a levelled platform on a slope", () => {
    const p: TerrainParams = {
      zeroLevelAsl: 240,
      plane: { origin: [0, 0], z0: 0, slopeSouthPct: 4, slopeWestPct: 0 },
      waves: [],
      plateau: { level: 0, rects: [[-5, -5, 5, 5]], blend: 6 },
    };
    const t = createTerrain(p, 0);
    const cf = cutFillVolume(t, rectToPolygon([-30, -30, 30, 30]), 0.5);
    expect(cf.cut).toBeGreaterThan(1);
    expect(cf.fill).toBeGreaterThan(1);
    expect(cf.net).toBeCloseTo(cf.fill - cf.cut, 9);
    expect(Math.abs(cf.net)).toBeLessThan(0.05 * (cf.cut + cf.fill)); // symmetric plane: nearly balanced
    expect(cf.maxCut).toBeCloseTo(cf.maxFill, 1);
  });

  it("the model earthworks are modest for a family house", () => {
    const cf = cutFillVolume(terrain, plot, 0.5);
    expect(cf.maxCut).toBeLessThan(0.8);
    expect(cf.maxFill).toBeLessThan(0.8);
    expect(Math.abs(cf.net)).toBeLessThan(0.5 * (cf.cut + cf.fill));
  });
});
