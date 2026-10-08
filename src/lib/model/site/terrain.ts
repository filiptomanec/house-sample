// Analytic terrain: a heightfield defined only by parameters (plane + smooth waves + seeded micro-relief),
// blended into a levelled plateau around the house. Heights are metres relative to the finished floor (+-0.000).
import { azimuthOf, bboxOf, deg2rad, houseToTrueAzimuth, mod360, nearestOnPolygon, pointInPolygon, rad2deg, dist, type Bbox, type Rect, type XY } from "./geometry";

export interface WaveParams {
  /** Peak height (m). */
  amplitude: number;
  /** Wavelength (m). */
  wavelength: number;
  /** Direction of travel in the house frame, degrees counter-clockwise from +x. */
  directionDeg: number;
  /** Phase at the plane origin, degrees. */
  phaseDeg: number;
}

export interface NoiseParams {
  /** Integer seed of the deterministic lattice noise. */
  seed: number;
  /** Peak amplitude of the first octave (m). */
  amplitude: number;
  /** Lattice spacing of the first octave (m). */
  wavelength: number;
  /** Number of octaves (each: half amplitude, half wavelength). Default 2. */
  octaves?: number;
}

export interface TerrainParams {
  /** Height of the +-0.000 level above sea level (m), fictional datum. */
  zeroLevelAsl: number;
  plane: {
    /** Point of the house frame the plane is referenced to. */
    origin: XY;
    /** Natural ground height at the origin (m, relative to +-0.000). */
    z0: number;
    /** Fall towards true south (%), the plane rises to the north. */
    slopeSouthPct: number;
    /** Fall towards true west (%), the plane rises to the east. */
    slopeWestPct: number;
  };
  waves: WaveParams[];
  noise?: NoiseParams;
  plateau: {
    /** Height of the levelled ground (m). 0 = finished floor level. */
    level: number;
    /** Levelled rectangles (house frame); the flat area is their union. */
    rects: Rect[];
    /** Width of the smooth transition to natural ground (m). */
    blend: number;
  };
}

export interface HeightGrid {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  /** Row-major, index = j * nx + i, point (x0 + i * step, y0 + j * step). */
  z: Float64Array;
}

export interface SlopeInfo {
  /** dz/dx and dz/dy (house frame). */
  gx: number;
  gy: number;
  slopePct: number;
  slopeDeg: number;
  /** Azimuth the ground falls towards, house frame (clockwise from +y). */
  downhillHouseAzimuth: number;
  /** Same, relative to true north. */
  downhillTrueAzimuth: number;
}

/** A planar slab top: z = z0 + gx * (x - ox) + gy * (y - oy) (house frame, m). */
export interface SlabPlane {
  z0: number;
  ox: number;
  oy: number;
  gx: number;
  gy: number;
}
export const planeZ = (p: SlabPlane, x: number, y: number): number => p.z0 + p.gx * (x - p.ox) + p.gy * (y - p.oy);

/** A hard surface the ground must stay under: a convex footprint and the plane of its top (see `createTerrain`). */
export interface GroundSlab {
  polygon: XY[];
  plane: SlabPlane;
}

/** The ground stays at least this far below the top of every slab (m): the exposed edge of a slab at the gate. */
export const SLAB_GROUND_GAP = 0.03;
/** Beside a slab the cut ground blends back to the graded terrain over this width (m). */
export const SLAB_SIDE_BLEND = 0.6;

export interface Terrain {
  params: TerrainParams;
  bearingDeg: number;
  /** Natural ground before grading. */
  naturalAt(x: number, y: number): number;
  /** Plateau blended with the natural ground, before the slabs are cut in. */
  baseAt(x: number, y: number): number;
  /**
   * Graded ground: the plateau blended with the natural ground, cut down under the slabs (paving, drive and path ramps) so
   * that it stays at least SLAB_GROUND_GAP below every slab top, with a SLAB_SIDE_BLEND band beside them. The surface used
   * everywhere (web terrain, renders, sun analysis, cameras with `aboveGround`).
   */
  groundAt(x: number, y: number): number;
  /** The slabs the ground follows (empty for a terrain without the house). */
  slabs: readonly GroundSlab[];
  /** Weight of the plateau at a point: 1 on the levelled area, 0 on untouched ground. */
  plateauWeight(x: number, y: number): number;
  /** Distance from a point to the levelled area (0 inside). */
  plateauDistance(x: number, y: number): number;
  slopeAt(x: number, y: number): SlopeInfo;
  grid(bbox: Bbox, step: number): HeightGrid;
}

