// The ground of the scene, generated from model/site.json (docs/SITE.md). Not part of the GLB: one analytic ground serves
// the web scene, the print model, the walk and the planting, so they can never disagree.
//
//  * Height: `ctx.site.terrain.groundAt(x, y)`, the kernel terrain graded with the house's slabs (the ground follows the drive
//    and path ramps). The lattice is mapped to the scene frame; its lines include the edges of every ground void
//    (`derived.groundVoids`, the pool basins), and the cells inside a void are left out, so the hole matches the coping exactly.
//  * Colour: ONE painted texture (a canvas, `TIER_SETTINGS[tier].groundTexture` px) in the house frame, so streets, fields,
//    beds, paved areas and the plot need no extra meshes, cannot z-fight and cost one draw call. Layers come from
//    `groundLayers(ctx)` (pure, tested); colours from `style.materials` / `style.generated` (data), never from literals.
//  * Detail: the material adds world-space value noise (7 m and 1.6 m patches, a fine grain that fades with distance) on
//    natural ground and soft mowing stripes on the lawn of the plot (`groundMasks`: a second small canvas, red = mown lawn,
//    green = natural ground), so the lawn does not read as plastic at any distance.
//  * Horizon: a low ring of ground continues the domain to `HORIZON.radius` (the edge colours of the texture smeared outward,
//    the street continues), with a distant tree line; the viewer's fog dissolves it into the sky's horizon colour.
//  * Inside the plateau the mesh sits `TERRAIN_DROP` below the plateau level, so the floors, paving and plinth of the
//    GLB (which are at the plateau level) always win the depth test; outside the plateau it follows the ground exactly.
import * as THREE from "three";
import { pointInPolygon, projectToPolyline, type XY } from "@/lib/model/site";
import type { HouseContext } from "./context";
import { generatedMaterial } from "./style";
import { TIER_SETTINGS, type Tier } from "./tier";

/** How far the terrain mesh is lowered under the plateau, metres (a render detail against z-fighting). */
export const TERRAIN_DROP = 0.02;

/** Colour roles of the painted ground. Resolved to `style.materials[role]` or `style.generated[role]` (fallback in the table). */
export type GroundRole =
  | "lawn" | "field" | "neighbour" | "verge" | "pavement" | "carriageway" | "marking" | "kerb"
  | "mulch" | "gravel" | "path" | "drive_paving" | "terrace_paving" | "deck" | "pool_coping";

/** Fallback style role per ground role when `style.generated` has no entry. */
export const GROUND_ROLE_FALLBACK: Record<GroundRole, string> = {
  lawn: "lawn", field: "lawn", neighbour: "lawn", verge: "lawn", pavement: "path", carriageway: "slab", marking: "plaster", kerb: "slab",
  mulch: "mulch", gravel: "gravel", path: "path", drive_paving: "drive_paving", terrace_paving: "terrace_paving", deck: "terrace_paving",
  pool_coping: "terrace_paving",
};

/** One painted shape, in the house frame (x east, y north). */
export interface GroundLayer {
  kind: "fill" | "line";
  role: GroundRole;
  /** Polygon (fill) or polyline (line). */
  points: readonly XY[];
  /** Line width, metres (kind "line"). */
  width?: number;
  /** Close the outline (kind "line"). */
  closed?: boolean;
  /** Brightness factor of the role colour (stubble rows of the field), default 1. */
  shade?: number;
}

/** Widths of the painted lines and the field rows, metres (drawing details). */
const GROUND_LINE = { kerb: 0.18, marking: 0.12, boundary: 0.06 } as const;
/** Stubble rows of the field: a row every `period` metres along the field edge, `width` wide, `shade` of the field colour. */
export const FIELD_ROWS = { period: 6, width: 3, shade: 0.93 } as const;
/** The plot edge counts as covered by a fence within this distance of the fence line (beyond its inset), metres. */
const FENCE_COVER = 0.25;
/** Sampling step of the plot edge when looking for parts no fence covers, metres. */
const BOUNDARY_STEP = 0.25;

/**
 * The parts of the plot boundary that no fence covers (a fence part, or a gate or pillar standing in its opening), as open
 * polylines. Where the fence stands, the painted boundary line would be a third outline next to the fence and the dashed line. Pure.
 */
