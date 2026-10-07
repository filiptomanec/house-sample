// Printable massing model of the house as a binary STL in millimetres: the walls as one solid block up to the wall top, each
// roof face as a prism down to a flat bottom, covered outdoor areas as thin slabs with posts, and optionally a base plate or
// a slab of the site terrain. Every part is a closed shell; parts overlap slightly so a slicer fuses them into one piece.
//
// Contract: docs/CALC-API.md, section 10. Pure TypeScript: no three.js (the 3D page converts the same mesh itself), no DOM,
// no file or network access, no text. The house frame is z up; the STL keeps it (slicers expect z up).
import type { Derived } from "@/lib/model/types";
import type { Site } from "@/lib/model/site";
import { ringArea2, triangulate, type P2 } from "./triangulate";

/** Denominators of the presets (1:100 ... 1:200) and the allowed range for any other value. */
export const PRINT_SCALES = [100, 150, 200] as const;
export const PRINT_SCALE_RANGE = { min: 100, max: 200 } as const;

/** Defaults of the printer and of the model margins; named constants of the module, not house numbers. */
export const PRINT_DEFAULTS = {
  /** Side of a typical square print bed, mm. */
  bedMm: 250,
  /** Margin of the base plate around the buildings, m. */
  plateMarginM: 1,
  /** Margin of the terrain slab around the buildings, m. The graded plateau reaches `terrain.plateau.blend` away, so a few metres show the slope. */
  terrainMarginM: 5,
  /** Thickness of the base plate below the floor level, m. */
  plateThicknessM: 0.25,
  /** Thickness of the roof prisms at the lowest edge (fascia), m; keeps the eaves from degenerating into zero thickness. */
  roofEdgeThicknessM: 0.15,
  /** Overlap of touching parts so that the slicer merges them, m. */
  overlapM: 0.05,
  /** Thickness of terrace and paving slabs above the floor level, m. */
  slabHeightM: 0.05,
  /** Side of the square posts under covered areas, m. At 1:200 a thinner post would be below one nozzle width. */
  postSizeM: 0.3,
  /** Solid ground under the lowest point of the terrain slab, m. */
  terrainBaseM: 0.6,
  /** Cell of the terrain grid, m. */
  terrainStepM: 1,
} as const;

/** Prefix of the 80-byte STL header: ASCII only, no names of people or places. */
export const STL_HEADER_PREFIX = "House Sample";

export type PrintGround = "none" | "plate" | "terrain";

export interface PrintOptions {
  /** Denominator of the scale (200 = 1:200). Clamped to `PRINT_SCALE_RANGE`. Default 200. */
  scale?: number;
  /** Ground: nothing (the house stands on its own footprint), a flat plate, or a slab with the graded site terrain (needs `site`). Default "plate". */
  ground?: PrintGround;
  /** Include terraces, paving and their posts as slabs. Default true. */
  outdoor?: boolean;
  /** Print bed side, mm, for `printReport` and `autoFit`. Default `PRINT_DEFAULTS.bedMm`. */
  bedMm?: number;
  /** When the model does not fit the bed at `scale`, take the next larger denominator that fits (up to the range maximum). Default false. */
  autoFit?: boolean;
}

export type PrintPartName = "walls" | "roof" | "outdoor" | "plate" | "terrain";

/** Triangles of a mesh in metres, house frame (z up): 9 floats per triangle, counter-clockwise seen from outside. */
export interface PrintMesh {
  positions: Float32Array;
  triangleCount: number;
  /** Named parts for statistics and for tests: [first triangle, number of triangles]. */
  parts: { name: PrintPartName; first: number; count: number }[];
  /** The closed shells the parts consist of (one per wall block, roof face, slab, post, plate or terrain slab), in triangle order. */
  shells: { part: PrintPartName; first: number; count: number }[];
  bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
}

// ------------------------------------------------------------------------------------------------ mesh builder

type V3 = readonly [number, number, number];

class MeshBuilder {
  private readonly pos: number[] = [];
  readonly shells: PrintMesh["shells"] = [];

  get count(): number {
    return this.pos.length / 9;
  }

  tri(a: V3, b: V3, c: V3): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  /** Everything `fill` adds is one closed shell of `part`. */
  shell(part: PrintPartName, fill: () => void): void {
    const first = this.count;
    fill();
    const count = this.count - first;
    if (count > 0) this.shells.push({ part, first, count });
  }

