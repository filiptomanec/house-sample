/**
 * Floor plan drawing primitives, built from the derived data of the house. Pure: no DOM, no text, no I/O.
 *
 *     const drawing = buildPlanDrawing(derived);               // options are optional (see PlanOptions)
 *     <svg viewBox={viewBoxOf(drawing)}>...</svg>
 *
 * PLAN SPACE. Every coordinate is in metres and ready for SVG: `x` is the house x (east, to the right) and
 * `y = -(house y)`, so house north is up. The plan is drawn in the house frame (not rotated to true north); the north
 * arrow carries the rotation (`drawing.north.angleDeg`, clockwise on screen). Rings are `[x, y][]`; outer rings have a
 * positive shoelace area in plan space and holes a negative one, so one `<path fill-rule="evenodd">` with all rings of a
 * layer is correct. Joined with `pathOf()` from ./svg.
 *
 * WHAT THE DRAWING HOLDS (all arrays are in model order; ids are labels, never branch on them):
 *   rooms      fill polygon between wall axes (`rings`, for fills and hit tests), net polygon (`net`, inside the walls),
 *              the fill colour key by room type, label anchor with the free span at that point
 *   walls      one layer per wall kind (`partition`, `bearing`, `exterior`, in drawing order): the union of the wall bodies
 *              with clean corners and T-junctions, minus the gaps of the openings
 *   openings   per opening: the gap rectangle through the wall, the symbol segments (window glass, door leaf, sliding panes,
 *              garage door track, side light), the swing arc of doors, and for exterior openings the facade anchor
 *   outdoor    terraces, decks, pools, paving, drive, path (clipped to `outdoorReach` from the house unless covered; with
 *              `garden` the pools and the decks around them are drawn whole and the reach grows around them), with posts,
 *              the pool parts (water, coping), the cut-outs and a label anchor (centre of the largest free rectangle)
 *   furniture  outlines of `derived.furniture` with a line marking the back of the item
 *   screens, lightpipes, dimensions (overall width and depth), north arrow, scale bar
 *   viewBox    the drawing frame including the margin for dimensions, north arrow and scale bar
 *
 * `./svg` turns a drawing into SVG markup (`planLayers`, `planToSvg`) and `./labels` places room numbers, areas, window
 * sizes and furniture names for a given on-screen scale. Colours are token names (`PLAN_FILL`), never literals.
 */
import { doorSwing, pointInRing, unionOf, wallBody, type BBox, type Pt, type Rect } from "@/lib/model/geom";
import type { Derived, DerivedOpening, DerivedOutdoor, DerivedWall, Dir, Facing8, LocalizedText, OpeningKind, OutdoorRole, OutdoorType, RoomRole, RoomType, WallKind } from "@/lib/model/types";
import { clipRect, differenceOf, ringsOf, signedArea, union2 } from "./rects";
import { ROOM_FILL, mm, type FillKey, type PlanPt, type PlanRect, type PlanRing } from "./shared";

export { PLAN_FILL, ROOM_FILL, viewBoxOf, type FillKey, type PlanPt, type PlanRect, type PlanRing } from "./shared";

export interface PlanOptions {
  /** Outlines of the furniture of the model (default true). */
  furniture?: boolean;
  /** How far (m) uncovered outdoor areas are drawn beyond the outline of the house (default 1.8). */
  outdoorReach?: number;
  /** Free space (m) around the drawing for dimensions, north arrow and scale bar (default 1.6). */
  margin?: number;
  /**
   * Draw the garden rooms whole (default false): pools and the areas with a pool in them, like covered areas. The reach that
   * clips the other uncovered areas is then measured from the house and those garden rooms together, so the paving between
   * the house and the pool deck stays whole while the drive and the path are still cut near the house.
   */
  garden?: boolean;
}

export interface PlanLabelAnchor {
  /** Best label point (pole of inaccessibility) and the radius of the free circle around it. */
  at: PlanPt;
  r: number;
  /** Free interval of the room along x and along y through the label point (plan space), for fitting text. */
  spanX: [number, number];
  spanY: [number, number];
}