export function uncoveredBoundary(ctx: Pick<HouseContext, "site" | "layout">): XY[][] {
  const ring = ctx.site.plot;
  const fences = ctx.layout.fences.map((f) => ({ path: f.path, inset: ctx.site.model.fences.find((m) => m.id === f.id)?.inset ?? 0, open: f.gaps.filter((g) => g.kind === "opening") }));
  const covered = (p: XY) => fences.some((f) => {
    if (f.path.length < 2) return false;
    const pr = projectToPolyline(p, f.path);
    if (pr.d > f.inset + FENCE_COVER) return false;
    return !f.open.some((g) => pr.s >= g.from && pr.s <= g.to);
  });
  const out: XY[][] = [];
  let run: XY[] = [];
  const flush = () => { if (run.length >= 2) out.push(run); run = []; };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / BOUNDARY_STEP));
    for (let k = 0; k <= n; k++) {
      const p: XY = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (covered(p)) flush();
      else if (!run.length || run[run.length - 1][0] !== p[0] || run[run.length - 1][1] !== p[1]) run.push(p);
    }
  }
  flush();
  // a run that ends at the start of the ring continues the first one
  if (out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    const f0 = first[0], lN = last[last.length - 1];
    if (Math.hypot(f0[0] - lN[0], f0[1] - lN[1]) < 1e-9) { out[0] = [...last, ...first.slice(1)]; out.pop(); }
  }
  return out;
}

/** The stubble rows of the field: bands parallel to the field edge of the plot, `FIELD_ROWS` apart. Pure. */
export function fieldRows(field: readonly XY[]): XY[][] {
  if (field.length < 4) return [];
  const [a0, b0, , d0] = field;
  const nx = d0[0] - a0[0], ny = d0[1] - a0[1], depth = Math.hypot(nx, ny);
  if (depth <= 0) return [];
  const ux = nx / depth, uy = ny / depth;
  const rows: XY[][] = [];
  for (let s = 0; s + FIELD_ROWS.width <= depth + 1e-9; s += FIELD_ROWS.period) {
    const e = s + FIELD_ROWS.width;
    rows.push([[a0[0] + ux * s, a0[1] + uy * s], [b0[0] + ux * s, b0[1] + uy * s], [b0[0] + ux * e, b0[1] + uy * e], [a0[0] + ux * e, a0[1] + uy * e]]);
  }
  return rows;
}

/** A rectangle [x0, y0, x1, y1] as a counter-clockwise ring. */
const rectRing = (r: readonly number[]): XY[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

/**
 * The layers in painting order: lawn over the whole domain, the field and its stubble rows beyond the field edge, the
 * neighbours' plots, the street (green verge, pavement, carriageway, kerb, centre line), the plot's beds (`site.beds`, role =
 * bed kind), the site's paved areas (`site.paved`, role = `surface`), the outdoor slabs of the house under their GLB slabs
 * (`derived.outdoor[].role` when it is a ground role; the pool itself is a hole), the aprons of the driveway and the walkway
 * (`layout.access`, over the verge as well) and the plot boundary where no fence stands. Pure.
 */
export function groundLayers(ctx: HouseContext): GroundLayer[] {
  const { site, layout } = ctx;
  const b = site.bounds;
  const out: GroundLayer[] = [];
  const fill = (role: GroundRole, points: readonly XY[] | null | undefined, shade?: number) => {
    if (points && points.length >= 3) out.push({ kind: "fill", role, points, ...(shade !== undefined ? { shade } : {}) });
  };
  const line = (role: GroundRole, points: readonly XY[], width: number, closed = false) => { if (points.length >= 2) out.push({ kind: "line", role, points, width, closed }); };

  fill("lawn", [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]);
  fill("field", site.zones.field);
  for (const row of fieldRows(site.zones.field)) fill("field", row, FIELD_ROWS.shade);
  for (const n of site.zones.neighbours) fill("neighbour", n.plot);
  const street = site.zones.street;
  fill("verge", street.verge);
  fill("pavement", street.pavement);
  fill("carriageway", street.carriageway);
  // the kerb runs along the edge between the verge and the carriageway (the first edge of the carriageway ring)
  line("kerb", [street.carriageway[0], street.carriageway[1]], GROUND_LINE.kerb);
  line("marking", street.centreLine, GROUND_LINE.marking);
  for (const bed of site.model.beds) fill(bed.kind, bed.polygon);
  for (const p of site.model.paved) fill(p.surface, p.polygon);
  // the outdoor slabs of the house: painted under the GLB slabs, so no lawn shows at their edges (the pool is a hole)
  const roles = new Set<string>(Object.keys(GROUND_ROLE_FALLBACK));
  for (const o of ctx.derived.outdoor) {
    if (!roles.has(o.role) || o.pool) continue;
    fill(o.role as GroundRole, rectRing(o.rect));
  }
  const a = layout.access;
  fill("drive_paving", a.driveApron);
  fill("drive_paving", a.driveVerge);
  fill("path", a.walkApron);
  fill("path", a.walkVerge);
  for (const piece of uncoveredBoundary(ctx)) line("kerb", piece, GROUND_LINE.boundary);
  // shapes wholly outside the domain (field rows far out, a neighbour beyond the margin) are never painted
  return out.filter((l) => {
    const xs = l.points.map((p) => p[0]), ys = l.points.map((p) => p[1]);
    return Math.max(...xs) >= b.x0 && Math.min(...xs) <= b.x1 && Math.max(...ys) >= b.y0 && Math.min(...ys) <= b.y1;
  });
}

// ------------------------------------------------------------------------------------------------ the lattice

/** Mesh data of the terrain in the SCENE frame (Y-up). */
export interface TerrainGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  /** Texture coordinates 0..1: the ground texture maps `bounds` to the unit square (u east, v north). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** The domain covered (house frame): exactly the plot bounding box plus `site.model.domain.margin`. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** Lattice coordinates (house frame), ascending. */
  xs: Float64Array;
  ys: Float64Array;
}

