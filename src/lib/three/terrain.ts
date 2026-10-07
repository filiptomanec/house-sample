// The ground of the scene, generated from model/site.json (docs/SITE.md). Not part of the GLB: one analytic ground serves
// the web scene, the print model, the walk and the planting, so they can never disagree.
//
//  * Height: `ctx.site.terrain.groundAt(x, y)` (kernel). The mesh is `terrain.grid(bbox, step)` triangulated by the
//    kernel's `gridToMesh` and mapped to the scene frame. The levelled plateau around the house is exactly flat there.
//  * Colour: ONE painted texture (a canvas, `TIER_SETTINGS[tier].groundTexture` px) in the house frame, so streets, fields,
//    beds, paved areas and the plot need no extra meshes, cannot z-fight and cost one draw call. Layers come from
//    `groundLayers(ctx)` (pure, tested); colours from `style.materials` / `style.generated` (data), never from literals.
//  * Inside the plateau the mesh sits `TERRAIN_DROP` below the plateau level, so the floors, paving and plinth of the
//    GLB (which are at the plateau level) always win the depth test; outside the plateau it follows the ground exactly.
import * as THREE from "three";
import type { XY } from "@/lib/model/site";
import type { HouseContext } from "./context";
import { generatedMaterial } from "./style";
import { TIER_SETTINGS, type Tier } from "./tier";

/** How far the terrain mesh is lowered under the plateau, metres (a render detail against z-fighting). */
export const TERRAIN_DROP = 0.02;

/** Colour roles of the painted ground. Resolved to `style.materials[role]` or `style.generated[role]` (fallback in the table). */
export type GroundRole =
  | "lawn" | "field" | "neighbour" | "verge" | "carriageway" | "marking" | "kerb"
  | "mulch" | "gravel" | "path" | "drive_paving" | "terrace_paving";

/** Fallback style role per ground role when `style.generated` has no entry. */
export const GROUND_ROLE_FALLBACK: Record<GroundRole, string> = {
  lawn: "lawn", field: "lawn", neighbour: "lawn", verge: "path", carriageway: "slab", marking: "plaster", kerb: "slab",
  mulch: "mulch", gravel: "gravel", path: "path", drive_paving: "drive_paving", terrace_paving: "terrace_paving",
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
}

/**
 * The layers in painting order: lawn over the whole domain, field beyond the field edge, the neighbours' plots, the street
 * (verge, carriageway, centre line), the plot's beds (`site.beds`, role = bed kind), the site's paved areas (`site.paved`,
 * role = `surface`), the aprons of the driveway and the walkway (`layout.access`, over the verge as well) and the
 * boundary as a thin line. Pure.
 */
export function groundLayers(ctx: HouseContext): GroundLayer[] {
  const { site, layout } = ctx;
  const b = site.bounds;
  const out: GroundLayer[] = [];
  const fill = (role: GroundRole, points: readonly XY[]) => { if (points.length >= 3) out.push({ kind: "fill", role, points }); };
  const line = (role: GroundRole, points: readonly XY[], width: number, closed = false) => { if (points.length >= 2) out.push({ kind: "line", role, points, width, closed }); };

  fill("lawn", [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]);
  fill("field", site.zones.field);
  for (const n of site.zones.neighbours) fill("neighbour", n.plot);
  const street = site.zones.street;
  fill("verge", street.verge);
  fill("carriageway", street.carriageway);
  // the kerb runs along the edge between the verge and the carriageway (the first edge of the carriageway ring)
  line("kerb", [street.carriageway[0], street.carriageway[1]], GROUND_LINE.kerb);
  line("marking", street.centreLine, GROUND_LINE.marking);
  for (const bed of site.model.beds) fill(bed.kind, bed.polygon);
  for (const p of site.model.paved) fill(p.surface, p.polygon);
  const a = layout.access;
  fill("drive_paving", a.driveApron);
  fill("drive_paving", a.driveVerge);
  fill("path", a.walkApron);
  fill("path", a.walkVerge);
  line("kerb", site.plot, GROUND_LINE.boundary, true);
  return out;
}

/** Widths of the painted lines, metres (drawing details). */
const GROUND_LINE = { kerb: 0.18, marking: 0.12, boundary: 0.06 } as const;