export interface PlanRoom {
  id: string;
  type: RoomType;
  role: RoomRole | null;
  fill: FillKey;
  /** Outline between the wall axes (fills, hit tests) and the net outline inside the walls. */
  rings: PlanRing[];
  net: PlanRing[];
  /** Net floor area (m2) and net perimeter (m). */
  area: number;
  perimeter: number;
  label: PlanLabelAnchor;
}

export interface PlanWallLayer {
  kind: WallKind;
  rings: PlanRing[];
  /** Area of the layer (m2): outer rings minus holes. */
  area: number;
}

export type PlanSegRole = "glass" | "leaf" | "track";
export interface PlanSeg { role: PlanSegRole; a: PlanPt; b: PlanPt }
/** Quarter-circle swing of a door leaf from `from` (leaf open) to `to` (leaf closed); `sweep` is the SVG sweep flag. */
export interface PlanArc { center: PlanPt; from: PlanPt; to: PlanPt; r: number; sweep: 0 | 1 }

export interface PlanOpening {
  id: string;
  kind: OpeningKind;
  exterior: boolean;
  /** Room of an exterior opening. */
  room: string | null;
  /** The cut through the wall (full wall thickness). */
  gap: PlanRect;
  segments: PlanSeg[];
  arc: PlanArc | null;
  /** Width, height (head - sill) and sill height, m. */
  w: number;
  h: number;
  sill: number;
  /** Exterior openings: centre of the opening on the outer face of the wall and the unit vector pointing out of the house. */
  facade: { at: PlanPt; out: PlanPt; dir: Dir; facing: Facing8 } | null;
}

export interface PlanOutdoor {
  id: string;
  type: OutdoorType;
  /** Name of the area in the model (null: the page uses the name of its type). */
  name: LocalizedText | null;
  /** Finish of the slab (the GLB role): the drawing hatches decks and tiles paving by it. */
  role: OutdoorRole;
  fill: FillKey;
  covered: boolean;
  rect: PlanRect;
  /** Drawn area (m2) and whether the area was cut at the reach. */
  area: number;
  cut: boolean;
  posts: PlanPt[];
  /** Side of the square posts, m (from the model), or null when the area has none. */
  postSize: number | null;
  /** Cut-outs inside the drawn rect (the coping outline of a pool in a deck). */
  holes: PlanRect[];
  /** A pool: the water surface and the outer edge of the coping around it. */
  pool: { water: PlanRect; outer: PlanRect } | null;
  /**
   * Where a name fits: the centre and size of the largest free rectangle of the drawn area (holes, the house and the areas
   * drawn over this one taken out). Plan space.
   */
  label: { at: PlanPt; w: number; h: number };
}

export interface PlanFurniture {
  index: number;
  type: string;
  rect: PlanRect;
  rot: number;
  room: string | null;
  outdoor: boolean;
  /** A line just inside the back edge (bed head, sofa back) that shows how the item faces. */
  back: [PlanPt, PlanPt];
}

export interface PlanDimension {
  /** Which overall dimension: along x or along y. */
  axis: "width" | "depth";
  /** The measured line (parallel to the footprint edge, outside it) and its extension lines. */
  line: [PlanPt, PlanPt];
  ext: [PlanPt, PlanPt][];
  /** Length in metres and the point where the text is centred. */
  value: number;
  text: PlanPt;
}

export interface PlanDrawing {
  viewBox: { x: number; y: number; w: number; h: number };
  /** Bearing of the house +y axis from true north (deg). */
  bearingDeg: number;
  /** Footprint including the walls. */
  outline: PlanRing[];
  rooms: PlanRoom[];
  /** In drawing order: partition, bearing, exterior. */
  walls: PlanWallLayer[];
  openings: PlanOpening[];
  outdoor: PlanOutdoor[];
  furniture: PlanFurniture[];
  screens: { a: PlanPt; b: PlanPt }[];
  lightpipes: { at: PlanPt; r: number }[];
  dimensions: PlanDimension[];
  /** North arrow: centre and rotation (clockwise on screen, degrees) of an arrow that points up when the bearing is 0. */
  north: { at: PlanPt; angleDeg: number };
  /** Scale bar: left end and length (m). */
  scale: { at: PlanPt; length: number };
}