/** Lattice lines from `lo` to `hi` at most `step` apart, through every cut inside the range (a line close to a cut snaps to it). Pure. */
export function latticeLines(lo: number, hi: number, step: number, cuts: readonly number[] = []): number[] {
  const n = Math.max(1, Math.ceil((hi - lo) / step - 1e-9));
  const base = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  const inner = cuts.filter((c) => c > lo + 1e-6 && c < hi - 1e-6);
  const snap = (hi - lo) / n * 0.3;
  const out = base.filter((v, i) => i === 0 || i === n || !inner.some((c) => Math.abs(c - v) < snap));
  out.push(...inner);
  out.sort((p, q) => p - q);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-9);
}

/** Is the cell with this centre inside a ground void (house-frame rect [x0, y0, x1, y1])? */
const inVoid = (x: number, y: number, voids: readonly (readonly number[])[]) => voids.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);

/** Pure: lattice of the graded terrain at most `step` metres apart, lowered by `TERRAIN_DROP * plateauWeight`, without the cells of the ground voids, in the scene frame. */
export function terrainGeometry(ctx: HouseContext, step: number): TerrainGeometryData {
  const { terrain, bounds } = ctx.site;
  const voids = ctx.derived.groundVoids;
  const xs = Float64Array.from(latticeLines(bounds.x0, bounds.x1, step, voids.flatMap((r) => [r[0], r[2]])));
  const ys = Float64Array.from(latticeLines(bounds.y0, bounds.y1, step, voids.flatMap((r) => [r[1], r[3]])));
  const nx = xs.length, ny = ys.length;
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  const z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) z[j * nx + i] = terrain.groundAt(xs[i], ys[j]) - TERRAIN_DROP * terrain.plateauWeight(xs[i], ys[j]);
  }
  const positions = new Float32Array(nx * ny * 3), normals = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i], y = ys[j];
      // house frame (x, y, z) -> scene frame (x, z, -y)
      positions[k * 3] = x; positions[k * 3 + 1] = z[k]; positions[k * 3 + 2] = -y;
      const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny - 1, j + 1);
      const gx = (z[j * nx + i1] - z[j * nx + i0]) / (xs[i1] - xs[i0]);
      const gy = (z[j1 * nx + i] - z[j0 * nx + i]) / (ys[j1] - ys[j0]);
      const l = Math.hypot(gx, gy, 1);
      normals[k * 3] = -gx / l; normals[k * 3 + 1] = 1 / l; normals[k * 3 + 2] = gy / l;
      uvs[k * 2] = (x - bounds.x0) / w; uvs[k * 2 + 1] = (y - bounds.y0) / h;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      if (inVoid((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, voids)) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // counter-clockwise seen from above (+Y in the scene)
      idx.push(a, b, d, a, d, c);
    }
  }
  return { positions, normals, uvs, indices: Uint32Array.from(idx), bounds: { x0: bounds.x0, y0: bounds.y0, x1: bounds.x1, y1: bounds.y1 }, xs, ys };
}