  finish(): PrintMesh {
    const positions = Float32Array.from(this.pos);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      const k = i % 3;
      if (positions[i] < min[k]) min[k] = positions[i];
      if (positions[i] > max[k]) max[k] = positions[i];
    }
    if (!positions.length) { min.fill(0); max.fill(0); }
    const parts: PrintMesh["parts"] = [];
    for (const s of this.shells) {
      const last = parts[parts.length - 1];
      if (last && last.name === s.part && last.first + last.count === s.first) last.count += s.count;
      else parts.push({ name: s.part, first: s.first, count: s.count });
    }
    return {
      positions, triangleCount: this.count, parts, shells: this.shells,
      bounds: { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] },
    };
  }
}

// ------------------------------------------------------------------------------------------------ prisms

/** A closed outline with the height of the top at each vertex. */
interface Loop {
  pts: P2[];
  top: number[];
}

const cross = (a: P2, b: P2, c: P2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Smaller twice-areas (m2) of three consecutive vertices count as a straight line. */
const COLLINEAR = 1e-9;

/** Drops repeated and collinear vertices (and their heights). A planar face stays planar: the dropped vertex lay on the line. */
function cleanLoop(loop: Loop): Loop {
  const pts = [...loop.pts], top = [...loop.top];
  for (let again = true; again && pts.length > 3; ) {
    again = false;
    for (let i = 0; i < pts.length; i++) {
      const n = pts.length, a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      if ((a[0] === b[0] && a[1] === b[1]) || Math.abs(cross(a, b, c)) <= COLLINEAR) {
        pts.splice(i, 1);
        top.splice(i, 1);
        again = true;
        break;
      }
    }
  }
  return { pts, top };
}

const reversed = (l: Loop): Loop => ({ pts: [...l.pts].reverse(), top: [...l.top].reverse() });

/**
 * A closed vertical prism: the loops (the first is the outer ring, the others are holes) between the flat `bottom` and the
 * per-vertex top. Top and bottom faces are triangulated; the side faces are quads along every ring edge. Outward normals.
 */
function addPrism(b: MeshBuilder, loops: Loop[], bottom: number): void {
  const clean = loops.map(cleanLoop).filter((l) => l.pts.length >= 3);
  if (!clean.length) return;
  const rings = clean.map((l, k) => ((ringArea2(l.pts) > 0) === (k === 0) ? l : reversed(l))); // outer counter-clockwise, holes clockwise
  const pts = rings.flatMap((l) => l.pts), tops = rings.flatMap((l) => l.top);
  const T = (i: number): V3 => [pts[i][0], pts[i][1], tops[i]];
  const B = (i: number): V3 => [pts[i][0], pts[i][1], bottom];
  for (const [a, c, d] of triangulate(rings[0].pts, rings.slice(1).map((l) => l.pts))) {
    b.tri(T(a), T(c), T(d));
    b.tri(B(a), B(d), B(c));
  }
  let at = 0;
  for (const l of rings) {
    for (let k = 0; k < l.pts.length; k++) {
      const i = at + k, j = at + ((k + 1) % l.pts.length);
      // material is on the left of the walking direction, so the outward normal is on the right
      if (tops[j] > bottom) b.tri(B(i), B(j), T(j));
      if (tops[i] > bottom) b.tri(B(i), T(j), T(i));
    }
    at += l.pts.length;
  }
}

const flatLoop = (pts: P2[], top: number): Loop => ({ pts, top: pts.map(() => top) });
const rectLoop = (x0: number, y0: number, x1: number, y1: number, top: number): Loop => flatLoop([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], top);

// ------------------------------------------------------------------------------------------------ the model

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const growBox = (b: Box, x: number, y: number): void => {
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
};

/** Plan extent of everything that is printed (outline, roof faces with their overhang, outdoor areas when included). */
function footprintBox(d: Derived, outdoor: boolean): Box {
  const b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const poly of d.outline.polygons) for (const p of poly.pts) growBox(b, p[0], p[1]);
  for (const f of d.roofPlanes) for (const p of f.pts) growBox(b, p[0], p[1]);
  if (outdoor) for (const o of d.outdoor) { growBox(b, o.rect[0], o.rect[1]); growBox(b, o.rect[2], o.rect[3]); }
  if (!Number.isFinite(b.x0)) return { x0: d.bbox.x0, y0: d.bbox.y0, x1: d.bbox.x1, y1: d.bbox.y1 };
  return b;
}

