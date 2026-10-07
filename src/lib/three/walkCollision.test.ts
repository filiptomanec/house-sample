import { describe, expect, it } from "vitest";
import { WALK, move, slide, type Seg } from "./walkCollision";

// a 2 m x 2 m closed box and a free-standing wall; the walker has radius R
const R = WALK.radius;
const box: Seg[] = [
  [[0, 0], [2, 0]], [[2, 0], [2, 2]], [[2, 2], [0, 2]], [[0, 2], [0, 0]],
];

const distToSegs = (p: [number, number], segs: Seg[]) =>
  Math.min(...segs.map(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }));

describe("sliding", () => {
  it("leaves a free point alone", () => {
    expect(slide([1, 1], box)).toEqual([1, 1]);
  });

  it("pushes a point out to the radius from a wall, along the normal", () => {
    const q = slide([1, 0.1], box);
    expect(q[0]).toBeCloseTo(1, 12);
    expect(q[1]).toBeCloseTo(R, 12);
  });

  it("keeps the radius in a corner", () => {
    const q = slide([0.05, 0.05], box);
    expect(distToSegs(q, box)).toBeGreaterThanOrEqual(R - 1e-9);
  });
});

describe("moving", () => {
  it("walks freely through open space by exactly the requested vector", () => {
    const p = move([1, 1], [0.3, -0.2], () => []);
    expect(p[0]).toBeCloseTo(1.3, 12);
    expect(p[1]).toBeCloseTo(0.8, 12);
  });

  it("slides along a wall instead of stopping", () => {
    const p = move([1, 1], [0, -1.5], () => box); // straight at the south wall
    expect(p[1]).toBeCloseTo(R, 9);
    const q = move([1, R], [0.5, -0.5], () => box); // diagonal into the wall: keeps the along-wall part
    expect(q[0]).toBeGreaterThan(1.3);
    expect(q[1]).toBeGreaterThanOrEqual(R - 1e-9);
  });

  it("cannot tunnel through a wall in one big step (slow frame, running)", () => {
    // 3.2 m/s at 5 fps is 0.64 m per frame, more than twice the radius
    let p: [number, number] = [1, 1];
    for (let i = 0; i < 40; i++) p = move(p, [0, -0.64], () => box);
    expect(p[1]).toBeGreaterThanOrEqual(R - 1e-9);
    for (let i = 0; i < 40; i++) p = move(p, [0.64, 0.64], () => box);
    expect(p[0]).toBeLessThanOrEqual(2 - R + 1e-9);
    expect(p[1]).toBeLessThanOrEqual(2 - R + 1e-9);
  });
});
