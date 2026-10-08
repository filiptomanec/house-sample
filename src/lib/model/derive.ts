// derive(house): the only place that turns the house/1 model into geometry. Pure and deterministic (no DOM, no I/O).
// Output: walls, net rooms, outline, openings with orientation, roof faces, outdoor areas, access graph, PV layout...
// `generated/derived.json` is this object (a superset of the concept/1 derived format).
import {
  AZ_KEYS,
  BEDROOM_TYPES,
  DEFAULT_OUTDOOR_TOP,
  DERIVED_SCHEMA_VERSION,
  DIRS,
  DIR_AZIMUTH,
  DISPLAY_FLOOR,
  FURNITURE,
  GROUND_VOID_OUTDOOR,
  LOUVRE_OPEN_DEG,
  POOL_SURROUND_TYPES,
  SUN_SAMPLED_OUTDOOR,
  UNHEATED_TYPES,
  WATER_OUTDOOR,
  type Dir,
  type OutdoorSurface,
} from "./catalog";
import {
  R5,
  bboxOf,
  expandRect,
  facing8,
  furnitureRect,
  inRect,
  rectArea,
  rectInter,
  round,
  distToSegment,
  trueAzimuth,
  unionOf,
  type Pt,
  type Pt3,
  type Rect,
} from "./geom";
import { clearEnds, derivePlan, locateOnWall } from "./plan";
import { poleOfInaccessibility } from "./polylabel";
import { layoutPv } from "./pv";
import { buildRoofFaces, roofSurfaceAt, type RoofInput } from "./roofs";
import { exportSiteLayout } from "./site/export";
import { gradeOutdoor, type OutdoorGrade } from "./site/grading";
import { accessGeometry } from "./site/layout";
import type { SiteModel } from "./site/siteSchema";
import { createTerrain, type Terrain } from "./site/terrain";
import type {
  Assembly,
  Derived,
  DerivedCamera,
  DerivedPool,
  OutdoorRole,
  DerivedAccent,
  DerivedAccess,
  DerivedAssembly,
  DerivedBBox,
  DerivedFacing,
  DerivedFurniture,
  DerivedLightpipe,
  DerivedOpening,
  DerivedOutdoor,
  DerivedRoof,
  DerivedRoom,
  DerivedScreen,
  DerivedWall,
  Glazing,
  House,
  RoofFace,
} from "./types";

export interface DeriveOptions {
  /** Hash of model/*.json to store in the output (see hash.ts). */
  inputHash?: string | null;
  /**
   * The plot (site.json, parsed or at least schema-valid). With it the drive and path become ramps to their gates, cameras
   * with `aboveGround` get their absolute z and `derived.site` holds the resolved plot. Without it every slab is flat,
   * camera z values are taken as given and `site` is null.
   */
  site?: SiteModel | null;
}

const DEG = Math.PI / 180;

/** Roof definitions with defaults resolved (overhang 0, wallTop = clear height + slab). */
export function roofInputs(house: House): RoofInput[] {
  const top = R5(house.clearHeight + house.slab);
  return house.roofs.map((r) => ({ id: r.id, rect: r.rect, pitch: r.pitch, overhang: r.overhang ?? 0, wallTop: r.wallTop ?? top }));
}

/** Thickness, resistance and U-value of an assembly (EN ISO 6946 simplified: no thermal-bridge correction). */
export function assemblyU(a: Assembly): DerivedAssembly {
  const vent = a.layers.findIndex((l) => l.ventilated);
  // layers outside a ventilated layer are ignored and Rse is replaced by Rsi
  const active = vent >= 0 ? a.layers.slice(vent + 1) : a.layers;
  const rse = vent >= 0 ? a.rsi : a.rse;
  const R = active.reduce((s, l) => s + (l.r ?? l.t / (l.lambda ?? Infinity)), 0);
  return {
    thickness: R5(a.layers.reduce((s, l) => s + l.t, 0)),
    R: round(R, 4),
    U: round(1 / (a.rsi + R + rse), 4),
  };
}

const inAnyRect = (rects: Rect[], x: number, y: number): boolean => rects.some((q) => inRect(q, x, y));

/**
 * Is the azimuth within the clockwise range from -> to? A range of 360 degrees or more (0 -> 360) contains every azimuth;
 * otherwise the ends are taken modulo 360, so 350 -> 10 wraps through north.
 */
