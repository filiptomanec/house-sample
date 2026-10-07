import { describe, expect, it } from "vitest";
import {
  bboxOf, clipPolylineToPolygon, distToBoundary, ensureCcw, houseToTrueAzimuth, houseToTrueXY, insetPolygon, intersectionArea,
  pointInPolygon, polylineLength, polygonArea, polygonCentroid, polygonPolygonClosest, rayToBoundary, rectToPolygon, segmentSegmentClosest,
  signedArea, trueToHouseXY, unionArea, type XY,
} from "../geometry";

describe("polygon area (shoelace)", () => {
  it("matches known shapes in either winding", () => {
    const square: XY[] = [[0, 0], [4, 0], [4, 3], [0, 3]];
    expect(polygonArea(square)).toBeCloseTo(12, 12);
    expect(polygonArea([...square].reverse())).toBeCloseTo(12, 12);
    expect(signedArea(square)).toBeGreaterThan(0);
    expect(signedArea([...square].reverse())).toBeLessThan(0);
    expect(signedArea(ensureCcw([...square].reverse()))).toBeGreaterThan(0);
    expect(polygonArea([[0, 0], [6, 0], [0, 4]])).toBeCloseTo(12, 12);
  });

  it("is translation and rotation invariant", () => {
    const p: XY[] = [[1, 1], [9, 2], [8, 7], [2, 6]];
    const base = polygonArea(p);
    const moved = p.map(([x, y]) => [x + 100, y - 40] as XY);
    expect(polygonArea(moved)).toBeCloseTo(base, 9);
    const turned = p.map((q) => houseToTrueXY(q, 37));
    expect(polygonArea(turned)).toBeCloseTo(base, 9);
  });

  it("centroid of a rectangle is its centre", () => {
    const [cx, cy] = polygonCentroid(rectToPolygon([2, 4, 10, 8]));
    expect(cx).toBeCloseTo(6, 12);
    expect(cy).toBeCloseTo(6, 12);
  });
});

describe("union and intersection area", () => {
  it("counts overlaps once", () => {
    const a = rectToPolygon([0, 0, 4, 4]);
    const b = rectToPolygon([2, 2, 6, 6]);
    expect(unionArea([a, b])).toBeCloseTo(16 + 16 - 4, 9);
    expect(intersectionArea(a, b)).toBeCloseTo(4, 9);
  });

  it("handles contained, disjoint and touching shapes", () => {
    const big = rectToPolygon([0, 0, 10, 10]);
    expect(unionArea([big, rectToPolygon([2, 2, 3, 3])])).toBeCloseTo(100, 9);
    expect(unionArea([rectToPolygon([0, 0, 1, 1]), rectToPolygon([5, 5, 6, 6])])).toBeCloseTo(2, 9);
    expect(unionArea([rectToPolygon([0, 0, 1, 1]), rectToPolygon([1, 0, 2, 1])])).toBeCloseTo(2, 9);
  });

  it("clips by a non-axis-aligned polygon and agrees with a fine sampling", () => {
    const tri: XY[] = [[0, 0], [10, 0], [0, 10]];
    const shapes = [rectToPolygon([1, 1, 7, 5]), rectToPolygon([4, 3, 9, 9])];
    const exact = unionArea(shapes, tri);
    let n = 0;
    const h = 0.02;
    for (let x = h / 2; x < 10; x += h) {
      for (let y = h / 2; y < 10; y += h) {
        if (pointInPolygon([x, y], tri) && shapes.some((s) => pointInPolygon([x, y], s))) n++;
      }
    }
    expect(exact).toBeCloseTo(n * h * h, 1);
  });

  it("handles concave L shapes", () => {
    const l: XY[] = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
    expect(polygonArea(l)).toBeCloseTo(20, 12);
    expect(unionArea([l])).toBeCloseTo(20, 9);
    expect(intersectionArea(l, rectToPolygon([0, 0, 3, 3]))).toBeCloseTo(3 * 2 + 1 * 2, 9);
  });
});

describe("distances", () => {
  it("segment to segment closest points", () => {
    const c = segmentSegmentClosest([0, 0], [4, 0], [1, 3], [5, 3]);
    expect(c.d).toBeCloseTo(3, 12);
    const x = segmentSegmentClosest([0, 0], [4, 4], [0, 4], [4, 0]);
    expect(x.d).toBe(0);
    const end = segmentSegmentClosest([0, 0], [1, 0], [3, 4], [3, 8]);
    expect(end.d).toBeCloseTo(Math.hypot(2, 4), 12);
  });

  it("polygon to polygon distance and point-to-boundary", () => {
    const a = rectToPolygon([0, 0, 4, 4]);
    const b = rectToPolygon([7, 1, 9, 3]);
    const c = polygonPolygonClosest(a, b);
    expect(c.d).toBeCloseTo(3, 12);
    expect(distToBoundary(c.from, a)).toBeLessThan(1e-9);
    expect(distToBoundary(c.to, b)).toBeLessThan(1e-9);
    expect(polygonPolygonClosest(a, rectToPolygon([1, 1, 2, 2])).d).toBe(0);
  });

  it("ray to the boundary follows the house azimuth", () => {
    const sq = rectToPolygon([-10, -10, 10, 10]);
    const n = rayToBoundary([0, 0], 0, sq);
    expect(n?.d).toBeCloseTo(10, 9);
    const e = rayToBoundary([0, 0], 90, sq);
    expect(e?.d).toBeCloseTo(10, 9);
    const ne = rayToBoundary([0, 0], 45, sq);
    expect(ne?.d).toBeCloseTo(10 * Math.SQRT2, 9);
  });
});

describe("clipping and offsetting", () => {
  it("keeps only the parts of a polyline inside the polygon", () => {
    const sq = rectToPolygon([0, 0, 10, 10]);
    const pieces = clipPolylineToPolygon([[-5, 5], [15, 5]], sq);
    expect(pieces).toHaveLength(1);
    expect(pieces[0][0][0]).toBeCloseTo(0, 9);
    expect(pieces[0][pieces[0].length - 1][0]).toBeCloseTo(10, 9);
    const two = clipPolylineToPolygon([[-5, 5], [5, 5], [5, 20], [-5, 20], [-5, 8], [12, 8]], sq);
    expect(two.length).toBe(2);
  });

  it("insets a convex polygon with mitred corners (rectangle: exact)", () => {
    const r = insetPolygon(rectToPolygon([0, 0, 10, 6]), 1);
    expect(polygonArea(r)).toBeCloseTo(8 * 4, 9);
    const b = bboxOf(r);
    expect([b.x0, b.y0, b.x1, b.y1]).toEqual([1, 1, 9, 5]);
  });

  it("round-trips between the house frame and true compass directions", () => {
    const p: XY = [3.2, -7.5];
    const t = houseToTrueXY(p, 12);
    const back = trueToHouseXY(t, 12);
    expect(back[0]).toBeCloseTo(p[0], 12);
    expect(back[1]).toBeCloseTo(p[1], 12);
    // The house +y axis points 12 degrees east of north.
    const [e, n] = houseToTrueXY([0, 1], 12);
    expect(Math.atan2(e, n) * (180 / Math.PI)).toBeCloseTo(12, 9);
    expect(houseToTrueAzimuth(180, 12)).toBe(192);
    expect(houseToTrueAzimuth(350, 12)).toBe(2);
  });

  it("path length helper agrees with segment sums", () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBeCloseTo(11, 12);
  });
});