/** Mesh data of the terrain in the SCENE frame (Y-up). */
export interface TerrainGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  /** Texture coordinates 0..1: the ground texture maps `bounds` to the unit square (u east, v north). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** The domain covered (house frame): exactly the plot bounding box plus `site.model.domain.margin`. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Pure: grid of the kernel terrain at `step` metres, lowered by `TERRAIN_DROP * plateauWeight`, converted to the scene frame. */
export function terrainGeometry(ctx: HouseContext, step: number): TerrainGeometryData {
  const { terrain, bounds } = ctx.site;
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  const nx = Math.max(2, Math.ceil(w / step - 1e-9) + 1), ny = Math.max(2, Math.ceil(h / step - 1e-9) + 1);
  const sx = w / (nx - 1), sy = h / (ny - 1);
  const z = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds.x0 + i * sx, y = bounds.y0 + j * sy;
      z[j * nx + i] = terrain.groundAt(x, y) - TERRAIN_DROP * terrain.plateauWeight(x, y);
    }
  }
  const at = (i: number, j: number) => z[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const positions = new Float32Array(nx * ny * 3), normals = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = bounds.x0 + i * sx, y = bounds.y0 + j * sy;
      // house frame (x, y, z) -> scene frame (x, z, -y)
      positions[k * 3] = x; positions[k * 3 + 1] = z[k]; positions[k * 3 + 2] = -y;
      const gx = (at(i + 1, j) - at(i - 1, j)) / ((Math.min(i + 1, nx - 1) - Math.max(i - 1, 0)) * sx);
      const gy = (at(i, j + 1) - at(i, j - 1)) / ((Math.min(j + 1, ny - 1) - Math.max(j - 1, 0)) * sy);
      const l = Math.hypot(gx, gy, 1);
      normals[k * 3] = -gx / l; normals[k * 3 + 1] = 1 / l; normals[k * 3 + 2] = gy / l;
      uvs[k * 2] = i / (nx - 1); uvs[k * 2 + 1] = j / (ny - 1);
    }
  }
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let o = 0;
  for (let j = 0; j + 1 < ny; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // counter-clockwise seen from above (+Y in the scene)
      indices[o++] = a; indices[o++] = b; indices[o++] = d;
      indices[o++] = a; indices[o++] = d; indices[o++] = c;
    }
  }
  return { positions, normals, uvs, indices, bounds: { x0: bounds.x0, y0: bounds.y0, x1: bounds.x1, y1: bounds.y1 } };
}

export interface TerrainOptions {
  tier: Tier;
}

export interface TerrainScene {
  readonly group: THREE.Group;
  /** The heightfield mesh (receives shadows, is not cut by the section plane). */
  readonly mesh: THREE.Mesh;
  /** Ground height at a house-frame point (kernel `groundAt`). The one source of ground height. */
  groundAt(x: number, y: number): number;
  /** Repaints the ground texture, e.g. after a colour-scheme change. */
  repaint(): void;
  dispose(): void;
}

/** Seeded pseudo-random numbers for the speckle of the lawn texture (the same ground every time). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

/** Paints the ground layers into a canvas that covers `bounds` (north up). */
export function paintGround(ctx: HouseContext, canvas: HTMLCanvasElement, bounds: TerrainGeometryData["bounds"]): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const w = bounds.x1 - bounds.x0, h = bounds.y1 - bounds.y0;
  const px = (x: number) => ((x - bounds.x0) / w) * canvas.width;
  const py = (y: number) => (1 - (y - bounds.y0) / h) * canvas.height;
  const mpp = canvas.width / w; // pixels per metre
  const colorOf = (role: GroundRole) => generatedMaterial(ctx.style, role, GROUND_ROLE_FALLBACK[role]).color;
  const path = (pts: readonly XY[], closed: boolean) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    if (closed) g.closePath();
  };
  g.lineCap = g.lineJoin = "round";
  for (const layer of groundLayers(ctx)) {
    if (layer.kind === "fill") {
      path(layer.points, true);
      g.fillStyle = colorOf(layer.role);
      g.fill();
      if (layer.role === "lawn") speckle(g, canvas.width, canvas.height, mpp);
    } else {
      path(layer.points, layer.closed ?? false);
      g.strokeStyle = colorOf(layer.role);
      g.lineWidth = Math.max(1, (layer.width ?? 0.1) * mpp);
      g.stroke();
    }
  }
}

/** A fine two-tone speckle over the lawn, so a flat colour does not read as plastic. */
function speckle(g: CanvasRenderingContext2D, width: number, height: number, mpp: number): void {
  const rnd = lcg(7);
  const n = Math.round((width * height) / 90);
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.05)";
    const s = (0.04 + rnd() * 0.1) * mpp;
    g.fillRect(rnd() * width, rnd() * height, Math.max(1, s), Math.max(1, s * 1.6));
  }
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

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "terrain";
  group.add(mesh);

  return {
    group, mesh,
    groundAt: (x, y) => ctx.site.terrain.groundAt(x, y),
    repaint() { paintGround(ctx, canvas, data.bounds); texture.needsUpdate = true; },
    dispose() { geometry.dispose(); texture.dispose(); material.dispose(); group.removeFromParent(); },
  };
}
