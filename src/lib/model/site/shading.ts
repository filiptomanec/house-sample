// Shading geometry of the surroundings: neighbour houses, trees, shrubs, hedges and fences as 3D occluders
// (boxes, convex solids, ellipsoids) in the house frame. Consumed later by the sun analysis (raycasts).
import { dist, type XY } from "./geometry";
import { resolveFences, resolveHedges, type AccessGeometry } from "./layout";
import {
  prismOf, roofSolid, segmentQuad, orientedRect, type EllipsoidOccluder, type Occluder, type SphereOccluder,
} from "./occluders";
import type { SiteModel } from "./siteSchema";
import type { Terrain } from "./terrain";

export interface ShadingOptions {
  /** Shrubs lower than this do not cast shadows worth tracing (m). Default 1.0. */
  minShrubHeight?: number;
  /** Longest straight piece of a hedge or fence prism (m); longer paths are split so slopes are followed. Default 3. */
  maxSegment?: number;
}

const splitPath = (path: readonly XY[], maxLen: number): [XY, XY][] => {
  const out: [XY, XY][] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / maxLen));
    for (let k = 0; k < n; k++) {
      out.push([[a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n]]);
    }
  }
  return out;
};

/** Crown of a tree or shrub: a sphere when width equals height, otherwise an ellipsoid. */
function crown(id: string, role: "tree" | "shrub", centre: [number, number, number], rxy: number, rz: number, extra: Pick<SphereOccluder, "extinction" | "evergreen">): SphereOccluder | EllipsoidOccluder {
  if (Math.abs(rxy - rz) < 1e-6) return { id, role, kind: "sphere", center: centre, radius: rxy, ...extra };
  return { id, role, kind: "ellipsoid", center: centre, radii: [rxy, rxy, rz], ...extra };
}

/** All shading solids around the house, standing on the graded terrain. */
export function buildOccluders(site: SiteModel, terrain: Terrain, access: AccessGeometry, opts: ShadingOptions = {}): Occluder[] {
  const minShrub = opts.minShrubHeight ?? 1;
  const maxSeg = opts.maxSegment ?? 3;
  const out: Occluder[] = [];
  const ground = terrain.groundAt;

  for (const t of site.trees) {
    const sp = site.species[t.species];
    const z0 = ground(t.pos[0], t.pos[1]);
    const base = t.crownBase ?? 0.3 * t.height;
    const h = t.height - base;
    out.push(crown(t.id, "tree", [t.pos[0], t.pos[1], z0 + base + h / 2], t.crown / 2, h / 2, { extinction: sp.extinction, evergreen: sp.evergreen }));
  }
  for (const s of site.shrubs) {
    if (s.height < minShrub) continue;
    const sp = site.species[s.species];
    const z0 = ground(s.pos[0], s.pos[1]);
    out.push(crown(s.id, "shrub", [s.pos[0], s.pos[1], z0 + s.height / 2], s.width / 2, s.height / 2, { extinction: sp.extinction, evergreen: sp.evergreen }));
  }
  for (const h of resolveHedges(site)) {
    const sp = site.species[h.species];
    for (const [a, b] of splitPath(h.path, maxSeg)) {
      const zLo = Math.min(ground(a[0], a[1]), ground(b[0], b[1]));
      const zHi = Math.max(ground(a[0], a[1]), ground(b[0], b[1]));
      out.push(prismOf(segmentQuad(a, b, h.width), zLo, zHi + h.height, { id: h.id, role: "hedge", extinction: sp.extinction, evergreen: sp.evergreen }));
    }
  }
  const fenceExtinction = { mesh_fence: { leafOn: 0.4, leafOff: 0.4 }, wood_fence: undefined, plinth_fence: undefined };
  for (const f of resolveFences(site, access)) {
    for (const part of f.parts) {
      for (const [a, b] of splitPath(part, maxSeg)) {
        const zLo = Math.min(ground(a[0], a[1]), ground(b[0], b[1]));
        const zHi = Math.max(ground(a[0], a[1]), ground(b[0], b[1]));
        out.push(prismOf(segmentQuad(a, b, f.thickness), zLo, zHi + f.height, { id: f.id, role: "fence", extinction: fenceExtinction[f.kind] }));
      }
    }
  }
  for (const nb of site.neighbours) {
    const { center, size, rotDeg, eaveHeight, roof } = nb.house;
    const walls = orientedRect(center, size[0], size[1], rotDeg);
    const zBase = Math.min(...walls.map((p) => ground(p[0], p[1])));
    out.push(prismOf(walls, zBase, zBase + eaveHeight, { id: nb.id, role: "neighbour_wall" }));
    out.push(roofSolid(center, size[0] + 2 * roof.overhang, size[1] + 2 * roof.overhang, rotDeg, zBase + eaveHeight, roof.pitchDeg, roof.kind, { id: nb.id, role: "neighbour_roof" }));
  }
  return out;
}