// ------------------------------------------------------------------------------------------------ drawing constants
/** Length of the scale bar, m. */
const SCALE_BAR = 5;
/** Distance of the overall dimension lines from the footprint, m, and how far the extension lines overshoot. */
const DIM_OFFSET = 1.25;
const DIM_OVERSHOOT = 0.15;
/** Offset of the glass lines of a sliding wall from the wall axis, m. */
const PANE_OFFSET = 0.045;
/** Inset of the "back" line of a furniture item, as a share of its depth (capped at 0.12 m). */
const BACK_INSET = 0.14;
const WALL_ORDER: readonly WallKind[] = ["partition", "bearing", "exterior"];

// ------------------------------------------------------------------------------------------------ helpers
const P = (x: number, y: number): PlanPt => [mm(x), mm(-y)];
const planRect = (r: Rect): PlanRect => [mm(r[0]), mm(-r[3]), mm(r[2]), mm(-r[1])];
/** House-frame ring to a plan-space ring with the orientation convention (outer rings positive). */
const planRing = (ring: Pt[]): PlanRing => ring.map(([x, y]) => P(x, y)).reverse();

/** Free interval of a polygon along `axis` (0: x, 1: y) through the point `at`; falls back to ±0.5 m. House coordinates. */
export function spanAt(ring: Pt[], at: Pt, axis: 0 | 1): [number, number] {
  const o = 1 - axis, cut: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    if ((p[o] > at[o]) !== (q[o] > at[o])) cut.push(p[axis] + ((at[o] - p[o]) * (q[axis] - p[axis])) / (q[o] - p[o]));
  }
  cut.sort((a, b) => a - b);
  for (let i = 0; i + 1 < cut.length; i += 2) if (at[axis] >= cut[i] && at[axis] <= cut[i + 1]) return [cut[i], cut[i + 1]];
  return [at[axis] - 0.5, at[axis] + 0.5];
}

function roomsOf(d: Derived): PlanRoom[] {
  return d.rooms.map((r) => {
    const axis = ringsOf(r.rects), net = ringsOf(r.cleanRects);
    // the ring that contains the label point (a room may have several parts)
    const outer = net.rings.filter((q) => signedArea(q) > 0);
    const at: Pt = [r.label.x, r.label.y];
    const ring = outer.find((q) => pointInRing(at, q)) ?? outer[0] ?? [];
    const sx = spanAt(ring, at, 0), sy = spanAt(ring, at, 1);
    return {
      id: r.id, type: r.type, role: r.role ?? null, fill: ROOM_FILL[r.type],
      rings: axis.rings.map(planRing), net: net.rings.map(planRing), area: r.area, perimeter: mm(net.perimeter),
      label: { at: P(at[0], at[1]), r: mm(r.label.r), spanX: [mm(sx[0]), mm(sx[1])], spanY: [mm(-sy[1]), mm(-sy[0])] },
    };
  });
}

/** Rectangle of the cut that an opening makes through its wall (house frame). */
export function gapRect(o: Pick<DerivedOpening, "orient" | "c" | "w">, wall: Pick<DerivedWall, "at" | "t">): Rect {
  return o.orient === "h"
    ? [o.c - o.w / 2, wall.at - wall.t / 2, o.c + o.w / 2, wall.at + wall.t / 2]
    : [wall.at - wall.t / 2, o.c - o.w / 2, wall.at + wall.t / 2, o.c + o.w / 2];
}

/**
 * Wall bodies are the axis segments plus the half thickness of crossing walls. Where a thick wall meets a thin one that
 * extension can reach 5 to 17 cm into the corner of a net room (a small notch), so the net rooms are cut out as well:
 * the drawing then never shows a wall inside a room.
 */
function wallLayers(d: Derived, gaps: Rect[]): PlanWallLayer[] {
  const cut = [...gaps, ...d.rooms.flatMap((r) => r.cleanRects)];
  return WALL_ORDER.map((kind) => {
    const bodies = d.walls.filter((w) => w.kind === kind).map((w) => wallBody(w, d.walls));
    const u = unionOf(differenceOf(bodies, cut));
    const rings = u.polygons.map((p) => planRing(p.pts));
    return { kind, rings, area: mm(u.area) };
  });
}

