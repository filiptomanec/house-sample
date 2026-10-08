// Features of the house and the plot named by words (never ids) for framing checks: `subjects` of a shot (what its alt text
// talks about) and the orbit captions. A feature is a few sample points, a centre and (for a facade element) its outward
// normal. Pure; reads the derived model and the resolved site only.
import type { Derived } from "../../src/lib/model";
import type { SiteDerived } from "../../src/lib/model/site";
import type { Vec3 } from "./render-schema";

export interface Feature {
  word: string;
  /** Representative point (used for azimuths and caption checks). */
  center: Vec3;
  /** Sample points spread over the feature (visibility counts the share of them that is seen). */
  points: Vec3[];
  /** Outward normal of a facade element or roof plane; null for areas, trees and furniture that are seen from any side. */
  normal: Vec3 | null;
  /** Interior features are seen from inside the building. */
  interior: boolean;
  /** Id of the site element the feature is (a tree): its own crown does not hide it. Used for that exclusion only. */
  selfId?: string;
}

const OUTDOOR_WORDS = new Set(["terrace", "pool", "deck", "drive", "path", "paving"]);
const OPENING_WORDS = new Set(["entry", "garage", "slider", "window"]);

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const v3 = (x: number, y: number, z: number): Vec3 => [r4(x), r4(y), r4(z)];
const area = (r: readonly number[]): number => (r[2] - r[0]) * (r[3] - r[1]);

/** Points on a rectangle at height z: the centre and four points halfway to the corners. */
function rectPoints(r: readonly number[], z: number): Vec3[] {
  const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, hx = (r[2] - r[0]) / 4, hy = (r[3] - r[1]) / 4;
  return [v3(cx, cy, z), v3(cx - hx, cy - hy, z), v3(cx + hx, cy - hy, z), v3(cx + hx, cy + hy, z), v3(cx - hx, cy + hy, z)];
}

/**
 * Resolves a feature word. Outdoor types (the largest area of the type), opening kinds (the widest exterior opening of the
 * kind; `slider` is the main glazing), `louvres`, `pv` (the roof plane with the most modules), `terrace-corner` (the outer
 * post of the covered terrace), `gate-drive` / `gate-walk`, `pillar`, a tree species, a furniture type. Null when the model
 * has no such feature.
 */
