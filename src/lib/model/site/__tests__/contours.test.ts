import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { clipContours, contourLabels, contourLines, smoothPolyline, type Contour } from "../contours";
import { polygonArea, pointInPolygon, type XY } from "../geometry";
import { createTerrain, gridHeight, type HeightGrid } from "../terrain";
import { parseSite } from "../siteSchema";
import { FIXTURE_BEARING_DEG } from "./fixture";

const site = parseSite(siteRaw);
const terrain = createTerrain(site.terrain, FIXTURE_BEARING_DEG);

function gridOf(f: (x: number, y: number) => number, x0: number, y0: number, x1: number, y1: number, step: number): HeightGrid {
  const nx = Math.round((x1 - x0) / step) + 1, ny = Math.round((y1 - y0) / step) + 1;
  const z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = f(x0 + i * step, y0 + j * step);
  return { x0, y0, step, nx, ny, z };
}

const onBorder = (g: HeightGrid, [x, y]: XY): boolean => {
  const x1 = g.x0 + (g.nx - 1) * g.step, y1 = g.y0 + (g.ny - 1) * g.step, e = 1e-9;
  return Math.abs(x - g.x0) < e || Math.abs(x - x1) < e || Math.abs(y - g.y0) < e || Math.abs(y - y1) < e;
};