function openingOf(o: DerivedOpening, wall: DerivedWall): PlanOpening {
  const gap = gapRect(o, wall);
  const along = (a: number, perp: number): Pt => (o.orient === "h" ? [a, wall.at + perp] : [wall.at + perp, a]);
  const seg = (role: PlanSegRole, a0: number, a1: number, perp: number): PlanSeg => ({ role, a: P(...along(a0, perp)), b: P(...along(a1, perp)) });
  const segments: PlanSeg[] = [];
  let arc: PlanArc | null = null;
  const lo = o.c - o.w / 2, hi = o.c + o.w / 2;
  if (o.kind === "window") segments.push(seg("glass", lo, hi, 0));
  else if (o.kind === "slider") {
    segments.push(seg("glass", lo, o.c + 0.1 * o.w, -PANE_OFFSET), seg("glass", o.c - 0.1 * o.w, hi, PANE_OFFSET));
  } else if (o.kind === "garage") segments.push(seg("track", lo, hi, 0));
  else {
    const sw = doorSwing({ kind: o.kind, orient: o.orient, swing: o.swing, hinge: o.hinge, w: o.w, c: o.c, axis: wall.at }, wall.t);
    if (sw) {
      const hinge = P(...sw.hinge), leafEnd = P(...sw.leafEnd), closedEnd = P(...sw.closedEnd);
      segments.push({ role: "leaf", a: hinge, b: leafEnd });
      const cross = (leafEnd[0] - hinge[0]) * (closedEnd[1] - hinge[1]) - (leafEnd[1] - hinge[1]) * (closedEnd[0] - hinge[0]);
      arc = { center: hinge, from: leafEnd, to: closedEnd, r: mm(sw.radius), sweep: cross > 0 ? 1 : 0 };
      // an entry leaf is at most as wide as the door; the rest of the gap is a side light
      const rest = o.w - sw.radius;
      if (o.kind === "entry" && rest > 0.05) {
        const hd = o.hinge === "+" ? 1 : -1, from = o.c + hd * (o.w / 2 - sw.radius), to = o.c - (hd * o.w) / 2;
        segments.push(seg("glass", Math.min(from, to), Math.max(from, to), 0));
      }
    }
  }
  let facade: PlanOpening["facade"] = null;
  if (o.exterior && o.azimuth !== null && o.dir && o.facing) {
    const a = (o.azimuth * Math.PI) / 180, n: Pt = [Math.round(Math.sin(a)), Math.round(Math.cos(a))];
    const mid = along(o.c, 0);
    facade = { at: P(mid[0] + (n[0] * wall.t) / 2, mid[1] + (n[1] * wall.t) / 2), out: [n[0] + 0, -n[1] + 0], dir: o.dir, facing: o.facing };
  }
  return {
    id: o.id, kind: o.kind, exterior: Boolean(o.exterior), room: o.exterior ? o.room : null, gap: planRect(gap), segments, arc,
    w: o.w, h: mm(o.head - o.sill), sill: o.sill, facade,
  };
}

function furnitureOf(d: Derived): PlanFurniture[] {
  return d.furniture.map((f) => {
    const [x0, y0, x1, y1] = f.rect, depth = f.rot % 180 === 0 ? y1 - y0 : x1 - x0;
    const inset = Math.min(0.12, depth * BACK_INSET);
    // the back faces +y at rot 0 and turns counter-clockwise with rot
    const back: [Pt, Pt] = f.rot === 0 ? [[x0, y1 - inset], [x1, y1 - inset]]
      : f.rot === 90 ? [[x0 + inset, y0], [x0 + inset, y1]]
      : f.rot === 180 ? [[x0, y0 + inset], [x1, y0 + inset]]
      : [[x1 - inset, y0], [x1 - inset, y1]];
    return { index: f.index, type: f.type, rect: planRect(f.rect), rot: f.rot, room: f.room, outdoor: f.outdoor !== null, back: [P(...back[0]), P(...back[1])] };
  });
}