/** mulberry32-style integer hash of a lattice point, result in [-1, 1). Deterministic across platforms. */
export function latticeHash(i: number, j: number, seed: number): number {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0x100000000) * 2 - 1;
}

const quintic = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth (C2) value noise in [-1, 1], lattice spacing 1. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = quintic(x - xi), v = quintic(y - yi);
  const a = latticeHash(xi, yi, seed), b = latticeHash(xi + 1, yi, seed);
  const c = latticeHash(xi, yi + 1, seed), d = latticeHash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Distance from (x, y) to an axis-aligned rectangle (0 inside). */
export const distToRect = (x: number, y: number, [x0, y0, x1, y1]: Rect): number =>
  Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));

/**
 * Builds the terrain. `slabs` (from `gradeOutdoor`) cut the ground under the hard surfaces of the house: inside a slab the
 * ground is min(base, top - SLAB_GROUND_GAP); outside it the cut fades out over SLAB_SIDE_BLEND (smoothstep of the
 * distance), measured to the top at the nearest point of the slab. The result is continuous; a slab never sinks under the
 * ground, and where the ground is already lower (the plateau around the house) nothing changes.
 */
export function createTerrain(params: TerrainParams, bearingDeg: number, slabs: readonly GroundSlab[] = []): Terrain {
  const phi = deg2rad(bearingDeg);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const sN = params.plane.slopeSouthPct / 100; // ground rises towards the north by this much per metre
  const sE = params.plane.slopeWestPct / 100; // ... and towards the east
  const [ox, oy] = params.plane.origin;
  const waves = params.waves.map((w) => ({
    a: w.amplitude,
    k: (2 * Math.PI) / w.wavelength,
    cx: Math.cos(deg2rad(w.directionDeg)),
    cy: Math.sin(deg2rad(w.directionDeg)),
    ph: deg2rad(w.phaseDeg),
  }));
  const noise = params.noise;
  const octaves = noise ? Math.max(1, Math.floor(noise.octaves ?? 2)) : 0;

  const naturalAt = (x: number, y: number): number => {
    const dx = x - ox, dy = y - oy;
    const e = dx * cp + dy * sp; // true east
    const n = -dx * sp + dy * cp; // true north
    let z = params.plane.z0 + sN * n + sE * e;
    for (const w of waves) z += w.a * Math.sin(w.k * (w.cx * dx + w.cy * dy) + w.ph);
    if (noise) {
      let amp = noise.amplitude, f = 1 / noise.wavelength;
      for (let o = 0; o < octaves; o++) {
        z += amp * valueNoise(x * f + 11.5 * o, y * f - 7.25 * o, noise.seed + o * 101);
        amp *= 0.5;
        f *= 2;
      }
    }
    return z;
  };

  const plateauDistance = (x: number, y: number): number => {
    let d = Infinity;
    for (const r of params.plateau.rects) d = Math.min(d, distToRect(x, y, r));
    return d;
  };
  const plateauWeight = (x: number, y: number): number => {
    const d = plateauDistance(x, y);
    return d <= 0 ? 1 : smoothstep(1 - d / params.plateau.blend);
  };
  const baseAt = (x: number, y: number): number => {
    const k = plateauWeight(x, y);
    if (k >= 1) return params.plateau.level;
    return naturalAt(x, y) * (1 - k) + params.plateau.level * k;
  };
  const cut = slabs.map((s) => {
    const b = bboxOf(s.polygon);
    return { ...s, box: { x0: b.x0 - SLAB_SIDE_BLEND, y0: b.y0 - SLAB_SIDE_BLEND, x1: b.x1 + SLAB_SIDE_BLEND, y1: b.y1 + SLAB_SIDE_BLEND } };
  });
  const groundAt = (x: number, y: number): number => {
    const base = baseAt(x, y);
    let g = base;
    for (const s of cut) {
      if (x < s.box.x0 || x > s.box.x1 || y < s.box.y0 || y > s.box.y1) continue;
      const p: XY = [x, y];
      const inside = pointInPolygon(p, s.polygon);
      const q = inside ? p : nearestOnPolygon(p, s.polygon);
      const d = inside ? 0 : dist(p, q);
      if (d >= SLAB_SIDE_BLEND) continue;
      const lim = planeZ(s.plane, q[0], q[1]) - SLAB_GROUND_GAP;
      if (base <= lim) continue;
      const w = d <= 0 ? 1 : smoothstep(1 - d / SLAB_SIDE_BLEND);
      g = Math.min(g, base - w * (base - lim));
    }
    return g;
  };

  const slopeAt = (x: number, y: number): SlopeInfo => {
    const h = 0.05;
    const gx = (groundAt(x + h, y) - groundAt(x - h, y)) / (2 * h);
    const gy = (groundAt(x, y + h) - groundAt(x, y - h)) / (2 * h);
    const m = Math.hypot(gx, gy);
    const downhill = m < 1e-12 ? 0 : azimuthOf([-gx, -gy]);
    return {
      gx, gy,
      slopePct: m * 100,
      slopeDeg: rad2deg(Math.atan(m)),
      downhillHouseAzimuth: downhill,
      downhillTrueAzimuth: mod360(houseToTrueAzimuth(downhill, bearingDeg)),
    };
  };

  const grid = (bbox: Bbox, step: number): HeightGrid => {
    const nx = Math.floor((bbox.x1 - bbox.x0) / step + 1e-9) + 1;
    const ny = Math.floor((bbox.y1 - bbox.y0) / step + 1e-9) + 1;
    const z = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = groundAt(bbox.x0 + i * step, bbox.y0 + j * step);
    return { x0: bbox.x0, y0: bbox.y0, step, nx, ny, z };
  };

  return { params, bearingDeg, naturalAt, baseAt, groundAt, slabs: cut.map(({ polygon, plane }) => ({ polygon, plane })), plateauWeight, plateauDistance, slopeAt, grid };
}