export const azimuthInRange = (az: number, from: number, to: number): boolean => {
  if (to - from >= 360) return true;
  const a = ((az % 360) + 360) % 360;
  const f = ((from % 360) + 360) % 360;
  const t = ((to % 360) + 360) % 360;
  return f <= t ? a >= f && a <= t : a >= f || a <= t;
};

/** Rounds an angle up to the next multiple of 5 degrees (ceil5(14.48) = 15). */
export const ceil5 = (deg: number): number => Math.ceil(deg / 5 - 1e-9) * 5;

/** Closed stop of louvre blades turning about their centres: they touch at asin(thickness / pitch) from the wall plane. */
export const louvreClosedDeg = (thickness: number, pitch: number): number => (thickness >= pitch ? LOUVRE_OPEN_DEG : ceil5((Math.asin(thickness / pitch) * 180) / Math.PI));

/** Default finish and GLB role of an outdoor slab. */
export const outdoorSurface = (type: string, surface: OutdoorSurface | undefined): OutdoorSurface => surface ?? (type === "deck" ? "deck" : "paving");
export function outdoorRole(type: string, surface: OutdoorSurface): OutdoorRole {
  if ((WATER_OUTDOOR as readonly string[]).includes(type)) return "pool_coping";
  if (type === "drive") return "drive_paving";
  if (type === "path") return "path";
  return surface === "deck" ? "deck" : "terrace_paving";
}

/**
 * Distance from `start` along an axis-parallel unit direction until the point leaves the union of the rectangles (0 when
 * `start` is outside all of them). Exact: jumps from far edge to far edge.
 */
export function exitDistance(rects: readonly Rect[], start: Pt, dir: Pt): number {
  const alongX = Math.abs(dir[0]) > 0.5;
  const sgn = alongX ? Math.sign(dir[0]) : Math.sign(dir[1]);
  const across = alongX ? start[1] : start[0];
  const tol = 1e-9;
  let t = 0;
  for (let guard = 0; guard < 64; guard++) {
    const pos = (alongX ? start[0] : start[1]) + sgn * t;
    let far = -Infinity;
    for (const r of rects) {
      const [a0, a1] = alongX ? [r[0], r[2]] : [r[1], r[3]];
      const [c0, c1] = alongX ? [r[1], r[3]] : [r[0], r[2]];
      if (across < c0 - tol || across > c1 + tol) continue;
      const near = sgn > 0 ? a0 : -a1;
      const end = sgn > 0 ? a1 : -a0;
      const p = sgn * pos;
      if (near <= p + tol && end > p + tol) far = Math.max(far, end);
    }
    if (far === -Infinity) break;
    t = far - sgn * (alongX ? start[0] : start[1]);
  }
  return t;
}