export function resolveFeature(word: string, derived: Derived, site: Pick<SiteDerived, "trees" | "gates" | "pillars">, near?: Vec3): Feature | null {
  // several trees of a species or pieces of a furniture type: the one nearest to `near` (the camera), else the largest
  const d2 = (x: number, y: number): number => (near ? (x - near[0]) ** 2 + (y - near[1]) ** 2 : 0);
  if (OUTDOOR_WORDS.has(word)) {
    const list = derived.outdoor.filter((o) => o.type === word).sort((a, b) => area(b.rect) - area(a.rect));
    const o = list[0];
    if (!o) return null;
    const z = word === "pool" && o.pool ? o.pool.waterZ : o.top + 0.3;
    const rect = word === "pool" && o.pool ? o.pool.water : o.rect;
    const points = rectPoints(rect, z);
    return { word, center: points[0], points, normal: null, interior: false };
  }
  if (OPENING_WORDS.has(word)) {
    const o = derived.openings.filter((x) => x.exterior && x.kind === word && x.center && x.azimuth != null).sort((a, b) => b.w - a.w)[0];
    if (!o || !o.center || o.azimuth == null) return null;
    const a = (o.azimuth * Math.PI) / 180;
    const n: Vec3 = [r4(Math.sin(a)), r4(Math.cos(a)), 0];
    const along: Vec3 = [-n[1], n[0], 0];
    const wall = derived.walls.find((w) => w.id === o.wallId);
    const out = (wall?.t ?? derived.wall.ext) / 2 + 0.02;
    const c = o.center;
    const zMid = (o.sill + o.head) / 2;
    const at = (s: number, z: number): Vec3 => v3(c[0] + n[0] * out + along[0] * s, c[1] + n[1] * out + along[1] * s, z);
    const q = o.w * 0.35;
    return { word, center: at(0, zMid), points: [at(0, zMid), at(-q, zMid), at(q, zMid), at(-q, o.sill + 0.25 * (o.head - o.sill)), at(q, o.sill + 0.75 * (o.head - o.sill))], normal: n, interior: false };
  }
  if (word === "louvres") {
    // a wall of turning blades: seen from both sides (from the garden and from under the terrace roof), so no normal
    const sc = derived.screens[0];
    if (!sc) return null;
    const a = (sc.azimuth * Math.PI) / 180;
    const n: Vec3 = [r4(Math.sin(a)), r4(Math.cos(a)), 0];
    const pts: Vec3[] = [0.2, 0.5, 0.8].flatMap((f) => [0.35, 0.65].map((h) => {
      const s = sc.from + (sc.to - sc.from) * f;
      const z = sc.z0 + (sc.z1 - sc.z0) * h;
      return sc.orient === "v" ? v3(sc.at + n[0] * 0.1, s, z) : v3(s, sc.at + n[1] * 0.1, z);
    }));
    return { word, center: pts[2], points: pts, normal: null, interior: false };
  }
  if (word === "pv") {
    const byFace = new Map<string, Vec3[]>();
    for (const p of derived.pv.panels) byFace.set(p.face, [...(byFace.get(p.face) ?? []), p.center as Vec3]);
    const best = [...byFace.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) return null;
    const plane = derived.roofPlanes.find((f) => f.id === best[0]);
    const pts = best[1];
    const c = pts.reduce<Vec3>((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    const step = Math.max(1, Math.floor(pts.length / 6));
    return { word, center: v3(c[0], c[1], c[2]), points: [v3(c[0], c[1], c[2]), ...pts.filter((_, i) => i % step === 0).slice(0, 6)], normal: plane ? (plane.frame.n as Vec3) : null, interior: false };
  }
  if (word === "terrace-corner") {
    const t = derived.outdoor.find((o) => o.type === "terrace" && o.covered && o.posts.length);
    if (!t) return null;
    const [x, y] = t.posts[0];
    const pts = [0.4, 1.2, 2.0].map((z) => v3(x, y, t.top + z));
    return { word, center: pts[1], points: pts, normal: null, interior: false };
  }
  if (word === "gate-drive" || word === "gate-walk") {
    const g = site.gates.find((x) => x.access === (word === "gate-drive" ? "driveway" : "walkway"));
    if (!g) return null;
    const pts = g.posts.map((p) => v3(p.x, p.y, p.z + g.height * 0.6));
    const c = v3(g.center[0], g.center[1], g.z + g.height * 0.5);
    return { word, center: c, points: [c, ...pts], normal: null, interior: false };
  }
  if (word === "pillar") {
    const p = site.pillars[0];
    if (!p) return null;
    const c = v3(p.center[0], p.center[1], p.z + p.size[2] * 0.6);
    return { word, center: c, points: [c, v3(p.center[0], p.center[1], p.z + p.size[2] * 0.25)], normal: null, interior: false };
  }
  const tree = site.trees.filter((t) => t.species === word).sort((a, b) => d2(a.x, a.y) - d2(b.x, b.y) || b.crown - a.crown)[0];
  if (tree) {
    const zc = tree.z + tree.crownBase + (tree.height - tree.crownBase) / 2;
    const r = tree.crown / 4;
    const pts = [v3(tree.x, tree.y, zc), v3(tree.x - r, tree.y, zc), v3(tree.x + r, tree.y, zc), v3(tree.x, tree.y - r, zc), v3(tree.x, tree.y + r, zc)];
    return { word, center: pts[0], points: pts, normal: null, interior: false, selfId: tree.id };
  }
  const furniture = derived.furniture.filter((f) => f.type === word).sort((a, b) => d2(a.x, a.y) - d2(b.x, b.y) || b.w * b.d - a.w * a.d)[0];
  if (furniture) {
    const z = 0.45;
    const pts = rectPoints([furniture.rect[0], furniture.rect[1], furniture.rect[2], furniture.rect[3]], z);
    return { word, center: pts[0], points: pts, normal: null, interior: furniture.room !== null };
  }
  return null;
}

/** Azimuth (house frame, degrees) of a horizontal vector. */
export const azimuthOf = (dx: number, dy: number): number => (((Math.atan2(dx, dy) * 180) / Math.PI) % 360 + 360) % 360;

/**
 * The azimuth a feature faces, as the home page uses it for the orbit captions: the azimuth of its outward normal (a facade
 * element or a roof plane), or the azimuth of its centre seen from the orbit target (an area, a tree, furniture).
 */
export function facingAzimuth(f: Feature, target: Vec3): number {
  if (f.normal && Math.hypot(f.normal[0], f.normal[1]) > 1e-6) return azimuthOf(f.normal[0], f.normal[1]);
  return azimuthOf(f.center[0] - target[0], f.center[1] - target[1]);
}

/**
 * Deprecated (the captions use `facingAzimuth`). The orbit azimuth at which a feature is seen best: along its normal (for a facade element or roof plane, from `radius` away)
 * or straight from the orbit target (for an area).
 */
export function bestAzimuth(f: Feature, target: Vec3, radius: number): number {
  if (f.normal) {
    const h = Math.hypot(f.normal[0], f.normal[1]);
    if (h > 1e-6) return azimuthOf(f.center[0] + (f.normal[0] / h) * radius - target[0], f.center[1] + (f.normal[1] / h) * radius - target[1]);
  }
  return azimuthOf(f.center[0] - target[0], f.center[1] - target[1]);
}
