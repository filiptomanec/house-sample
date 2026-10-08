// Outdoor slabs and the pool where the GLB does not hold them yet. The Blender builder makes every outdoor slab (terraces,
// deck, paving, drive and path ramps, the pool coping, liner and water) from `derived.outdoor[]`; a GLB built from an older
// model lacks the new areas, and the scene would show the terrain hole of the pool or bare lawn where the deck belongs. This
// module builds the missing pieces from the same derived data (grade planes, holes, `pool` polygons), so the web never shows
// a gap while the models are being rebuilt. With a current GLB it builds nothing. Pure planning (`outdoorFallback`) and a
// small builder; no house numbers.
import * as THREE from "three";
import type { DerivedOutdoor } from "@/lib/model";
import type { HouseContext } from "./context";
import { MeshBuilder } from "./meshBuilder";

export type Rect4 = [number, number, number, number];

/** A slab to build: role (material), plan rectangle, top plane (z = z0 + gx (x - ox) + gy (y - oy)) and the depth below the top. */
export interface SlabPiece {
  role: string;
  /** `derived.outdoor[].id` it belongs to (a join key). */
  id: string;
  rect: Rect4;
  plane: { z0: number; ox: number; oy: number; gx: number; gy: number };
  depth: number;
}

/** What the fallback builds: slabs, and for every pool missing from the GLB its liner box and water surface. */
export interface OutdoorFallback {
  slabs: SlabPiece[];
  pools: { id: string; water: Rect4; waterZ: number; floorZ: number; top: number }[];
}

/** Depth of a fallback slab below its top, metres (it reaches under the lowered terrain of the plateau). */
export const FALLBACK_SLAB_DEPTH = 0.25;

/** Pure: an axis-aligned rectangle minus axis-aligned holes, as disjoint rectangles (bands between the hole edges). */
export function rectMinusRects(r: Readonly<Rect4>, holes: readonly Readonly<Rect4>[]): Rect4[] {
  const hs = holes.map((h): Rect4 => [Math.max(r[0], h[0]), Math.max(r[1], h[1]), Math.min(r[2], h[2]), Math.min(r[3], h[3])]).filter((h) => h[2] > h[0] + 1e-9 && h[3] > h[1] + 1e-9);
  if (!hs.length) return [[...r] as Rect4];
  const ys = [...new Set([r[1], r[3], ...hs.flatMap((h) => [h[1], h[3]])])].sort((a, b) => a - b);
  const out: Rect4[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const y0 = ys[j], y1 = ys[j + 1];
    if (y1 - y0 < 1e-9) continue;
    const cuts = hs.filter((h) => h[1] < y1 - 1e-9 && h[3] > y0 + 1e-9).map((h) => [h[0], h[2]] as [number, number]).sort((a, b) => a[0] - b[0]);
    let x = r[0];
    for (const [a, b] of cuts) {
      if (a > x + 1e-9) out.push([x, y0, a, y1]);
      x = Math.max(x, b);
    }
    if (r[2] > x + 1e-9) out.push([x, y0, r[2], y1]);
  }
  return out;
}

const planeOf = (o: DerivedOutdoor) => o.grade.plane;

/**
 * Pure: the pieces the GLB lacks. An outdoor area counts as present when the GLB has a mesh with its id (`presentIds`); a pool
 * counts as present when the GLB has `water` (`presentRoles`). A missing area becomes its rect minus its holes; a missing pool
 * becomes its coping ring (outer minus water) at the coping top, plus a liner and a water surface.
 */
export function outdoorFallback(ctx: Pick<HouseContext, "derived">, presentIds: ReadonlySet<string>, presentRoles: ReadonlySet<string>): OutdoorFallback {
  const slabs: SlabPiece[] = [];
  const pools: OutdoorFallback["pools"] = [];
  for (const o of ctx.derived.outdoor) {
    if (o.pool) {
      if (presentRoles.has("water") && presentIds.has(o.id)) continue;
      const p = o.pool;
      const flat = { z0: p.copingTop, ox: 0, oy: 0, gx: 0, gy: 0 };
      for (const r of rectMinusRects(p.outer as Rect4, [p.water as Rect4])) slabs.push({ role: o.role, id: o.id, rect: r, plane: flat, depth: FALLBACK_SLAB_DEPTH });
      pools.push({ id: o.id, water: [...p.water] as Rect4, waterZ: p.waterZ, floorZ: p.floorZ, top: p.copingTop });
      continue;
    }
    if (presentIds.has(o.id)) continue;
    for (const r of rectMinusRects(o.rect as Rect4, o.holes as Rect4[])) slabs.push({ role: o.role, id: o.id, rect: r, plane: planeOf(o), depth: FALLBACK_SLAB_DEPTH });
  }
  return { slabs, pools };
}

/** Height of a slab's top plane at a plan point. */
export const slabTop = (s: Pick<SlabPiece, "plane">, x: number, y: number): number => s.plane.z0 + s.plane.gx * (x - s.plane.ox) + s.plane.gy * (y - s.plane.oy);

/** Builds the fallback meshes (scene frame), one mesh per role, with texture coordinates in metres. Materials come from `materialFor(role)`. */
export function buildOutdoorFallback(plan: OutdoorFallback, materialFor: (role: string) => THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = "outdoor_fallback";
  const builders = new Map<string, MeshBuilder>();
  const mb = (role: string) => { let b = builders.get(role); if (!b) { b = new MeshBuilder(); builders.set(role, b); } return b; };
  for (const s of plan.slabs) {
    const [x0, y0, x1, y1] = s.rect;
    const ring: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const tops = ring.map(([x, y]) => slabTop(s, x, y));
    const b = mb(s.role);
    b.prism(ring, (i) => tops[i] - s.depth, (i) => tops[i]);
  }
  for (const p of plan.pools) {
    const [x0, y0, x1, y1] = p.water;
    const liner = mb("pool_liner");
    // the basin seen from inside: floor and four walls facing in (counter-clockwise seen from inside the water)
    const z0 = p.floorZ, z1 = p.top;
    liner.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    liner.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]);
    liner.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [[y0, z0], [y0, z1], [y1, z1], [y1, z0]]);
    liner.quad([x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0], [[x1, z0], [x1, z1], [x0, z1], [x0, z0]]);
    liner.quad([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], [[y1, z0], [y1, z1], [y0, z1], [y0, z0]]);
    mb("water").quad([x0, y0, p.waterZ], [x1, y0, p.waterZ], [x1, y1, p.waterZ], [x0, y1, p.waterZ], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  }
  for (const [role, b] of builders) {
    if (!b.triangleCount) continue;
    const mesh = new THREE.Mesh(b.toGeometry(), materialFor(role));
    mesh.name = `fallback_${role}`;
    mesh.userData.role = role;
    mesh.userData.fallback = true;
    group.add(mesh);
  }
  return group;
}