/** Height of the wall top: where the roofs sit on the walls (the highest of them), else the default of the model. */
export function wallTopOf(d: Pick<Derived, "roofs" | "defaultWallTop">): number {
  return d.roofs.length ? Math.max(...d.roofs.map((r) => r.wallTop)) : d.defaultWallTop;
}

/** Samples of the terrain slab: a regular grid over a box with the ground height at every node. */
interface TerrainGrid {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  sx: number;
  sy: number;
  z: number[][];
  bottom: number;
}

function sampleTerrain(site: Site, box: Box): TerrainGrid {
  const step = PRINT_DEFAULTS.terrainStepM;
  const nx = Math.max(1, Math.ceil((box.x1 - box.x0) / step)), ny = Math.max(1, Math.ceil((box.y1 - box.y0) / step));
  const sx = (box.x1 - box.x0) / nx, sy = (box.y1 - box.y0) / ny;
  const z: number[][] = [];
  let lowest = Infinity;
  for (let j = 0; j <= ny; j++) {
    z.push([]);
    for (let i = 0; i <= nx; i++) {
      const h = site.terrain.groundAt(box.x0 + i * sx, box.y0 + j * sy);
      z[j].push(h);
      if (h < lowest) lowest = h;
    }
  }
  return { x0: box.x0, y0: box.y0, nx, ny, sx, sy, z, bottom: lowest - PRINT_DEFAULTS.terrainBaseM };
}

/** Lowest terrain vertex of the cells that a rectangle touches: a building placed this deep stands in the slab everywhere under it. */
function lowestUnder(g: TerrainGrid, x0: number, y0: number, x1: number, y1: number): number {
  const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.sx)), i1 = Math.min(g.nx, Math.ceil((x1 - g.x0) / g.sx));
  const j0 = Math.max(0, Math.floor((y0 - g.y0) / g.sy)), j1 = Math.min(g.ny, Math.ceil((y1 - g.y0) / g.sy));
  let m = Infinity;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) m = Math.min(m, g.z[j][i]);
  return m;
}

function addTerrain(b: MeshBuilder, g: TerrainGrid): void {
  const X = (i: number) => g.x0 + i * g.sx, Y = (j: number) => g.y0 + j * g.sy;
  const T = (i: number, j: number): V3 => [X(i), Y(j), g.z[j][i]];
  const B = (i: number, j: number): V3 => [X(i), Y(j), g.bottom];
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      b.tri(T(i, j), T(i + 1, j), T(i + 1, j + 1));
      b.tri(T(i, j), T(i + 1, j + 1), T(i, j + 1));
      b.tri(B(i, j), B(i + 1, j + 1), B(i + 1, j)); // the bottom uses the same grid: no T-junctions
      b.tri(B(i, j), B(i, j + 1), B(i + 1, j + 1));
    }
  }
  for (let i = 0; i < g.nx; i++) {
    b.tri(B(i, 0), B(i + 1, 0), T(i + 1, 0));
    b.tri(B(i, 0), T(i + 1, 0), T(i, 0));
    b.tri(B(i, g.ny), T(i + 1, g.ny), B(i + 1, g.ny));
    b.tri(B(i, g.ny), T(i, g.ny), T(i + 1, g.ny));
  }
  for (let j = 0; j < g.ny; j++) {
    b.tri(B(0, j), T(0, j + 1), B(0, j + 1));
    b.tri(B(0, j), T(0, j), T(0, j + 1));
    b.tri(B(g.nx, j), B(g.nx, j + 1), T(g.nx, j + 1));
    b.tri(B(g.nx, j), T(g.nx, j + 1), T(g.nx, j));
  }
}

