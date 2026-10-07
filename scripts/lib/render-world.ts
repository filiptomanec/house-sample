// The static world of the render inputs: house summary, terrain grid, plot and surfaces, vegetation, neighbours.
// Everything comes from the model and the TypeScript kernel (never re-derived in Python). See docs/RENDER-INPUTS.md.
import type { Derived, House } from "../../src/lib/model";
import { sha256Hex } from "../../src/lib/model/hash";
import type { Site, SiteDerived } from "../../src/lib/model/site";
import type { RenderConfig, Vec3 } from "./render-schema";
import type { Poly } from "./render-types";

export interface WorldContext {
  house: House;
  derived: Derived;
  site: Site;
  siteDerived: SiteDerived;
  cfg: RenderConfig;
}

const rectPoly = ([x0, y0, x1, y1]: readonly number[]): Poly => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Stable 31-bit integer from a string (first 4 bytes of its SHA-256). */
export const seedOf = (s: string): number => parseInt(sha256Hex(s).slice(0, 8), 16) & 0x7fffffff;

export function buildHouseSection({ house, derived }: WorldContext) {
  const b = derived.bbox;
  return {
    bbox: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, z0: b.z0, z1: b.z1 },
    footprint: derived.outline.polygons[0].pts as Poly,
    clearHeight: house.clearHeight,
    wallTop: derived.defaultWallTop,
    ridgeHeight: Math.max(...derived.roofs.map((r) => r.ridgeHeight)),
    center: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] as [number, number],
    roofs: derived.roofs.map((r) => ({
      id: r.id,
      rect: r.rect,
      eaveRect: r.eaveRect,
      pitch: r.pitch,
      overhang: r.overhang,
      wallTop: r.wallTop,
      eaveHeight: r.eaveHeight,
      ridgeHeight: r.ridgeHeight,
      ridge: r.ridge,
    })),
  };
}

/** Ground height grid in integer millimetres, centred on the building, from the TypeScript terrain (graded plateau + natural ground). */
export function buildTerrain({ site, derived, cfg }: WorldContext) {
  const { extentM, stepM } = cfg.terrain;
  const cx = (derived.bbox.x0 + derived.bbox.x1) / 2;
  const cy = (derived.bbox.y0 + derived.bbox.y1) / 2;
  const x0 = Math.round((cx - extentM / 2) / stepM) * stepM;
  const y0 = Math.round((cy - extentM / 2) / stepM) * stepM;
  const n = Math.round(extentM / stepM) + 1;
  const heightsMm: number[] = new Array<number>(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heightsMm[j * n + i] = Math.round(site.terrain.groundAt(x0 + i * stepM, y0 + j * stepM) * 1000) + 0;
  const p = site.model.terrain.plateau;
  return {
    zeroLevelAsl: site.model.terrain.zeroLevelAsl,
    grid: { x0, y0, step: stepM, nx: n, ny: n, unit: "mm" as const, heightsMm },
    plateau: { level: p.level, rects: p.rects as number[][], blend: p.blend },
  };
}

const OUTDOOR_ROLE: Record<string, string> = { drive: "drive_paving", path: "path" };
const BED_ROLE: Record<string, string> = { mulch: "mulch", gravel: "gravel" };

export interface Surface {
  kind: string;
  role: string;
  polygon: Poly;
  inGlb: boolean;
  drape: boolean;
}

export function buildSite({ derived, site, siteDerived: sd }: WorldContext, hints: (species: string) => { form: string; leaf: string; flower?: string }) {
  const surfaces: Surface[] = [];
  // outdoor slabs of the house model: already in house.glb (hb/exterior.py), listed for completeness
  for (const o of derived.outdoor) surfaces.push({ kind: o.type, role: OUTDOOR_ROLE[o.type] ?? "terrace_paving", polygon: rectPoly(o.rect), inGlb: true, drape: false });
  for (const p of site.model.paved) surfaces.push({ kind: p.kind, role: p.surface, polygon: p.polygon as Poly, inGlb: false, drape: true });
  const a = sd.access;
  if (a.driveApron.length) surfaces.push({ kind: "drive_apron", role: "drive_paving", polygon: a.driveApron, inGlb: false, drape: true });
  if (a.driveVerge.length) surfaces.push({ kind: "drive_verge", role: "drive_paving", polygon: a.driveVerge, inGlb: false, drape: true });
  if (a.walkApron.length) surfaces.push({ kind: "walk_apron", role: "path", polygon: a.walkApron, inGlb: false, drape: true });
  if (a.walkVerge.length) surfaces.push({ kind: "walk_verge", role: "path", polygon: a.walkVerge, inGlb: false, drape: true });
  for (const b of sd.beds) surfaces.push({ kind: `bed_${b.kind}`, role: BED_ROLE[b.kind] ?? "mulch", polygon: b.polygon, inGlb: false, drape: true });
  return {
    plot: sd.plot,
    zones: {
      street: { ...sd.zones.street, kerbHeight: site.model.street.kerbHeight },
      field: sd.zones.field,
      neighbourPlots: sd.zones.neighbourPlots.map((n) => ({ polygon: n.polygon })),
    },
    surfaces,
    fences: sd.fences.map((f) => ({ kind: f.kind, height: f.height, thickness: f.thickness, parts: f.parts })),
    hedges: sd.hedges.map((h) => ({ species: h.species, evergreen: h.evergreen, height: h.height, width: h.width, path: h.path, ...hints(h.species) })),
    access: { driveGate: a.driveGate, walkGate: a.walkGate },
  };
}

export function buildVegetation({ siteDerived: sd }: WorldContext, hints: (species: string) => { form: string; leaf: string; flower?: string }) {
  const jitter = (seed: number) => ({ yawDeg: (seed % 3600) / 10, scale: 0.92 + ((seed >>> 8) % 160) / 1000 });
  return {
    trees: sd.trees.map((t) => {
      const seed = seedOf(`${t.species}:${t.x}:${t.y}`);
      return { species: t.species, latin: t.latin, evergreen: t.evergreen, x: t.x, y: t.y, z: t.z, height: t.height, crown: t.crown, crownBase: t.crownBase, ...hints(t.species), seed, ...jitter(seed) };
    }),
    shrubs: sd.shrubs.map((s) => {
      const seed = seedOf(`${s.species}:${s.x}:${s.y}`);
      return { species: s.species, latin: s.latin, evergreen: s.evergreen, x: s.x, y: s.y, z: s.z, height: s.height, width: s.width, ...hints(s.species), seed, ...jitter(seed) };
    }),
  };
}

export function buildNeighbours({ site, siteDerived: sd }: WorldContext) {
  return sd.neighbours.map((n, i) => {
    const h = site.model.neighbours[i].house;
    return {
      footprint: n.footprint,
      center: h.center as [number, number],
      size: h.size as [number, number],
      rotDeg: h.rotDeg,
      baseZ: n.baseZ,
      eaveHeight: n.eaveHeight,
      ridgeHeight: n.ridgeHeight,
      eaveZ: Math.round((n.baseZ + n.eaveHeight) * 1000) / 1000,
      ridgeZ: Math.round((n.baseZ + n.ridgeHeight) * 1000) / 1000,
      roof: n.roof,
    };
  });
}

/** Unit normal and in-wall "along" vector (to the right when looking at the facade from outside) of an azimuth in the house frame. */
export function facadeVectors(azimuthHouseDeg: number): { normal: Vec3; along: Vec3 } {
  const a = (azimuthHouseDeg * Math.PI) / 180;
  const nx = Math.sin(a), ny = Math.cos(a);
  return { normal: [nx, ny, 0], along: [-ny, nx, 0] };
}
