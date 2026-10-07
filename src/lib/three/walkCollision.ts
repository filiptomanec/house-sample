// Walk mode, the part without three.js: colliders from the derived walls and the furniture footprints, the sliding move
// of a circle along segments, and the start pose. Pure, so it is tested in node (reachability of every room by flood fill).
//
// Collision is 2D: the walker is a circle of `WALK.radius` in the plan, obstacles are segments. Doors (kinds in
// `PASSABLE_KINDS`) are gaps in the wall segments; windows and garage doors are solid. Furniture boxes come from
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
  /** Outlines of the wall pieces between the passable openings, plus the outlines of non-passable openings' wall pieces. */
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
/**
 * Pure: the walker starts in the room with role "entry", at the point of its label that is farthest from the walls
 * (`room.label`), looking from the entry door into the house (towards the centre of the building). Falls back to the
 * entry room of `derived.access`, then to the first room. No ids.
 */
export function walkStart(ctx: HouseContext): WalkStart {
  const { derived } = ctx;
  const room = derived.rooms.find((r) => r.role === "entry")
    ?? derived.rooms.find((r) => r.id === derived.access.entryRoom)
    ?? derived.rooms[0];
  const b = derived.bbox;
  const centre: Pt = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const position: Pt = room ? [room.label.x, room.label.y] : centre;
  const dx = centre[0] - position[0], dy = centre[1] - position[1];
  // house azimuth: clockwise from +y
  const yawDeg = Math.hypot(dx, dy) < 1e-6 ? 0 : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { position, yawDeg };
}
