// derive(house): the only place that turns the house/1 model into geometry. Pure and deterministic (no DOM, no I/O).
// Output: walls, net rooms, outline, openings with orientation, roof faces, outdoor areas, access graph, PV layout...
// `generated/derived.json` is this object (a superset of the concept/1 derived format).
import {
  AZ_KEYS,
  DERIVED_SCHEMA_VERSION,
  DIRS,
  DIR_AZIMUTH,
  FURNITURE,
  UNHEATED_TYPES,
  type Dir,
} from "./catalog";
import {
  R5,
  bboxOf,
  expandRect,
  facing8,
  furnitureRect,
  inRect,
  round,
  distToSegment,
  trueAzimuth,
  unionOf,
  type Pt,
  type Rect,
} from "./geom";
import { clearEnds, derivePlan, locateOnWall } from "./plan";
import { poleOfInaccessibility } from "./polylabel";
import { layoutPv } from "./pv";
import { buildRoofFaces, roofSurfaceAt, type RoofInput } from "./roofs";
import type {
  Assembly,
  Derived,
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

/** Is the house-frame azimuth within the (clockwise) range from -> to? */
export const azimuthInRange = (az: number, from: number, to: number): boolean => {
  const a = ((az % 360) + 360) % 360;
  const f = ((from % 360) + 360) % 360;
  const t = ((to % 360) + 360) % 360;
  return f <= t ? a >= f && a <= t : a >= f || a <= t;
};

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
  const walls: DerivedWall[] = plan.walls.map((w) => {
    if (!w.ext) return w;
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
        if (roofAbove) o.overhang = { depth: roofAbove.overhang, eaveHeight: roofAbove.eaveHeight, wallTop: roofAbove.wallTop };
        const room = roomIn.get(o.room);
        o.blind =
          glazingArea > 0 &&
          (blinds.kinds as string[]).includes(op.kind) &&
          !!room &&
          heatedOf(room.type) &&
          azimuthInRange(o.azimuthTrue, blinds.azimuthFrom, blinds.azimuthTo);
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

  // --- outdoor, screens, light pipes, furniture
  const outdoor: DerivedOutdoor[] = house.outdoor.map((o) => ({
    id: o.id,
    type: o.type,
    covered: o.covered ?? false,
    rect: o.rect,
    area: R5((o.rect[2] - o.rect[0]) * (o.rect[3] - o.rect[1])),
    posts: o.posts ?? [],
    zone: "outdoor",
  }));
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
    return { id: s.id, type: s.type, orient: s.orient, at, from, to, length: R5(Math.abs(to - from)), azimuth: az, azimuthTrue: azT, facing: facing8(azT) };
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
  const eaveRects = roofs.map((r) => r.eaveRect);
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
  };
}