const insideRing = (p: P2, ring: readonly P2[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if (a[1] > p[1] !== c[1] > p[1] && p[0] < ((c[0] - a[0]) * (p[1] - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/**
 * Builds the triangles of the print in metres. Walls: the outline of `derived.outline.polygons` (holes respected) from the
 * base up to the wall top of the roofs; roof: every face of `derived.roofPlanes` as a prism between its plane and a flat bottom
 * `roofEdgeThicknessM` below the lowest eave; outdoor: `derived.outdoor` rectangles as slabs, `posts` as thin columns up to the
 * roof; ground: see `PrintOptions.ground` (terrain from `site.terrain` on a regular grid, buildings start just below the lowest
 * terrain vertex under them). All parts are closed, consistently oriented shells (every edge shared by two triangles of the
 * same part, volume positive). `site` may be null unless `ground` is "terrain".
 */
export function buildPrintMesh(derived: Derived, site: Site | null, opts: PrintOptions = {}): PrintMesh {
  const ground = opts.ground ?? "plate", outdoor = opts.outdoor ?? true;
  if (ground === "terrain" && !site) throw new TypeError("buildPrintMesh: ground \"terrain\" needs a site");
  const D = PRINT_DEFAULTS;
  const b = new MeshBuilder();
  const box = footprintBox(derived, outdoor);
  const wallTop = wallTopOf(derived);
  const lowestEave = derived.roofPlanes.length ? Math.min(...derived.roofPlanes.map((f) => f.zMin)) : null;
  const roofBottom = lowestEave === null ? wallTop : Math.min(lowestEave - D.roofEdgeThicknessM, wallTop - D.overlapM);

  // ground, and the level where buildings start (a little below the top of the ground, so they are fused to it)
  let grid: TerrainGrid | null = null;
  let foot: (x0: number, y0: number, x1: number, y1: number) => number = () => 0;
  if (ground === "plate") {
    const m = D.plateMarginM;
    b.shell("plate", () => addPrism(b, [rectLoop(box.x0 - m, box.y0 - m, box.x1 + m, box.y1 + m, 0)], -D.plateThicknessM));
    foot = () => -D.overlapM;
  } else if (ground === "terrain" && site) {
    const m = D.terrainMarginM;
    grid = sampleTerrain(site, { x0: box.x0 - m, y0: box.y0 - m, x1: box.x1 + m, y1: box.y1 + m });
    const g = grid;
    b.shell("terrain", () => addTerrain(b, g));
    foot = (x0, y0, x1, y1) => Math.min(0, lowestUnder(g, x0, y0, x1, y1)) - D.overlapM;
  }

  // walls: one solid block per outer ring of the outline, holes (courtyards) cut out
  const rings = derived.outline.polygons.map((p) => p.pts as P2[]);
  const outers = rings.filter((r) => ringArea2(r) > 0), holes = rings.filter((r) => ringArea2(r) < 0);
  for (const outer of outers) {
    const mine = holes.filter((h) => insideRing(h[0], outer));
    const xs = outer.map((p) => p[0]), ys = outer.map((p) => p[1]);
    const base = foot(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    b.shell("walls", () => addPrism(b, [flatLoop(outer, wallTop), ...mine.map((h) => flatLoop(h, wallTop))], base));
  }

  // roof: one prism per face, from its plane down to the common flat bottom
  for (const f of derived.roofPlanes) {
    b.shell("roof", () => addPrism(b, [{ pts: f.pts, top: f.pts3.map((p) => p[2]) }], roofBottom));
  }

  // outdoor areas: slabs, and posts up into the roof of the covered ones
  if (outdoor) {
    for (const o of derived.outdoor) {
      const [x0, y0, x1, y1] = o.rect, base = foot(x0, y0, x1, y1);
      b.shell("outdoor", () => addPrism(b, [rectLoop(x0, y0, x1, y1, D.slabHeightM)], base));
      if (!o.covered) continue;
      const h = D.postSizeM / 2, top = lowestEave === null ? wallTop : roofBottom + D.overlapM;
      for (const [px, py] of o.posts) {
        b.shell("outdoor", () => addPrism(b, [rectLoop(px - h, py - h, px + h, py + h, top)], base));
      }
    }
  }
  return b.finish();
}

// ------------------------------------------------------------------------------------------------ scale, bed, report

/** The scale of an option: finite, rounded to a whole denominator, within `PRINT_SCALE_RANGE`. Default 200. */
export function normalizeScale(scale?: number): number {
  const s = scale === undefined || !Number.isFinite(scale) ? PRINT_SCALE_RANGE.max : Math.round(scale);
  return Math.min(PRINT_SCALE_RANGE.max, Math.max(PRINT_SCALE_RANGE.min, s));
}

export interface BedFit {
  /** Bounding box of the print at the scale, mm. */
  sizeMm: [number, number, number];
  bedMm: number;
  /** Do the horizontal dimensions fit the bed? (Height is not limited by a typical bed.) */
  fits: boolean;
}

/** Checks the horizontal extent of a mesh at a scale against a square bed. */
export function checkBedFit(mesh: Pick<PrintMesh, "bounds">, scale: number, bedMm: number = PRINT_DEFAULTS.bedMm): BedFit {
  const k = 1000 / scale, [x, y, z] = mesh.bounds.size;
  const sizeMm: [number, number, number] = [x * k, y * k, z * k];
  return { sizeMm, bedMm, fits: Math.max(sizeMm[0], sizeMm[1]) <= bedMm };
}

/** The smallest denominator >= `preferred` (within the range) at which the mesh fits the bed, or null if none does. */
export function fittingScale(mesh: Pick<PrintMesh, "bounds">, preferred: number, bedMm: number = PRINT_DEFAULTS.bedMm): number | null {
  const start = normalizeScale(preferred);
  const side = Math.max(mesh.bounds.size[0], mesh.bounds.size[1]) * 1000;
  const needed = Math.ceil(side / bedMm - 1e-9); // size / scale <= bed  <=>  scale >= size / bed
  const s = Math.max(start, needed);
  return s <= PRINT_SCALE_RANGE.max ? s : null;
}

export interface PrintReport extends BedFit {
  /** Denominator actually used (after clamping and `autoFit`). */
  scale: number;
  triangles: number;
  /** Size of the STL file in bytes: 84 + 50 x triangles. */
  bytes: number;
  parts: PrintMesh["parts"];
}

/** The report of an already built mesh (the page builds the mesh once and asks for the report of each option). */
export function reportOfMesh(mesh: PrintMesh, opts: Pick<PrintOptions, "scale" | "bedMm" | "autoFit"> = {}): PrintReport {
  const bed = opts.bedMm ?? PRINT_DEFAULTS.bedMm;
  let scale = normalizeScale(opts.scale);
  if (opts.autoFit && !checkBedFit(mesh, scale, bed).fits) scale = fittingScale(mesh, scale, bed) ?? PRINT_SCALE_RANGE.max;
  return { ...checkBedFit(mesh, scale, bed), scale, triangles: mesh.triangleCount, bytes: stlBytes(mesh.triangleCount), parts: mesh.parts };
}

/** What `buildStl` would produce, without building the file: scale used, size on the bed, triangles, bytes. */
export function printReport(derived: Derived, site: Site | null, opts: PrintOptions = {}): PrintReport {
  return reportOfMesh(buildPrintMesh(derived, site, opts), opts);
}

// ------------------------------------------------------------------------------------------------ STL

const STL_HEADER_BYTES = 80;
/** Bytes of a binary STL with `triangles` triangles. */
export const stlBytes = (triangles: number): number => STL_HEADER_BYTES + 4 + 50 * triangles;

/**
 * Binary STL (80-byte header, uint32 triangle count, 50 bytes per triangle: normal, three vertices as float32 little-endian,
 * attribute 0) in millimetres at the given scale: vertex = metres x 1000 / scale. The header is ASCII, "House Sample 1:<scale>"
 * padded with spaces (no names of people or places). Normals are computed from the vertices; degenerate triangles get (0, 0, 0).
 */
export function toBinaryStl(mesh: Pick<PrintMesh, "positions" | "triangleCount">, scale: number): ArrayBuffer {
  const n = mesh.triangleCount, k = 1000 / scale;
  const buf = new ArrayBuffer(stlBytes(n)), dv = new DataView(buf);
  const header = `${STL_HEADER_PREFIX} 1:${scale}`;
  for (let i = 0; i < STL_HEADER_BYTES; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 0x20);
  dv.setUint32(STL_HEADER_BYTES, n, true);
  const p = mesh.positions;
  let o = STL_HEADER_BYTES + 4;
  for (let t = 0; t < n; t++) {
    const s = t * 9;
    const ux = (p[s + 3] - p[s]) * k, uy = (p[s + 4] - p[s + 1]) * k, uz = (p[s + 5] - p[s + 2]) * k;
    const vx = (p[s + 6] - p[s]) * k, vy = (p[s + 7] - p[s + 1]) * k, vz = (p[s + 8] - p[s + 2]) * k;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (let v = 0; v < 3; v++, o += 12) {
      dv.setFloat32(o, p[s + v * 3] * k, true);
      dv.setFloat32(o + 4, p[s + v * 3 + 1] * k, true);
      dv.setFloat32(o + 8, p[s + v * 3 + 2] * k, true);
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

/** The STL of the print: `toBinaryStl(buildPrintMesh(...), scale used)`. */
export function buildStl(derived: Derived, site: Site | null, opts: PrintOptions = {}): ArrayBuffer {
  const mesh = buildPrintMesh(derived, site, opts);
  return toBinaryStl(mesh, reportOfMesh(mesh, opts).scale);
}