// ------------------------------------------------------------------------------------------------ the horizon

/** The ring of ground beyond the domain and the distant tree line (scene conventions, metres). */
export const HORIZON = {
  /** Half-size of the outer square of the ring, measured from the centre of the domain. */
  radius: 900,
  /** Offsets of the rings from the domain edge (the first lies under the terrain border). */
  rings: [-0.5, 3, 10, 25, 50, 100, 180, 300, 500],
  /** The first ring sits this far below the terrain border, so the terrain always wins. */
  innerDrop: 0.1,
  /** Segments per side of each ring. */
  segments: 24,
  /** The height levels out to the mean edge height between these offsets. */
  flatten: [20, 200],
  /** The tree line: between these distances from the centre, clumps per full circle, blobs per clump, blob height range. */
  trees: { from: 150, to: 250, clumps: 46, perClump: 4, height: [7, 14] as const, gapDeg: 12 },
} as const;

/** Pure: the ring of ground around the domain (scene frame positions, texture coordinates over the domain, unclamped). */
export function horizonGeometry(ctx: HouseContext): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const b = ctx.site.bounds;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const g = ctx.site.terrain.groundAt;
  const clampX = (x: number) => Math.min(b.x1, Math.max(b.x0, x)), clampY = (y: number) => Math.min(b.y1, Math.max(b.y0, y));
  const S = HORIZON.segments, M = 4 * S;
  // the mean height of the domain edge, where the far ground levels out
  let mean = 0;
  for (let i = 0; i < M; i++) { const [x, y] = perimeter(b, 0, i / M); mean += g(clampX(x), clampY(y)); }
  mean /= M;
  const offsets = [...HORIZON.rings, Math.max(HORIZON.radius - Math.max(w, h) / 2, HORIZON.rings[HORIZON.rings.length - 1] + 1)];
  const positions: number[] = [], uvs: number[] = [];
  offsets.forEach((e, k) => {
    for (let i = 0; i < M; i++) {
      const [x, y] = perimeter(b, e, i / M);
      const edge = g(clampX(x), clampY(y));
      const t = THREE.MathUtils.smoothstep(e, HORIZON.flatten[0], HORIZON.flatten[1]);
      const z = edge + (mean - edge) * t - (k === 0 ? HORIZON.innerDrop : 0);
      positions.push(x, z, -y);
      uvs.push((x - b.x0) / w, (y - b.y0) / h);
    }
  });
  const idx: number[] = [];
  for (let k = 0; k + 1 < offsets.length; k++) {
    for (let i = 0; i < M; i++) {
      const a = k * M + i, bb = k * M + ((i + 1) % M), c = (k + 1) * M + i, d = (k + 1) * M + ((i + 1) % M);
      // the perimeter runs counter-clockwise (seen from above): inner a -> bb, outer c -> d
      idx.push(a, c, d, a, d, bb);
    }
  }
  return { positions: Float32Array.from(positions), uvs: Float32Array.from(uvs), indices: Uint32Array.from(idx) };
}

/** A point on the rectangle `b` grown by `e`, at fraction `t` of its perimeter, counter-clockwise from the south-west corner (corners at quarters). */
function perimeter(b: { x0: number; y0: number; x1: number; y1: number }, e: number, t: number): XY {
  const x0 = b.x0 - e, y0 = b.y0 - e, x1 = b.x1 + e, y1 = b.y1 + e;
  const s = (((t % 1) + 1) % 1) * 4, side = Math.floor(s), f = s - side;
  switch (side) {
    case 0: return [x0 + (x1 - x0) * f, y0];
    case 1: return [x1, y0 + (y1 - y0) * f];
    case 2: return [x1 - (x1 - x0) * f, y1];
    default: return [x0, y1 - (y1 - y0) * f];
  }
}