describe("marching squares on a radial hill", () => {
  const hill = gridOf((x, y) => 3 * Math.exp(-(x * x + y * y) / 200), -40, -40, 40, 40, 0.5);
  const lines = contourLines(hill, { minor: 0.5, major: 1 });

  it("every contour of a hill inside the grid is a closed ring", () => {
    expect(lines.length).toBeGreaterThan(4);
    for (const c of lines) {
      expect(c.closed).toBe(true);
      expect(c.points.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("points lie exactly on the level (bilinear height along cell edges)", () => {
    for (const c of lines) for (const p of c.points) expect(Math.abs(gridHeight(hill, p[0], p[1]) - c.level)).toBeLessThan(1e-9);
  });

  it("ring area shrinks with level and matches the analytic radius", () => {
    const sorted = [...lines].sort((a, b) => a.level - b.level);
    for (let i = 1; i < sorted.length; i++) expect(polygonArea(sorted[i].points)).toBeLessThan(polygonArea(sorted[i - 1].points));
    const c = sorted.find((l) => Math.abs(l.level - 1.5) < 1e-9) as Contour;
    const r = Math.sqrt(-200 * Math.log(1.5 / 3));
    expect(polygonArea(c.points)).toBeCloseTo(Math.PI * r * r, -1); // within about 5 m2
    expect(Math.abs(polygonArea(c.points) - Math.PI * r * r) / (Math.PI * r * r)).toBeLessThan(0.01);
  });

  it("flags every second level of the 0.5 m interval as major (multiples of 1 m)", () => {
    for (const c of lines) expect(c.major).toBe(Math.abs(c.level - Math.round(c.level)) < 1e-9);
  });
});

describe("saddles", () => {
  it("resolves ambiguous cells without dangling ends inside the grid", () => {
    const saddle = gridOf((x, y) => x * y * 0.01, -10, -10, 10, 10, 1);
    const lines = contourLines(saddle, { minor: 0.1, major: 0.5 });
    expect(lines.length).toBeGreaterThan(0);
    for (const c of lines) {
      if (!c.closed) {
        expect(onBorder(saddle, c.points[0])).toBe(true);
        expect(onBorder(saddle, c.points[c.points.length - 1])).toBe(true);
      }
    }
  });
});

describe("contours of the model terrain", () => {
  const bbox = { x0: -40, y0: -50, x1: 60, y1: 55 };
  const grid = terrain.grid(bbox, 0.5);
  const lines = contourLines(grid, { minor: 0.2, major: 1 });

  it("exist at 0.2 m and 1 m intervals over the height range", () => {
    const levels = new Set(lines.map((l) => l.level));
    expect(levels.size).toBeGreaterThan(10);
    for (const l of levels) expect(Math.abs(l / 0.2 - Math.round(l / 0.2))).toBeLessThan(1e-6);
    const majors = lines.filter((l) => l.major);
    expect(majors.length).toBeGreaterThan(0);
    for (const m of majors) expect(Math.abs(m.level - Math.round(m.level))).toBeLessThan(1e-9);
    expect(lines.some((l) => !l.major)).toBe(true);
  });

  it("every contour is closed or runs from border to border (no dangling ends)", () => {
    for (const c of lines) {
      expect(c.points.length).toBeGreaterThanOrEqual(2);
      if (c.closed) expect(c.points.length).toBeGreaterThanOrEqual(4);
      else {
        expect(onBorder(grid, c.points[0])).toBe(true);
        expect(onBorder(grid, c.points[c.points.length - 1])).toBe(true);
      }
    }
  });

  it("points lie on their level", () => {
    for (const c of lines.filter((l) => l.major)) for (const p of c.points) expect(Math.abs(gridHeight(grid, p[0], p[1]) - c.level)).toBeLessThan(1e-6);
  });

  it("contours of different levels never touch: their distance is at least the level gap over the steepest slope", () => {
    let maxSlope = 0;
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const z = grid.z[j * grid.nx + i];
        if (i + 1 < grid.nx) maxSlope = Math.max(maxSlope, Math.abs(grid.z[j * grid.nx + i + 1] - z) / grid.step);
        if (j + 1 < grid.ny) maxSlope = Math.max(maxSlope, Math.abs(grid.z[(j + 1) * grid.nx + i] - z) / grid.step);
      }
    }
    maxSlope *= 1.5; // bilinear patches may be steeper than their edges
    const pts = lines.filter((l) => l.major).flatMap((l) => l.points.filter((_, i) => i % 5 === 0).map((p) => ({ p, z: l.level })));
    let checked = 0;
    for (let i = 0; i < pts.length; i += 2) {
      for (let j = i + 1; j < pts.length; j += 2) {
        const dz = Math.abs(pts[i].z - pts[j].z);
        if (dz < 1e-9) continue;
        checked++;
        expect(Math.hypot(pts[i].p[0] - pts[j].p[0], pts[i].p[1] - pts[j].p[1])).toBeGreaterThanOrEqual(dz / maxSlope - 1e-9);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("clipping to the plot keeps only parts inside it", () => {
    const plot = site.plot.polygon as XY[];
    const clipped = clipContours(lines, plot);
    expect(clipped.length).toBeGreaterThan(5);
    for (const c of clipped) for (let i = 0; i + 1 < c.points.length; i++) {
      const mid: XY = [(c.points[i][0] + c.points[i + 1][0]) / 2, (c.points[i][1] + c.points[i + 1][1]) / 2];
      expect(pointInPolygon(mid, plot)).toBe(true);
    }
  });

  it("labels: every long enough line is labelled, upright, spaced apart and formatted", () => {
    const clipped = clipContours(lines, site.plot.polygon as XY[]);
    const labels = contourLabels(clipped, { majorSpacing: 30, minSeparation: 8 });
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.some((l) => l.major)).toBe(true);
    expect(labels.some((l) => !l.major)).toBe(true);
    for (const l of labels) {
      expect(l.angleDeg).toBeGreaterThan(-90 - 1e-9);
      expect(l.angleDeg).toBeLessThanOrEqual(90);
      expect(l.text).toMatch(/^(\+|−)\d\.\d$|^±0\.0$/);
      expect(Math.abs(l.level / 0.2 - Math.round(l.level / 0.2))).toBeLessThan(1e-6);
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      expect(Math.hypot(labels[i].x - labels[j].x, labels[i].y - labels[j].y)).toBeGreaterThanOrEqual(8 - 1e-9);
    }
  });

  it("labels sit on their contour; fine labels can be switched off; absolute and custom formats", () => {
    const clipped = clipContours(lines, site.plot.polygon as XY[]);
    for (const l of contourLabels(clipped)) expect(Math.abs(terrain.groundAt(l.x, l.y) - l.level)).toBeLessThan(0.02);
    const majorOnly = contourLabels(clipped, { minorSpacing: Infinity });
    expect(majorOnly.length).toBeGreaterThan(0);
    expect(majorOnly.every((l) => l.major)).toBe(true);
    const asl = contourLabels(clipped, { zeroLevelAsl: site.terrain.zeroLevelAsl, style: "asl" });
    expect(asl.every((l) => Number(l.text) === Math.round((site.terrain.zeroLevelAsl + l.level) * 10) / 10)).toBe(true);
    const custom = contourLabels(clipped, { format: (z) => `h${z.toFixed(0)}` });
    expect(custom.every((l) => l.text.startsWith("h"))).toBe(true);
  });

  it("a long line gets several evenly spaced labels, a short one a single label", () => {
    const long: Contour = { level: 0, major: true, closed: false, points: [[0, 0], [100, 0]] };
    const l = contourLabels([long], { majorSpacing: 30, minSeparation: 5 });
    expect(l.map((q) => q.x)).toEqual([100 / 6, 50, 100 - 100 / 6]);
    const short: Contour = { level: 0.2, major: false, closed: false, points: [[0, 0], [12, 0]] };
    expect(contourLabels([short])).toHaveLength(1);
    expect(contourLabels([{ ...short, points: [[0, 0], [5, 0]] }])).toHaveLength(0);
  });
});

describe("smoothing", () => {
  it("keeps the ends of open lines and doubles the points per pass", () => {
    const line: XY[] = [[0, 0], [1, 0], [2, 1], [3, 1]];
    const s = smoothPolyline(line, false, 1);
    expect(s[0]).toEqual(line[0]);
    expect(s[s.length - 1]).toEqual(line[line.length - 1]);
    expect(s.length).toBe(2 * (line.length - 1) + 2);
    const ring = smoothPolyline([[0, 0], [2, 0], [2, 2], [0, 2]], true, 2);
    expect(ring.length).toBe(16);
  });
});