/** Bilinear height from a grid (clamped to the grid). */
export function gridHeight(g: HeightGrid, x: number, y: number): number {
  const fx = (x - g.x0) / g.step, fy = (y - g.y0) / g.step;
  const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(g.ny - 2, Math.floor(fy)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
  const k = j * g.nx + i;
  return (g.z[k] * (1 - u) + g.z[k + 1] * u) * (1 - v) + (g.z[k + g.nx] * (1 - u) + g.z[k + g.nx + 1] * u) * v;
}

export interface TerrainMesh {
  /** x, y, z triples in the house frame (z up). Convert to glTF Y-up as (x, z, -y) when building the scene. */
  positions: Float32Array;
  normals: Float32Array;
  /** u, v pairs in metres (world scale) for tiling textures. */
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Triangle mesh for rendering a height grid (two triangles per cell, smooth normals from central differences). */
export function gridToMesh(g: HeightGrid): TerrainMesh {
  const { nx, ny, step } = g;
  const positions = new Float32Array(nx * ny * 3);
  const normals = new Float32Array(nx * ny * 3);
  const uvs = new Float32Array(nx * ny * 2);
  const at = (i: number, j: number) => g.z[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      positions[k * 3] = g.x0 + i * step;
      positions[k * 3 + 1] = g.y0 + j * step;
      positions[k * 3 + 2] = g.z[k];
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), gy = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const l = Math.hypot(gx, gy, 1);
      normals[k * 3] = -gx / l;
      normals[k * 3 + 1] = -gy / l;
      normals[k * 3 + 2] = 1 / l;
      uvs[k * 2] = g.x0 + i * step;
      uvs[k * 2 + 1] = g.y0 + j * step;
    }
  }
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let o = 0;
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // counter-clockwise seen from above (+z)
      indices[o++] = a; indices[o++] = b; indices[o++] = d;
      indices[o++] = a; indices[o++] = d; indices[o++] = c;
    }
  }
  return { positions, normals, uvs, indices };
}
