// Axis-aligned rectangle helpers for the floor plan: difference of rectangle sets and polygon rings in plan space.
// All inputs are house-frame rectangles [x0, y0, x1, y1]; results are exact (coordinate compression, no clipper).
import { R5, rectInter, uniqSorted, unionOf, type Pt, type Rect } from "@/lib/model/geom";

/** A rectangle set A minus a rectangle set B, as grid cells that are covered by A and not by B. */
export function differenceOf(base: readonly Rect[], cut: readonly Rect[]): Rect[] {
  const a = base.filter((r) => r[2] > r[0] && r[3] > r[1]);
  if (!a.length) return [];
  const all = [...a, ...cut];
  const xs = uniqSorted(all.flatMap((r) => [r[0], r[2]]));
  const ys = uniqSorted(all.flatMap((r) => [r[1], r[3]]));
  const covers = (rs: readonly Rect[], cx: number, cy: number) => rs.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  const out: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (covers(a, cx, cy) && !covers(cut, cx, cy)) out.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
    }
  }
  return out;
}

/** A closed ring of points; the plan keeps outer rings counter-clockwise on screen (positive area) and holes clockwise. */
export type Ring = Pt[];

/** Boundary rings of the union of rectangles (outer rings and holes), in house coordinates. */
export function ringsOf(rects: readonly Rect[]): { rings: Ring[]; area: number; perimeter: number } {
  const u = unionOf([...rects]);
  return { rings: u.polygons.map((p) => p.pts), area: u.area, perimeter: u.perimeter };
}

/** Signed shoelace area of a ring (positive for counter-clockwise in a y-up frame). */
export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Rectangle clipped to a box, or null when nothing is left. */
export function clipRect(r: Rect, box: Rect): Rect | null {
  const q = rectInter(r, box);
  return q && q[2] > q[0] && q[3] > q[1] ? q : null;
}

export const union2 = (a: Rect, b: Rect): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

export { R5 };
