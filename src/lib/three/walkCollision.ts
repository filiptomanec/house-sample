// Walk mode, the part without three.js: colliders from the derived walls and the furniture footprints, the sliding move
// of a circle along segments, and the start pose. Pure, so it is tested in node (reachability of every room by flood fill).
//
// Collision is 2D: the walker is a circle of `WALK.radius` in the plan, obstacles are segments. Doors (kinds in
// `PASSABLE_KINDS`) are gaps in the wall segments; windows and garage doors are solid; the water of a pool is solid (its
// rectangle, `derived.outdoor[].pool.water`), so nobody walks into the basin. Furniture boxes come from
// `public/models/furniture-footprints.json` (door clear zones already cut out by the pipeline) and collide only while the
// furniture is shown. The floor height needs no ray: inside the building outline it is 0, outside it is the analytic
// ground (`ctx.site.terrain.groundAt`).
import { wallBody, type OpeningKind, type Pt } from "@/lib/model";
import type { HouseContext } from "./context";
import type { FurnitureFootprints } from "./glb";

export type Seg = [Pt, Pt];
export type Box = [number, number, number, number];

/** Dimensions of the walker and the controls (a person, not the house). */
export const WALK = {
  /** Radius of the collision circle, m. */
  radius: 0.28,
  eyeHeight: 1.62,
  fov: 70,
  /** Walking and running speed, m/s. */
  speed: 1.6,
  run: 3.2,
  /** Turning with the arrow keys, rad/s, and looking with a drag, rad per px. */
  turnRate: 1.6,
  lookYaw: 0.005,
  lookPitch: 0.004,
  maxPitch: 1.2,
  /** A move is split into sub-steps of at most this length so one slow frame cannot carry the walker through a wall. */
  maxStep: 0.1,
} as const;

/** Opening kinds a person walks through. Windows and garage doors are solid. */
export const PASSABLE_KINDS: readonly OpeningKind[] = ["door", "entry", "slider"];

export interface WalkColliders {
  /** Outlines of the wall pieces between the passable openings, plus the outlines of non-passable openings' wall pieces, plus the pool water. */
  walls: Seg[];
  /** Furniture boxes with their outline segments. */
  furniture: { box: Box; segs: Seg[] }[];
}

/**
 * Pure: wall bodies (`wallBody`) split at the passable openings, plus the furniture footprints. `footprints` may be
 * missing (not loaded yet): then there are no furniture colliders.
 */
export function buildWalkColliders(ctx: HouseContext, footprints?: FurnitureFootprints): WalkColliders {
  const { derived } = ctx;
  const walls: Seg[] = [];
  const ring = (x0: number, y0: number, x1: number, y1: number): Seg[] => [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]];
  for (const w of derived.walls) {
    const [bx0, by0, bx1, by1] = wallBody(w, derived.walls);
    // the openings a person walks through are gaps in this wall: pieces of the body between them remain
    const gaps = derived.openings
      .filter((o) => o.wallId === w.id && (PASSABLE_KINDS as readonly string[]).includes(o.kind))
      .map((o): [number, number] => [o.from, o.to])
      .sort((a, b) => a[0] - b[0]);
    const alongLo = w.orient === "h" ? bx0 : by0, alongHi = w.orient === "h" ? bx1 : by1;
    let cursor = alongLo;
    const pieces: [number, number][] = [];
    for (const [g0, g1] of gaps) {
      if (g0 > cursor + 1e-9) pieces.push([cursor, Math.min(g0, alongHi)]);
      cursor = Math.max(cursor, g1);
    }
    if (cursor < alongHi - 1e-9) pieces.push([cursor, alongHi]);
    for (const [a, b] of pieces) {
      walls.push(...(w.orient === "h" ? ring(a, by0, b, by1) : ring(bx0, a, bx1, b)));
    }
  }
  // the water of every pool is solid: the walker stops at the coping
  for (const o of derived.outdoor) if (o.pool) walls.push(...ring(...(o.pool.water as Box)));
  const furniture = (footprints?.items ?? []).map((f) => ({ box: f.box as Box, segs: ring(...f.box) }));
  return { walls, furniture };
}

/**
 * The segments to test at position `p`: the walls, and the furniture boxes when `furnitureShown`, except the one the walker
 * is standing in (switched on while standing in a piece, the walker may first step out of it).
 */
const allCache = new WeakMap<WalkColliders, Seg[]>();

export function collidersAt(c: WalkColliders, furnitureShown: boolean, p: Pt): Seg[] {
  if (!furnitureShown || !c.furniture.length) return c.walls;
  let all = allCache.get(c);
  if (!all) {
    all = [...c.walls, ...c.furniture.flatMap((f) => f.segs)];
    allCache.set(c, all);
  }
  const inside = c.furniture.some(({ box }) => p[0] > box[0] && p[0] < box[2] && p[1] > box[1] && p[1] < box[3]);
  // switched on while standing in a piece, the walker may first step out of it
  return inside ? c.walls : all;
}