export function derive(house: House, options: DeriveOptions = {}): Derived {
  const bearing = house.location.houseAxisBearingDeg;
  const defaultTop = R5(house.clearHeight + house.slab);
  const roofIn = roofInputs(house);
  const plan = derivePlan({ wall: house.wall, bearingAxes: house.bearingAxes, rooms: house.rooms });
  const roomIn = new Map(house.rooms.map((r) => [r.id, r]));
  const heatedOf = (type: string): boolean => !(UNHEATED_TYPES as readonly string[]).includes(type);

  // --- roofs and faces
  const faces: RoofFace[] = buildRoofFaces(roofIn, bearing);
  const roofs: DerivedRoof[] = roofIn.map((rf) => {
    const [x0, y0, x1, y1] = rf.rect;
    const w = x1 - x0;
    const d = y1 - y0;
    const s = Math.min(w, d);
    const L = Math.max(w, d);
    const tan = Math.tan(rf.pitch * DEG);
    const cos = Math.cos(rf.pitch * DEG);
    const o = rf.overhang;
    const alongX = w >= d;
    const ridge: [Pt, Pt] = alongX
      ? [[x0 + s / 2, (y0 + y1) / 2], [x1 - s / 2, (y0 + y1) / 2]]
      : [[(x0 + x1) / 2, y0 + s / 2], [(x0 + x1) / 2, y1 - s / 2]];
    const planExt = (w + 2 * o) * (d + 2 * o);
    return {
      id: rf.id,
      rect: [...rf.rect] as Rect,
      pitch: rf.pitch,
      overhang: o,
      wallTop: rf.wallTop,
      w: R5(w),
      d: R5(d),
      ridgeAlong: alongX ? "x" : "y",
      ridgeLength: R5(L - s),
      ridgeHeight: R5(rf.wallTop + (s / 2) * tan),
      ridgeRise: R5((s / 2) * tan),
      ridge: ridge.map((p) => p.map(R5) as Pt) as [Pt, Pt],
      eaveRect: expandRect(rf.rect, o).map(R5) as Rect,
      eaveHeight: R5(rf.wallTop - o * tan),
      planAreaWithOverhang: R5(planExt),
      slopedArea: R5(planExt / cos),
      faces: faces.filter((f) => f.roofId === rf.id).map((f) => f.id),
    };
  });
  const eaveRects = roofs.map((r) => r.eaveRect);
  const roofAt = (x: number, y: number): DerivedRoof | null => {
    let best: DerivedRoof | null = null;
    for (const r of roofs) if (inRect(expandRect(r.rect, 0.01), x, y) && (!best || r.wallTop > best.wallTop)) best = r;
    return best;
  };
  const wallTopAt = (x: number, y: number): number => {
    let top = -Infinity;
    for (const r of roofIn) if (inRect(expandRect(r.rect, 0.01), x, y)) top = Math.max(top, r.wallTop);
    return top === -Infinity ? defaultTop : top;
  };

  // --- walls with orientation and height
  const heatedRoom = new Map(house.rooms.map((r) => [r.id, heatedOf(r.type)]));
  const walls: DerivedWall[] = plan.walls.map((w) => {
    if (!w.ext) {
      const lo = w.lo ? heatedRoom.get(w.lo) : undefined, hi = w.hi ? heatedRoom.get(w.hi) : undefined;
      return lo !== undefined && hi !== undefined && lo !== hi ? { ...w, toUnheated: true } : w;
    }
    const mid = (w.from + w.to) / 2;
    const [x, y] = w.orient === "h" ? [mid, w.at] : [w.at, mid];
    const az = w.azimuth as number;
    const azT = trueAzimuth(az, bearing);
    return { ...w, azimuthTrue: azT, facing: facing8(azT), height: wallTopAt(x, y) };
  });
  const wallById = new Map(walls.map((w) => [w.id, w]));

  // --- openings
  const blinds = house.shading.blinds;
  const roomGlazing = new Map<string, Glazing>(house.rooms.map((r) => [r.id, { total: 0, N: 0, E: 0, S: 0, W: 0 }]));
  const roomOpenings = new Map<string, string[]>(house.rooms.map((r) => [r.id, []]));
  const openings: DerivedOpening[] = house.openings.map((op) => {
    const axis = op.orient === "h" ? op.cy : op.cx;
    const c = op.orient === "h" ? op.cx : op.cy;
    const loc = locateOnWall(walls, op.orient, axis, c, op.w);
    const glazingArea = op.kind === "window" || op.kind === "slider" ? R5(op.w * Math.max(0, op.head - op.sill)) : 0;
    const o: DerivedOpening = {
      id: op.id,
      kind: op.kind,
      orient: op.orient,
      cx: op.cx,
      cy: op.cy,
      w: op.w,
      sill: op.sill,
      head: op.head,
      swing: op.swing ?? null,
      hinge: op.hinge ?? null,
      c: R5(c),
      axis: R5(axis),
      from: R5(c - op.w / 2),
      to: R5(c + op.w / 2),
      wallId: loc.wall ? loc.wall.id : null,
      problem: loc.problem,
      exterior: loc.wall ? loc.wall.ext : null,
      wallKind: loc.wall ? loc.wall.kind : null,
      azimuth: null,
      room: null,
      connects: null,
      swingRoom: null,
      glazingArea,
      clearStart: null,
      clearEnd: null,
      azimuthTrue: null,
      facing: null,
      dir: null,
      area: R5(op.w * Math.max(0, op.head - op.sill)),
      center: [op.cx, op.cy, R5((op.sill + op.head) / 2)],
      blind: false,
      blindSections: 0,
      overhang: null,
    };
    if (loc.wall) {
      const wl = wallById.get(loc.wall.id)!;
      const ce = clearEnds(walls, wl, o.from, o.to);
      o.clearStart = ce.start;
      o.clearEnd = ce.end;
      if (wl.ext) {
        o.azimuth = wl.azimuth as number;
        o.room = wl.room as string;
        o.azimuthTrue = wl.azimuthTrue as number;
        o.facing = wl.facing as DerivedOpening["facing"];
        o.dir = AZ_KEYS[o.azimuth];
        const roofAbove = roofAt(op.cx, op.cy);
        if (roofAbove) {
          // march from the centre of the head on the outer wall face along the outward normal out of the roof plan
          const n: Pt = [Math.round(Math.sin((o.azimuth * Math.PI) / 180)), Math.round(Math.cos((o.azimuth * Math.PI) / 180))];
          const face: Pt = [op.cx + (n[0] * wl.t) / 2, op.cy + (n[1] * wl.t) / 2];
          const depth = exitDistance(eaveRects, face, n);
          const near: Pt = [face[0] + n[0] * Math.min(0.25, depth / 2), face[1] + n[1] * Math.min(0.25, depth / 2)];
          const overCovered = house.outdoor.some((od) => od.covered && inRect(od.rect, near[0], near[1]));
          const exit: Pt = [face[0] + n[0] * (depth - 1e-6), face[1] + n[1] * (depth - 1e-6)];
          const edge = roofSurfaceAt(faces, exit[0], exit[1]);
          const eaveHeight = overCovered ? house.clearHeight : edge ? edge.z : roofAbove.eaveHeight;
          o.overhang = { depth: R5(depth), eaveHeight: R5(eaveHeight), wallTop: roofAbove.wallTop };
        }
        const room = roomIn.get(o.room);
        o.blind =
          glazingArea > 0 &&
          (blinds.kinds as string[]).includes(op.kind) &&
          !!room &&
          heatedOf(room.type) &&
          azimuthInRange(o.azimuthTrue, blinds.azimuthFrom, blinds.azimuthTo);
        o.blindSections = o.blind ? Math.max(1, Math.ceil(op.w / blinds.product.maxSectionWidth - 1e-9)) : 0;
      } else {
        o.connects = [wl.lo, wl.hi];
      }
      if (op.swing === "+") o.swingRoom = wl.hi;
      else if (op.swing === "-") o.swingRoom = wl.lo;
      if (wl.ext) {
        const g = roomGlazing.get(o.room as string);
        roomOpenings.get(o.room as string)?.push(op.id);
        if (g && glazingArea > 0) {
          g.total += glazingArea;
          g[o.dir as Dir] += glazingArea;
        }
      } else {
        for (const rn of o.connects as [string | null, string | null]) if (rn) roomOpenings.get(rn)?.push(op.id);
      }
    }
    return o;
  });
  for (const g of roomGlazing.values()) for (const k of Object.keys(g) as (keyof Glazing)[]) g[k] = R5(g[k]);

  const accents: DerivedAccent[] = house.accents.map((a) => {
    const axis = a.orient === "h" ? a.cy : a.cx;
    const c = a.orient === "h" ? a.cx : a.cy;
    const loc = locateOnWall(walls, a.orient, axis, c, a.w);
    const wl = loc.wall ? wallById.get(loc.wall.id)! : null;
    const ext = wl?.ext ?? null;
    return {
      ...a,
      wallId: wl ? wl.id : null,
      exterior: ext,
      problem: loc.problem,
      azimuth: wl && wl.ext ? (wl.azimuth as number) : null,
      azimuthTrue: wl && wl.ext ? (wl.azimuthTrue as number) : null,
      facing: wl && wl.ext ? (wl.facing as DerivedAccent["facing"]) : null,
    };
  });

  // --- rooms
  const zoneOf = (type: string): "day" | "night" | "service" => {
    for (const z of ["day", "night", "service"] as const) if ((house.zones[z].types as string[]).includes(type)) return z;
    return "service";
  };
  const outlinePolys = plan.outline.polygons;
  const outlineRings = outlinePolys.map((p) => p.pts);
  const rooms: DerivedRoom[] = plan.rooms.map((r) => {
    const src = roomIn.get(r.id)!;
    const un = unionOf(r.cleanRects);
    const outer = un.polygons.filter((p) => p.area > 0).sort((a, b) => b.area - a.area)[0];
    const holes = un.polygons.filter((p) => p.area < 0).map((p) => p.pts);
    const label = outer ? poleOfInaccessibility([outer.pts, ...holes], 0.005) : { x: 0, y: 0, r: 0 };
    let cxs = 0;
    let cys = 0;
    for (const q of r.cleanRects) {
      const a = (q[2] - q[0]) * (q[3] - q[1]);
      cxs += ((q[0] + q[2]) / 2) * a;
      cys += ((q[1] + q[3]) / 2) * a;
    }
    const centroid: Pt = r.area > 0 ? [R5(cxs / r.area), R5(cys / r.area)] : [0, 0];
    const extWalls = walls.filter((w) => w.ext && w.room === r.id);
    let outlineDistance = Infinity;
    for (const ring of outlineRings) {
      for (let i = 0; i < ring.length; i++) outlineDistance = Math.min(outlineDistance, distToSegment([label.x, label.y], ring[i], ring[(i + 1) % ring.length]));
    }
    const room: DerivedRoom = {
      id: r.id,
      name: src.name,
      shortName: src.shortName ?? null,
      displayNo: "",
      type: src.type,
      zone: zoneOf(src.type),
      heated: heatedOf(src.type),
      rects: r.rects,
      cleanRects: r.cleanRects,
      area: r.area,
      axisArea: r.axisArea,
      bbox: r.bbox,
      rectsClear: r.rectsClear,
      minWidth: r.minWidth,
      mainClear: r.mainClear,
      glazing: roomGlazing.get(r.id)!,
      openings: roomOpenings.get(r.id)!,
      height: house.clearHeight,
      volume: round(r.area * house.clearHeight, 4),
      label: { x: round(label.x, 3), y: round(label.y, 3), r: round(label.r, 3) },
      outlineDistance: Number.isFinite(outlineDistance) ? round(outlineDistance, 3) : 0,
      centroid,
      exteriorWallLength: R5(extWalls.reduce((s, w) => s + w.len, 0)),
      exteriorWallArea: R5(extWalls.reduce((s, w) => s + w.len * (w.height ?? defaultTop), 0)),
    };
    if (src.role) room.role = src.role;
    if (src.floor) room.floor = src.floor;
    return room;
  });
  const roomAt = (x: number, y: number): string | null => rooms.find((r) => inAnyRect(r.cleanRects, x, y))?.id ?? null;

  // --- levels: the site grades the slabs (drive and path ramp to their gates), else every slab is flat at its top
  const site = options.site ?? null;
  let terrain: Terrain | null = null;
  let grades: OutdoorGrade[];
  if (site) {
    const base = createTerrain(site.terrain, bearing);
    const grading = gradeOutdoor(house.outdoor, base.baseAt, accessGeometry(site, house.outdoor));
    terrain = createTerrain(site.terrain, bearing, grading.slabs);
    grades = grading.grades;
  } else {
    grades = gradeOutdoor(house.outdoor, () => 0).grades;
  }
  const roundGrade = (g: OutdoorGrade): OutdoorGrade => ({
    ...g,
    corners: g.corners.map(R5),
    plane: { z0: R5(g.plane.z0), ox: g.plane.ox, oy: g.plane.oy, gx: g.plane.gx, gy: round(g.plane.gy, 9) },
    ramp: g.ramp
      ? {
          ...g.ramp,
          z1: R5(g.ramp.z1),
          slope: round(g.ramp.slope, 9),
          groundAtGate: R5(g.ramp.groundAtGate),
          gate: g.ramp.gate.map(R5) as Pt,
          apron: g.ramp.apron ? { polygon: g.ramp.apron.polygon.map((p) => p.map(R5) as Pt), z: g.ramp.apron.z.map(R5) } : null,
        }
      : null,
  });

  // --- outdoor areas, pools
  const isWater = (type: string): boolean => (WATER_OUTDOOR as readonly string[]).includes(type);
  const poolOuter = (o: (typeof house.outdoor)[number]): Rect => expandRect(o.rect, o.coping ?? 0).map(R5) as Rect;
  const pools = house.outdoor.filter((o) => isWater(o.type));
  const ringOf = (q: Rect): Pt[] => [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]];
  const outdoor: DerivedOutdoor[] = house.outdoor.map((o, i) => {
    const area = R5((o.rect[2] - o.rect[0]) * (o.rect[3] - o.rect[1]));
    const holes: Rect[] = isWater(o.type) ? [] : pools.map((p) => rectInter(poolOuter(p), o.rect)).filter((q): q is Rect => !!q && rectArea(q) > 1e-9);
    const surface = outdoorSurface(o.type, o.surface);
    const top = o.top ?? DEFAULT_OUTDOOR_TOP;
    let pool: DerivedPool | null = null;
    if (isWater(o.type)) {
      const depth = o.depth ?? 0, below = o.waterBelowTop ?? 0, coping = o.coping ?? 0;
      const outer = poolOuter(o);
      const deck = house.outdoor.find((d) => POOL_SURROUND_TYPES.includes(d.type) && inRect(expandRect(d.rect, 1e-6), outer[0], outer[1]) && inRect(expandRect(d.rect, 1e-6), outer[2], outer[3]));
      pool = {
        water: [...o.rect] as Rect,
        depth,
        waterBelowTop: below,
        coping,
        copingTop: top,
        waterZ: R5(top - below),
        floorZ: R5(top - depth),
        outer,
        polygons: { water: ringOf(o.rect), copingOuter: ringOf(outer), copingInner: ringOf(o.rect), deck: deck ? { outer: ringOf(deck.rect), hole: ringOf(outer) } : null },
        deck: deck ? deck.id : null,
        waterArea: area,
        waterVolume: R5(area * Math.max(0, depth - below)),
      };
    }
    return {
      id: o.id,
      type: o.type,
      name: o.name ?? null,
      covered: o.covered ?? false,
      rect: o.rect,
      area,
      netArea: R5(area - holes.reduce((s, q) => s + rectArea(q), 0)),
      holes,
      posts: o.posts ?? [],
      postSize: o.posts?.length ? (o.postSize ?? null) : null,
      zone: "outdoor",
      surface,
      role: outdoorRole(o.type, surface),
      top,
      grade: roundGrade(grades[i]),
      pool,
    };
  });
  const groundVoids: Rect[] = house.outdoor.filter((o) => (GROUND_VOID_OUTDOOR as readonly string[]).includes(o.type)).map((o) => poolOuter(o));

  // --- louvre walls: blades spread evenly, the closed stop where neighbouring blades touch
  const slats = house.shading.slats;
  const closedDeg = louvreClosedDeg(slats.width, slats.pitch);
  const slabTopAt = (x: number, y: number): number => {
    const i = house.outdoor.findIndex((o) => inRect(expandRect(o.rect, 0.01), x, y));
    if (i < 0) return 0;
    const g = grades[i];
    return R5(g.plane.z0 + g.plane.gx * (x - g.plane.ox) + g.plane.gy * (y - g.plane.oy));
  };
  const hb = plan.outline.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, d: 0 };
  const hc: Pt = [(hb.x0 + hb.x1) / 2, (hb.y0 + hb.y1) / 2];
  const screens: DerivedScreen[] = house.screens.map((s) => {
    const vertical = s.orient === "v";
    const at = vertical ? (s as { cx: number }).cx : (s as { cy: number }).cy;
    const from = vertical ? (s as { y0: number }).y0 : (s as { x0: number }).x0;
    const to = vertical ? (s as { y1: number }).y1 : (s as { x1: number }).x1;
    // outward = away from the centre of the house
    const az = vertical ? (at < hc[0] ? 270 : 90) : at < hc[1] ? 180 : 0;
    const azT = trueAzimuth(az, bearing);
    const length = Math.abs(to - from);
    const count = Math.max(1, Math.floor(length / slats.pitch + 1e-6));
    const pitch = length / count;
    const lo = Math.min(from, to);
    const mid = (from + to) / 2;
    return {
      id: s.id, type: s.type, orient: s.orient, at, from, to, length: R5(length), azimuth: az, azimuthTrue: azT, facing: facing8(azT),
      blades: { count, pitch: R5(pitch), chord: slats.depth, thickness: slats.width, positions: Array.from({ length: count }, (_, k) => R5(lo + (k + 0.5) * pitch)) },
      closedDeg,
      openDeg: LOUVRE_OPEN_DEG,
      restDeg: slats.restDeg,
      z0: vertical ? slabTopAt(at, mid) : slabTopAt(mid, at),
      z1: house.clearHeight,
    };
  });
  const lpDiameter = house.roof.lightpipes.diameter;
  const lightpipes: DerivedLightpipe[] = house.lightpipes.map(([x, y]) => {
    const hit = roofSurfaceAt(faces, x, y);
    return { x, y, diameter: lpDiameter, room: roomAt(x, y), face: hit ? hit.face.id : null, z: hit ? round(hit.z, 4) : null };
  });
  const furniture: DerivedFurniture[] = house.furniture.map((f, index) => {
    const fr = furnitureRect(f, FURNITURE);
    const room = roomAt(f.x, f.y);
    const od = room ? null : (outdoor.find((o) => inRect(o.rect, f.x, f.y))?.id ?? null);
    return { index, type: f.type, x: f.x, y: f.y, rot: f.rot, w: fr.w, d: fr.d, rect: fr.rect, room, outdoor: od };
  });

  // --- access graph: doors between rooms, depth from the main entrance
  const entry = openings.find((o) => o.kind === "entry" && o.room);
  const edges: DerivedAccess["edges"] = [];
  const adj = new Map<string, string[]>(rooms.map((r) => [r.id, []]));
  for (const o of openings) {
    if (o.kind !== "door" || !o.connects || !o.connects[0] || !o.connects[1]) continue;
    edges.push({ a: o.connects[0], b: o.connects[1], opening: o.id });
    adj.get(o.connects[0])?.push(o.connects[1]);
    adj.get(o.connects[1])?.push(o.connects[0]);
  }
  const depth: Record<string, number> = {};
  if (entry && entry.room) {
    depth[entry.room] = 0;
    const queue = [entry.room];
    while (queue.length) {
      const a = queue.shift()!;
      for (const b of adj.get(a) ?? []) {
        if (depth[b] === undefined) {
          depth[b] = depth[a] + 1;
          queue.push(b);
        }
      }
    }
  }
  const access: DerivedAccess = {
    entryOpening: entry ? entry.id : null,
    entryRoom: entry ? entry.room : null,
    edges,
    depth,
    unreachable: rooms.filter((r) => depth[r.id] === undefined).map((r) => r.id),
  };
  // display numbers: breadth-first from the entry room, neighbours in the order of their doors; the rest in model order
  const order: string[] = [];
  if (entry && entry.room) {
    const seen = new Set([entry.room]);
    const queue = [entry.room];
    while (queue.length) {
      const a = queue.shift()!;
      order.push(a);
      for (const b of adj.get(a) ?? []) if (!seen.has(b)) { seen.add(b); queue.push(b); }
    }
  }
  for (const r of rooms) if (!order.includes(r.id)) order.push(r.id);
  for (const r of rooms) r.displayNo = `${DISPLAY_FLOOR}.${String(order.indexOf(r.id) + 1).padStart(2, "0")}`;

  // --- heat-pump outdoor unit on the ground
  const unit = house.equipment.heating.outdoorUnit;
  const outdoorUnit: Derived["outdoorUnit"] = unit
    ? (() => {
        const [w, dd] = unit.rot % 180 === 0 ? [unit.size[0], unit.size[1]] : [unit.size[1], unit.size[0]];
        const [x, y] = unit.pos;
        const footprint: Pt[] = [[x - w / 2, y - dd / 2], [x + w / 2, y - dd / 2], [x + w / 2, y + dd / 2], [x - w / 2, y + dd / 2]].map((p) => p.map(R5) as Pt);
        return { center: [x, y] as Pt, size: [...unit.size] as Pt3, rot: unit.rot, footprint, z: terrain ? R5(Math.min(...footprint.map((p) => terrain!.groundAt(p[0], p[1])))) : null };
      })()
    : null;

  // --- cameras: eye height above the graded ground when the site is known
  const cameras: DerivedCamera[] = house.cameras.map((c) => {
    const ground = terrain ? R5(terrain.groundAt(c.position[0], c.position[1])) : null;
    const z = c.aboveGround !== undefined && ground !== null ? R5(ground + c.aboveGround) : c.position[2];
    return {
      id: c.id, name: c.name, short: c.short ?? null, kind: c.kind,
      position: [c.position[0], c.position[1], z] as Pt3, target: [...c.target] as Pt3,
      fov: c.fov ?? null, orthoHeight: c.orthoHeight ?? null, use: [...c.use], default: c.default ?? false, defaultFor: [...(c.defaultFor ?? [])],
      aboveGround: c.aboveGround ?? null, ground,
    };
  });

  // --- facings (the four house-frame directions)
  const facings = {} as Record<Dir, DerivedFacing>;
  for (const dir of DIRS) {
    const az = DIR_AZIMUTH[dir];
    const azT = trueAzimuth(az, bearing);
    const ew = walls.filter((w) => w.ext && w.azimuth === az);
    const ops = openings.filter((o) => o.exterior && o.dir === dir);
    facings[dir] = {
      dir,
      houseAzimuthDeg: az,
      azimuthDeg: azT,
      facing: facing8(azT),
      wallLength: R5(ew.reduce((s, w) => s + w.len, 0)),
      wallArea: R5(ew.reduce((s, w) => s + w.len * (w.height ?? defaultTop), 0)),
      glazingArea: R5(ops.reduce((s, o) => s + o.glazingArea, 0)),
      doorArea: R5(ops.filter((o) => o.glazingArea === 0).reduce((s, o) => s + o.area, 0)),
      blindedGlazingArea: R5(ops.filter((o) => o.blind).reduce((s, o) => s + o.glazingArea, 0)),
      roofArea: round(faces.filter((f) => f.side === dir).reduce((s, f) => s + f.area, 0), 4),
    };
  }

  // --- assemblies
  const assemblies: Record<string, DerivedAssembly> = {};
  for (const [key, a] of Object.entries(house.assemblies)) assemblies[key] = assemblyU(a);

  // --- PV
  const pv = layoutPv(
    faces,
    house.equipment.pv,
    house.lightpipes.map(([x, y]) => ({ x, y, radius: lpDiameter / 2 })),
  );

  // --- bounding box of the building (outline, roof eaves, ridge)
  const bb = bboxOf([...(plan.outline.bbox ? [[hb.x0, hb.y0, hb.x1, hb.y1] as Rect] : []), ...eaveRects]);
  const zTop = faces.length ? Math.max(...faces.map((f) => f.zMax)) : defaultTop;
  const bbox: DerivedBBox = bb
    ? { ...bb, z0: 0, z1: round(zTop, 4), h: round(zTop, 4) }
    : { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, d: 0, z0: 0, z1: 0, h: 0 };

  const outerPoly = outlinePolys.filter((p) => p.area > 0).sort((a, b) => b.area - a.area)[0];

  return {
    schemaVersion: DERIVED_SCHEMA_VERSION,
    inputHash: options.inputHash ?? null,
    houseId: house.id,
    houseAxisBearingDeg: bearing,
    wall: { ...house.wall },
    defaultWallTop: defaultTop,
    grid: plan.grid,
    overlaps: plan.overlaps,
    holes: plan.holes,
    components: plan.components,
    walls,
    rooms,
    netRooms: rooms.map((r) => ({ id: r.id, type: r.type, ...(r.floor ? { floor: r.floor } : {}), heated: r.heated, rects: r.cleanRects, area: r.area })),
    outer: outerPoly ? { pts: outerPoly.pts, area: R5(outerPoly.area) } : null,
    outline: plan.outline,
    bbox,
    openings,
    accents,
    roofs,
    roofPlanes: faces,
    outdoor,
    screens,
    lightpipes,
    furniture,
    access,
    facings,
    assemblies,
    pv,
    attic: house.roof.attic,
    topEnvelope: house.roof.attic === "cold" ? "ceiling" : "roof",
    cameras,
    groundVoids,
    outdoorUnit,
    catalog: {
      groundVoidOutdoor: [...GROUND_VOID_OUTDOOR],
      sunSampledOutdoor: [...SUN_SAMPLED_OUTDOOR],
      waterOutdoor: [...WATER_OUTDOOR],
      bedroomTypes: [...BEDROOM_TYPES],
    },
    site: site && terrain ? exportSiteLayout(site, house.outdoor, bearing, { terrain }) : null,
  };
}