/** Seeded pseudo-random numbers (the same ground every time). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

/** Pure: the blobs of the distant tree line (house frame centre, radii east/north/up), leaving a gap where the street runs out. */
export function treeLine(ctx: HouseContext): { centre: [number, number, number]; radii: [number, number, number] }[] {
  const b = ctx.site.bounds;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const st = ctx.site.zones.street.centreLine;
  const streetDir = Math.atan2(st[1][1] - st[0][1], st[1][0] - st[0][0]);
  const T = HORIZON.trees;
  const rand = lcg(97);
  const out: { centre: [number, number, number]; radii: [number, number, number] }[] = [];
  const near = (a: number, ref: number) => Math.abs(((a - ref + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < (T.gapDeg * Math.PI) / 180;
  const g = ctx.site.terrain.groundAt;
  const ground = g(Math.min(b.x1, Math.max(b.x0, cx)), Math.min(b.y1, Math.max(b.y0, cy)));
  for (let c = 0; c < T.clumps; c++) {
    const a = ((c + rand() * 0.6) / T.clumps) * Math.PI * 2;
    if (near(a, streetDir) || near(a, streetDir + Math.PI)) continue;
    const d = T.from + (T.to - T.from) * rand();
    const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
    for (let k = 0; k < T.perClump; k++) {
      const hgt = T.height[0] + (T.height[1] - T.height[0]) * rand();
      const r = hgt * (0.35 + 0.2 * rand());
      const ox = (rand() - 0.5) * 3 * r, oy = (rand() - 0.5) * 3 * r;
      out.push({ centre: [px + ox, py + oy, ground + hgt * 0.55], radii: [r, r, hgt * 0.5] });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ painting

export interface TerrainOptions {
  tier: Tier;
}

export interface TerrainScene {
  readonly group: THREE.Group;
  /** The heightfield mesh (receives shadows, is not cut by the section plane). */
  readonly mesh: THREE.Mesh;
  /** The ring of ground to the horizon and the tree line (no shadows). */
  readonly horizon: THREE.Group;
  /** Ground height at a house-frame point (kernel `groundAt`, graded). The one source of ground height. */
  groundAt(x: number, y: number): number;
  /** Repaints the ground texture (and the masks). */
  repaint(): void;
  dispose(): void;
}

/** Paints the ground layers into a canvas that covers `bounds` (north up). */
export function paintGround(ctx: HouseContext, canvas: HTMLCanvasElement, bounds: TerrainGeometryData["bounds"]): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  const px = (x: number) => ((x - bounds.x0) / w) * canvas.width;
  const py = (y: number) => (1 - (y - bounds.y0) / h) * canvas.height;
  const mpp = canvas.width / w; // pixels per metre
  const colorOf = (layer: GroundLayer) => {
    const c = new THREE.Color(generatedMaterial(ctx.style, layer.role, GROUND_ROLE_FALLBACK[layer.role]).color);
    if (layer.shade !== undefined) c.multiplyScalar(layer.shade);
    return `#${c.getHexString()}`;
  };
  const path = (pts: readonly XY[], closed: boolean) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    if (closed) g.closePath();
  };
  g.lineCap = g.lineJoin = "round";
  for (const layer of groundLayers(ctx)) {
    if (layer.kind === "fill") {
      path(layer.points, true);
      g.fillStyle = colorOf(layer);
      g.fill();
    } else {
      path(layer.points, layer.closed ?? false);
      g.strokeStyle = colorOf(layer);
      g.lineWidth = Math.max(1, (layer.width ?? 0.1) * mpp);
      g.stroke();
    }
  }
}

/** Roles of hard surfaces (no grass noise on them) and of beds (noise but no mowing). */
const HARD: ReadonlySet<GroundRole> = new Set(["pavement", "carriageway", "marking", "kerb", "path", "drive_paving", "terrace_paving", "deck", "pool_coping"]);
const BEDS: ReadonlySet<GroundRole> = new Set(["mulch", "gravel"]);

/**
 * Paints the detail masks into a canvas over `bounds`: red = the mown lawn of the plot (mowing stripes), green = natural
 * ground (grass noise), both 0 on hard surfaces and under the building.
 */
export function paintGroundMasks(ctx: HouseContext, canvas: HTMLCanvasElement, bounds: TerrainGeometryData["bounds"]): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  const px = (x: number) => ((x - bounds.x0) / w) * canvas.width;
  const py = (y: number) => (1 - (y - bounds.y0) / h) * canvas.height;
  const poly = (pts: readonly XY[], color: string) => {
    if (pts.length < 3) return;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  g.fillStyle = "#00ff00"; // natural ground everywhere
  g.fillRect(0, 0, canvas.width, canvas.height);
  poly(ctx.site.plot, "#ffff00"); // the plot is mown lawn
  for (const layer of groundLayers(ctx)) {
    if (layer.kind !== "fill") continue;
    if (HARD.has(layer.role)) poly(layer.points, "#000000");
    else if (BEDS.has(layer.role)) poly(layer.points, "#00ff00");
  }
  poly(ctx.derived.outline.polygons[0]?.pts ?? [], "#000000");
}

/**
 * Detail of the natural ground: the share of light a grass canopy returns compared with a flat surface of its colour, and the
 * saturation of sunlit grass (AgX desaturates bright mid greens; the lawn should read olive and alive, not grey), reached between
 * the radiance `litFrom` and `litTo` (three.js units before exposure): grass in shade or at dusk keeps its own saturation.
 */
export const GROUND_DETAIL = { canopy: 0.65, saturation: 1.35, litFrom: 0.04, litTo: 0.16 } as const;

/** GLSL: value noise and the detail of the ground (`groundDetail`), shared by the terrain and the horizon ring. */
const GROUND_PARS = /* glsl */ `
uniform sampler2D groundMask;
varying vec3 vGroundPos;
vec2 gGroundMask; // r: mown lawn, g: natural ground (read in the map chunk, used again after the lighting)
float gHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float gNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
`;
const GROUND_MAIN = () => /* glsl */ `
{
  vec2 gp = vGroundPos.xz;
  vec2 gm = texture2D( groundMask, vMapUv ).rg; // r: mown lawn, g: natural ground
  gGroundMask = gm;
  float gw = length( fwidth( gp ) ); // metres per pixel: fine detail fades out with distance
  float n1 = gNoise( gp / 7.0 ), n2 = gNoise( gp / 1.6 + 17.3 ), n3 = gNoise( gp / 0.13 + 5.1 );
  float fine = 1.0 - smoothstep( 0.03, 0.12, gw );
  float lum = 1.0 + gm.g * ( 0.09 * ( 2.0 * n1 - 1.0 ) + 0.05 * ( 2.0 * n2 - 1.0 ) + 0.04 * fine * ( 2.0 * n3 - 1.0 ) );
  // mowing stripes: 1.2 m bands along the house x axis (scene z is - house y), soft-edged, gone where they would alias
  float s = smoothstep( -0.3, 0.3, sin( - gp.y * 3.14159265 / 1.2 ) ) * 2.0 - 1.0;
  float stripes = 1.0 + 0.035 * s * gm.r * ( 1.0 - smoothstep( 0.08, 0.3, gw ) );
  // grass is a canopy that shades itself: natural ground reflects less than its paint colour says
  diffuseColor.rgb *= lum * stripes * mix( 1.0, ${GROUND_DETAIL.canopy.toFixed(2)}, gm.g );
  // the large patches drift a little towards yellow (dry) and blue-green (lush)
  diffuseColor.rgb *= mix( vec3( 1.0 ), mix( vec3( 0.97, 1.0, 1.03 ), vec3( 1.04, 1.01, 0.9 ), n1 ), gm.g * 0.8 );
}
`;
/**
 * GLSL after the lighting: sunlit grass keeps its saturation through the tone mapper (AgX desaturates bright mid greens), while
 * grass in shade or at dusk is left alone (it would turn a vivid dark green). The boost follows the radiance of the fragment.
 */
const GROUND_LIT = () => /* glsl */ `
{
  float gL = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
  float gK = gGroundMask.g * smoothstep( ${GROUND_DETAIL.litFrom.toFixed(2)}, ${GROUND_DETAIL.litTo.toFixed(2)}, gL );
  outgoingLight = max( vec3( 0.0 ), mix( vec3( gL ), outgoingLight, mix( 1.0, ${GROUND_DETAIL.saturation.toFixed(2)}, gK ) ) );
}
`;

/** Patches a ground material with the world-space detail (idempotent per material). */
function patchGroundMaterial(m: THREE.MeshStandardMaterial, mask: THREE.Texture): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.groundMask = { value: mask };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGroundPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${GROUND_PARS}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${GROUND_MAIN()}`)
      .replace("#include <opaque_fragment>", `${GROUND_LIT()}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "ground-detail-v3";
}

export function buildTerrain(ctx: HouseContext, opts: TerrainOptions): TerrainScene {
  const settings = TIER_SETTINGS[opts.tier];
  const data = terrainGeometry(ctx, settings.terrainStep);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const w = data.bounds.x1 - data.bounds.x0, h = data.bounds.y1 - data.bounds.y0;
  const canvas = document.createElement("canvas");
  canvas.width = settings.groundTexture;
  canvas.height = Math.max(2, Math.round((settings.groundTexture * h) / w));
  paintGround(ctx, canvas, data.bounds);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = settings.anisotropy;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = Math.max(2, Math.round(settings.groundTexture / 4));
  maskCanvas.height = Math.max(2, Math.round((maskCanvas.width * h) / w));
  paintGroundMasks(ctx, maskCanvas, data.bounds);
  const mask = new THREE.CanvasTexture(maskCanvas);
  mask.colorSpace = THREE.NoColorSpace;
  mask.wrapS = mask.wrapT = THREE.ClampToEdgeWrapping;

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
  patchGroundMaterial(material, mask);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "terrain";
  group.add(mesh);

  // ---- the horizon: the ring of ground (same material: the texture's edge colours smear outward) and the tree line
  const horizon = new THREE.Group();
  horizon.name = "horizon";
  const ring = horizonGeometry(ctx);
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ring.positions, 3));
  ringGeo.setAttribute("uv", new THREE.BufferAttribute(ring.uvs, 2));
  ringGeo.setIndex(new THREE.BufferAttribute(ring.indices, 1));
  ringGeo.computeVertexNormals();
  ringGeo.computeBoundingSphere();
  const ringMesh = new THREE.Mesh(ringGeo, material);
  ringMesh.name = "horizon_ground";
  ringMesh.receiveShadow = false;
  ringMesh.raycast = () => undefined;
  horizon.add(ringMesh);
  const blobs = treeLine(ctx);
  const blobGeo = new THREE.IcosahedronGeometry(1, 2);
  const foliage = new THREE.Color(generatedMaterial(ctx.style, "foliage_tree", "lawn").color).multiplyScalar(0.72);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const trees = new THREE.InstancedMesh(blobGeo, treeMat, Math.max(1, blobs.length));
  trees.name = "horizon_trees";
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), rand = lcg(31), c = new THREE.Color();
  blobs.forEach((bl, i) => {
    M.compose(new THREE.Vector3(bl.centre[0], bl.centre[2], -bl.centre[1]), Q, new THREE.Vector3(bl.radii[0], bl.radii[2], bl.radii[1]));
    trees.setMatrixAt(i, M);
    trees.setColorAt(i, c.copy(foliage).multiplyScalar(0.85 + 0.3 * rand()));
  });
  trees.count = blobs.length;
  trees.instanceMatrix.needsUpdate = true;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.computeBoundingSphere();
  trees.raycast = () => undefined;
  horizon.add(trees);
  group.add(horizon);

  return {
    group, mesh, horizon,
    groundAt: (x, y) => ctx.site.terrain.groundAt(x, y),
    repaint() {
      paintGround(ctx, canvas, data.bounds);
      paintGroundMasks(ctx, maskCanvas, data.bounds);
      texture.needsUpdate = true;
      mask.needsUpdate = true;
    },
    dispose() {
      geometry.dispose(); ringGeo.dispose(); blobGeo.dispose();
      texture.dispose(); mask.dispose(); material.dispose(); treeMat.dispose();
      trees.dispose();
      // the canvases are large: release their pixels now rather than at the next collection
      canvas.width = canvas.height = 0;
      maskCanvas.width = maskCanvas.height = 0;
      group.removeFromParent();
      group.clear();
    },
  };
}

/** Is a house-frame point inside the plot? (re-exported for the tests of the layers) */
export const insidePlot = (ctx: Pick<HouseContext, "site">, p: XY): boolean => pointInPolygon(p, ctx.site.plot);