/** Fill of an outdoor area: decks (and the covered terrace on boards) get the deck hatch, a pool its water, the rest paving. */
const outdoorFill = (o: Pick<DerivedOutdoor, "role" | "type" | "pool">): FillKey => (o.pool ? "pool" : o.role === "deck" || o.type === "terrace" ? "terrace" : "paving");
/** Drawing order of the outdoor fills: paving first, then decks, pools on top. */
const OUTDOOR_LAYER: Record<FillKey, number> = { paving: 0, terrace: 1, pool: 2, day: 3, night: 3, service: 3, circulation: 3, garage: 3 };

/** Centre and size of the largest free cell of `rect` minus `cut` (largest smaller side first, then area); house frame. */
function freeCell(rect: Rect, cut: readonly Rect[]): { at: Pt; w: number; h: number } {
  const cells = differenceOf([rect], cut.map((c) => clipRect(c, rect)).filter((c): c is Rect => c !== null));
  // merge cells of the compressed grid row by row into maximal rectangles along x, then pick the best one
  let best: Rect = rect, score = -Infinity;
  const rows = new Map<string, Rect[]>();
  for (const c of cells) {
    const k = `${c[1]}|${c[3]}`;
    rows.set(k, [...(rows.get(k) ?? []), c]);
  }
  const runs: Rect[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a[0] - b[0]);
    let cur = row[0];
    for (const c of row.slice(1)) cur = Math.abs(c[0] - cur[2]) < 1e-9 ? [cur[0], cur[1], c[2], cur[3]] : (runs.push(cur), c);
    runs.push(cur);
  }
  // grow each run up and down while the rows above and below cover it
  const covers = (y0: number, y1: number, x0: number, x1: number) =>
    runs.some((q) => Math.abs(q[1] - y0) < 1e-9 && Math.abs(q[3] - y1) < 1e-9 && q[0] <= x0 + 1e-9 && q[2] >= x1 - 1e-9);
  for (const r0 of runs) {
    const [x0, , x1] = r0;
    let [, y0, , y1] = r0;
    for (let grown = true; grown;) {
      grown = false;
      const below = runs.find((q) => Math.abs(q[3] - y0) < 1e-9 && covers(q[1], q[3], x0, x1));
      if (below) { y0 = below[1]; grown = true; }
      const above = runs.find((q) => Math.abs(q[1] - y1) < 1e-9 && covers(q[1], q[3], x0, x1));
      if (above) { y1 = above[3]; grown = true; }
    }
    const w = x1 - x0, h = y1 - y0, s = Math.min(w, h) * 1000 + w * h;
    if (s > score) { score = s; best = [x0, y0, x1, y1]; }
  }
  return { at: [(best[0] + best[2]) / 2, (best[1] + best[3]) / 2], w: best[2] - best[0], h: best[3] - best[1] };
}

