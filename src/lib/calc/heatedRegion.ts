// The heated part of the plan to the outer face of the walls: the region that the floor on the ground and the ceiling under a
// cold attic cover, and whose perimeter is the exposed perimeter of EN ISO 13370. Shared by the energy balance (floor and
// ceiling rows) and the bill of quantities (`ceilingAreaHeated`), so the two pages price and heat the same area.
//
// Pure, deterministic, independent of the order of the rooms. Contract: docs/CALC-API.md, section 7.2.
import { inRect, uniqSorted, unionOf, type Rect } from "@/lib/model/geom";
import type { Derived } from "@/lib/model/types";

export interface HeatedRegion {
  /** Area of the heated region to the outer face, m2 (the energy reference area; equals the kernel's `metrics.heatedAreaGross`). */
  area: number;
  /** Its perimeter, m: the outside walls and the walls to unheated rooms (the exposed perimeter of EN ISO 13370). */
  perimeter: number;
  /** The region as disjoint rectangles in the house frame. */
  rects: Rect[];
}

/** Two distances closer than this count as equal (the tie-break below decides). */
const TIE = 1e-9;

/** Distance from a point to a rectangle (0 inside). */
function distToRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dy = Math.max(r[1] - y, 0, y - r[3]);
  return Math.hypot(dx, dy);
}

/**
 * The outline of the house cut into cells at every edge of the outline and of the room rectangles. A cell inside a room belongs
 * to it; a cell in the body of a wall belongs to the nearest room, so the boundary between a heated and an unheated room runs on
 * the axis of the wall between them and the outside walls belong to the rooms behind them (the rule of `metrics.heatedAreaGross`).
 * On a tie (a corner square where two walls cross) the unheated room wins, whatever the order of the rooms. The heated cells
 * are merged into rectangles; their union gives the area and the perimeter.
 */
export function heatedRegion(derived: Pick<Derived, "outline" | "rooms">): HeatedRegion {
  const outline = derived.outline.rects as Rect[];
  const rooms = derived.rooms.map((r) => ({ heated: r.heated, rects: r.rects as Rect[] }));
  const edges = [...outline, ...rooms.flatMap((r) => r.rects)];
  const xs = uniqSorted(edges.flatMap((q) => [q[0], q[2]]));
  const ys = uniqSorted(edges.flatMap((q) => [q[1], q[3]]));
  const cells: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (!outline.some((q) => inRect(q, cx, cy))) continue;
      let heated = false;
      const inside = rooms.find((r) => r.rects.some((q) => inRect(q, cx, cy)));
      if (inside) heated = inside.heated;
      else {
        let best = Infinity;
        for (const r of rooms) {
          const d = Math.min(...r.rects.map((q) => distToRect(cx, cy, q)));
          if (d < best - TIE) {
            best = d;
            heated = r.heated;
          } else if (Math.abs(d - best) <= TIE && !r.heated) heated = false;
        }
      }
      if (heated) cells.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
    }
  }
  const u = unionOf(cells);
  return { area: u.area, perimeter: u.perimeter, rects: u.rects };
}