/** Pushes a point out to `R` from every segment (three passes, for corners). */
export function slide(q: Pt, segs: readonly Seg[], R: number = WALK.radius): Pt {
  for (let it = 0; it < 3; it++) {
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      if (!L) continue;
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L));
      const cx = a[0] + t * dx, cy = a[1] + t * dy, ex = q[0] - cx, ey = q[1] - cy, d = Math.hypot(ex, ey);
      if (d < R && d > 1e-6) q = [cx + (ex / d) * R, cy + (ey / d) * R];
    }
  }
  return q;
}

/**
 * Moves from `p` by `d` in sub-steps of at most `step`, sliding along whatever is in the way, so no step can land past the
 * middle of a wall and be pushed out on the far side. `segsAt` gives the colliders for the current position.
 */
export function move(p: Pt, d: Pt, segsAt: (p: Pt) => readonly Seg[], R: number = WALK.radius, step: number = WALK.maxStep): Pt {
  const n = Math.max(1, Math.ceil(Math.hypot(d[0], d[1]) / step));
  for (let i = 0; i < n; i++) p = slide([p[0] + d[0] / n, p[1] + d[1] / n], segsAt(p), R);
  return p;
}

export interface WalkStart {
  /** House-frame position (x, y). */
  position: Pt;
  /** House azimuth of the view direction, degrees clockwise from +y. */
  yawDeg: number;
}

/** Placing the start: share of the room depth behind the window, clearance from furniture and walls, search step (m). */
export const WALK_START = { depthShare: 0.65, clearance: 0.12, step: 0.1 } as const;

const inRect = (p: Pt, r: readonly number[], grow = 0) => p[0] > r[0] - grow && p[0] < r[2] + grow && p[1] > r[1] - grow && p[1] < r[3] + grow;

/**
 * Pure: the walker starts in the main living room (role "main-living", else the largest room of the day zone, else the entry
 * room), looking out of its largest glazed exterior opening (towards the garden, the yaw is the opening's outward azimuth). It
 * stands behind that opening by `WALK_START.depthShare` of the room's depth along the view, on the first point of the line back
 * to the opening that is free of the furniture (`derived.furniture[].rect`, grown by the walker's radius) and inside the room,
 * so the first frame is the open living space with the garden behind the glass. A room without a glazed opening falls back to
 * its label point, looking at the centre of the building. No ids.
 */
export function walkStart(ctx: HouseContext): WalkStart {
  const { derived } = ctx;
  const day = derived.rooms.filter((r) => r.zone === "day").sort((a, b) => b.area - a.area);
  const room = derived.rooms.find((r) => r.role === "main-living")
    ?? day[0]
    ?? derived.rooms.find((r) => r.role === "entry")
    ?? derived.rooms.find((r) => r.id === derived.access.entryRoom)
    ?? derived.rooms[0];
  const b = derived.bbox;
  const centre: Pt = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const yawTo = (from: Pt, to: Pt) => {
    const dx = to[0] - from[0], dy = to[1] - from[1];
    return Math.hypot(dx, dy) < 1e-6 ? 0 : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  };
  if (!room) return { position: centre, yawDeg: 0 };
  const label: Pt = [room.label.x, room.label.y];
  const window = derived.openings
    .filter((o) => o.room === room.id && o.exterior === true && o.glazingArea > 0 && o.azimuth !== null)
    .sort((p, q) => q.glazingArea - p.glazingArea)[0];
  if (!window || window.azimuth === null) return { position: label, yawDeg: yawTo(label, centre) };
  // outward normal of the opening (house azimuth clockwise from +y) and the way into the room
  const a = (window.azimuth * Math.PI) / 180;
  const inward: Pt = [-Math.sin(a), -Math.cos(a)];
  const sill: Pt = [window.cx, window.cy];
  const inside = (p: Pt) => room.rects.some((r) => inRect(p, r, -(WALK.radius + WALK_START.clearance)));
  // depth of the room behind the opening along the view
  let depth = 0;
  for (let d = WALK_START.step; d < 50; d += WALK_START.step) {
    if (room.rects.some((r) => inRect([sill[0] + inward[0] * d, sill[1] + inward[1] * d], r))) depth = d;
    else if (depth > 0) break;
  }
  const grow = WALK.radius + WALK_START.clearance;
  const furniture = derived.furniture.filter((f) => f.rect).map((f) => f.rect as readonly number[]);
  const free = (p: Pt) => inside(p) && !furniture.some((r) => inRect(p, r, grow));
  const yawDeg = ((window.azimuth % 360) + 360) % 360;
  for (let d = depth * WALK_START.depthShare; d > WALK.radius; d -= WALK_START.step) {
    // on the axis of the opening first, then a little to either side
    for (const side of [0, 0.5, -0.5, 1, -1]) {
      const p: Pt = [sill[0] + inward[0] * d - inward[1] * side, sill[1] + inward[1] * d + inward[0] * side];
      if (free(p)) return { position: p, yawDeg };
    }
  }
  return { position: label, yawDeg };
}