export function buildPlanDrawing(d: Derived, opts: PlanOptions = {}): PlanDrawing {
  const { furniture = true, outdoorReach = 1.8, margin = 1.6, garden = false } = opts;
  const ob = d.outline.bbox as BBox;
  const wallOf = new Map(d.walls.map((w) => [w.id, w]));

  // openings: symbols and the gaps they cut
  const placed = d.openings.filter((o) => o.problem === null && o.wallId !== null && wallOf.has(o.wallId));
  const gaps = placed.map((o) => gapRect(o, wallOf.get(o.wallId!)!));
  const openings = placed.map((o) => openingOf(o, wallOf.get(o.wallId!)!));

  // outdoor areas: covered ones (and with `garden` the pools and their decks) whole, the others only near the house
  const whole = (o: DerivedOutdoor) => o.covered || (garden && (o.pool !== null || o.holes.length > 0));
  const house: Rect = [ob.x0, ob.y0, ob.x1, ob.y1];
  const core = garden ? d.outdoor.filter(whole).reduce<Rect>((b, o) => union2(b, o.pool?.outer ?? o.rect), house) : house;
  const reach: Rect = [core[0] - outdoorReach, core[1] - outdoorReach, core[2] + outdoorReach, core[3] + outdoorReach];
  const drawn: { o: DerivedOutdoor; r: Rect }[] = [];
  let content: Rect = [ob.x0, ob.y0, ob.x1, ob.y1];
  for (const o of d.outdoor) {
    const r = whole(o) ? (o.pool?.outer ?? o.rect) : clipRect(o.rect, reach);
    if (!r) continue;
    // a pool is drawn whole or not at all (half a basin reads as an error)
    if (o.pool && !whole(o) && (r[0] !== o.rect[0] || r[1] !== o.rect[1] || r[2] !== o.rect[2] || r[3] !== o.rect[3])) continue;
    content = union2(content, r);
    drawn.push({ o, r });
  }
  drawn.sort((a, b) => OUTDOOR_LAYER[outdoorFill(a.o)] - OUTDOOR_LAYER[outdoorFill(b.o)]);
  const blocked = [...d.outline.rects, ...d.furniture.map((f) => f.rect)];
  const outdoor: PlanOutdoor[] = drawn.map(({ o, r }, i) => {
    const holes = o.holes.map((h) => clipRect(h, r)).filter((h): h is Rect => h !== null);
    // what lies on top of this area (drawn later), the house and the furniture cannot carry its name
    const over = drawn.slice(i + 1).map((q) => q.r);
    const free = freeCell(o.pool ? o.pool.water : r, o.pool ? [] : [...holes, ...over, ...blocked]);
    return {
      id: o.id, type: o.type, name: o.name, role: o.role, fill: outdoorFill(o), covered: o.covered, rect: planRect(r),
      area: mm((r[2] - r[0]) * (r[3] - r[1])), cut: !whole(o) && (r[0] !== o.rect[0] || r[1] !== o.rect[1] || r[2] !== o.rect[2] || r[3] !== o.rect[3]),
      posts: o.posts.map(([x, y]) => P(x, y)), postSize: o.postSize,
      holes: holes.map(planRect),
      pool: o.pool ? { water: planRect(o.pool.water), outer: planRect(o.pool.outer) } : null,
      label: { at: P(free.at[0], free.at[1]), w: mm(free.w), h: mm(free.h) },
    };
  });
  const frame: Rect = [content[0] - margin, content[1] - margin, content[2] + margin, content[3] + margin];

  // overall dimensions: width below the footprint, depth on its east side
  const wy = ob.y0 - DIM_OFFSET, ex = ob.x1 + DIM_OFFSET;
  const dimensions: PlanDimension[] = [
    {
      axis: "width", line: [P(ob.x0, wy), P(ob.x1, wy)], value: mm(ob.x1 - ob.x0), text: P((ob.x0 + ob.x1) / 2, wy),
      ext: [[P(ob.x0, ob.y0), P(ob.x0, wy - DIM_OVERSHOOT)], [P(ob.x1, ob.y0), P(ob.x1, wy - DIM_OVERSHOOT)]],
    },
    {
      axis: "depth", line: [P(ex, ob.y0), P(ex, ob.y1)], value: mm(ob.y1 - ob.y0), text: P(ex, (ob.y0 + ob.y1) / 2),
      ext: [[P(ob.x1, ob.y0), P(ex + DIM_OVERSHOOT, ob.y0)], [P(ob.x1, ob.y1), P(ex + DIM_OVERSHOOT, ob.y1)]],
    },
  ];
  const fr = planRect(frame);
  return {
    viewBox: { x: fr[0], y: fr[1], w: mm(fr[2] - fr[0]), h: mm(fr[3] - fr[1]) },
    bearingDeg: d.houseAxisBearingDeg,
    outline: d.outline.polygons.map((p) => planRing(p.pts)),
    rooms: roomsOf(d),
    walls: wallLayers(d, gaps),
    openings,
    outdoor,
    furniture: furniture ? furnitureOf(d) : [],
    screens: d.screens.map((s) => (s.orient === "v" ? { a: P(s.at, s.from), b: P(s.at, s.to) } : { a: P(s.from, s.at), b: P(s.to, s.at) })),
    lightpipes: d.lightpipes.map((l) => ({ at: P(l.x, l.y), r: mm(l.diameter / 2) })),
    dimensions,
    north: { at: P(frame[2] - 0.8, frame[3] - 0.8), angleDeg: -d.houseAxisBearingDeg },
    scale: { at: P(frame[0] + 0.7, frame[1] + 0.55), length: SCALE_BAR },
  };
}
