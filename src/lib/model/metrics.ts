// Metrics of the house computed from the derived geometry. Roof areas and the enclosed volume are exact (integrals
// over the planar roof faces), not sampled.
import { PV_EFFICIENCY_ESTIMATE, PV_ROOF_USABLE_SHARE, type Dir, type OutdoorType, type RoomType } from "./catalog";
import { ringArea, ringCentroid } from "./geom";
import { clipRingToRect, faceZAt } from "./roofs";
import type { Derived, Glazing, House, Metrics } from "./types";

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
const DEG = Math.PI / 180;

interface RoofIntegrals {
  /** Sloped area of the whole roof surface (with overhangs). */
  roofArea: number;
  byDir: Record<Dir, number>;
  /** Over the footprint of the house only. */
  roofAreaOverFootprint: number;
  volume: number;
  volumeRoof: number;
  wallTopAvg: number;
}

/** Exact integrals of the roof surface over the house outline. */
export function roofIntegrals(derived: Derived): RoofIntegrals {
  const faces = derived.roofPlanes;
  const wallTopOf = new Map(derived.roofs.map((r) => [r.id, r.wallTop]));
  const byDir: Record<Dir, number> = { N: 0, E: 0, S: 0, W: 0 };
  let roofArea = 0;
  let over = 0;
  let vol = 0;
  let volRoof = 0;
  let wtSum = 0;
  let covered = 0;
  for (const f of faces) {
    roofArea += f.area;
    byDir[f.side] += f.area;
    const cos = Math.cos(f.pitch * DEG);
    const wt = wallTopOf.get(f.roofId) ?? derived.defaultWallTop;
    for (const rect of derived.outline.rects) {
      const ring = clipRingToRect(f.pts, rect);
      if (!ring) continue;
      const a = Math.abs(ringArea(ring));
      if (a < 1e-12) continue;
      const [cx, cy] = ringCentroid(ring);
      const z = faceZAt(f, cx, cy);
      covered += a;
      over += a / cos;
      vol += a * z;
      volRoof += a * (z - wt);
      wtSum += a * wt;
    }
  }
  // any part of the outline without a roof counts as flat at the default wall top
  const rest = Math.max(0, derived.outline.area - covered);
  over += rest;
  vol += rest * derived.defaultWallTop;
  wtSum += rest * derived.defaultWallTop;
  const area = derived.outline.area;
  return { roofArea, byDir, roofAreaOverFootprint: over, volume: vol, volumeRoof: volRoof, wallTopAvg: area > 0 ? wtSum / area : derived.defaultWallTop };
}

export function computeMetrics(house: House, derived: Derived): Metrics {
  const rooms = derived.rooms;
  const net = sum(rooms.filter((r) => r.heated).map((r) => r.area));
  const garage = sum(rooms.filter((r) => r.type === "garage").map((r) => r.area));
  const byType: Partial<Record<RoomType, number>> = {};
  for (const r of rooms) byType[r.type] = (byType[r.type] ?? 0) + r.area;
  for (const k of Object.keys(byType) as RoomType[]) byType[k] = r2(byType[k] as number);
  const ob = derived.outline.bbox ?? { w: 0, d: 0 };
  const ri = roofIntegrals(derived);

  const terraces = derived.outdoor.filter((o) => o.type === "terrace");
  const outdoorByType: Partial<Record<OutdoorType, number>> = {};
  for (const o of derived.outdoor) outdoorByType[o.type] = r2((outdoorByType[o.type] ?? 0) + o.area);

  const gl: Glazing = { total: 0, N: 0, E: 0, S: 0, W: 0 };
  for (const o of derived.openings) {
    if (!o.glazingArea || o.exterior !== true) continue;
    gl.total += o.glazingArea;
    if (o.dir) gl[o.dir] += o.glazingArea;
  }
  for (const k of Object.keys(gl) as (keyof Glazing)[]) gl[k] = r2(gl[k]);

  const envWalls = derived.outline.perimeter * ri.wallTopAvg;
  const envelope = envWalls + ri.roofAreaOverFootprint + derived.outline.area;
  const ridges = derived.roofs.map((r) => ({ id: r.id, height: r2(r.ridgeHeight), length: r2(r.ridgeLength) }));
  const southRoof = ri.byDir.S;

  // heated envelope: gross wall area of the heated rooms minus their openings
  const heatedRooms = rooms.filter((r) => r.heated);
  const heatedIds = new Set(heatedRooms.map((r) => r.id));
  const wallGross = sum(heatedRooms.map((r) => r.exteriorWallArea));
  const heatedOps = derived.openings.filter((o) => o.exterior === true && o.room && heatedIds.has(o.room));
  const glazingHeated = sum(heatedOps.map((o) => o.glazingArea));
  const doorsHeated = sum(heatedOps.filter((o) => o.glazingArea === 0).map((o) => o.area));

  return {
    id: house.id,
    name: house.name,
    netArea: r2(net),
    garageArea: r2(garage),
    areaByType: byType,
    roomCount: rooms.length,
    footprintArea: r2(derived.outline.area),
    footprintBBox: { w: r2(ob.w), d: r2(ob.d) },
    footprintPerimeter: r2(derived.outline.perimeter),
    volume: r1(ri.volume),
    volumeWalls: r1(ri.volume - ri.volumeRoof),
    volumeRoof: r1(ri.volumeRoof),
    roofArea: r1(ri.roofArea),
    roofAreaOverFootprint: r1(ri.roofAreaOverFootprint),
    ridges,
    ridgeMax: ridges.length ? Math.max(...ridges.map((r) => r.height)) : null,
    terraceCovered: r2(sum(terraces.filter((o) => o.covered).map((o) => o.area))),
    terraceUncovered: r2(sum(terraces.filter((o) => !o.covered).map((o) => o.area))),
    outdoorByType,
    glazing: gl,
    glazingRatio: net > 0 ? r2(gl.total / net) : null,
    envelopeArea: r1(envelope),
    envelopeToVolume: ri.volume > 0 ? r2(envelope / ri.volume) : null,
    roofSouthArea: r1(southRoof),
    roofAreaByAzimuth: { N: r1(ri.byDir.N), E: r1(ri.byDir.E), S: r1(ri.byDir.S), W: r1(ri.byDir.W) },
    pvKwp: r1(southRoof * PV_EFFICIENCY_ESTIMATE * PV_ROOF_USABLE_SHARE),
    pvLayoutKwp: r2(derived.pv.kwp),
    pvModuleCount: derived.pv.count,
    heated: {
      floorArea: r2(net),
      volume: r1(sum(heatedRooms.map((r) => r.volume))),
      perimeter: r2(sum(heatedRooms.map((r) => r.exteriorWallLength))),
      wallGross: r2(wallGross),
      glazing: r2(glazingHeated),
      doors: r2(doorsHeated),
      wallOpaque: r2(wallGross - glazingHeated - doorsHeated),
    },
    uValues: {
      exteriorWall: derived.assemblies.exteriorWall.U,
      roof: derived.assemblies.roof.U,
      groundFloor: derived.assemblies.groundFloor.U,
      windows: house.windows.Uw,
    },
  };
}
