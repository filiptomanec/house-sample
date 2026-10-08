// What stands around and at the edge of the plot: the neighbours' houses, the fence with its gates and the pillar, the bin
// pad, the kerb of the street with its dropped crossings. Generated from model/site.json through the kernel layout
// (`ctx.layout`: fences with posts and slat spec, gates with posts, leaf and park span or swing arc, pillars; the street from
// `ctx.site.zones` and `ctx.layout.access`), standing on the graded ground. The painted ground (street, verge, field) is in
// terrain.ts; trees and shrubs are in vegetation.ts.
//
//  * Slat fence (`kind: "slat_fence"`): posts (one InstancedMesh), a precast plinth and horizontal (or vertical) boards per span
//    between posts that follow the ground at each post (one merged mesh each). Gates are closed: a steel frame with the same
//    boards, the sliding leaf with its counterbalance tail on the plot side of the fence, the swing leaf in the fence line.
//  * The pillar beside the walk gate carries the items of the data (`items`): meter box, mailbox, intercom, a backlit house-number
//    plate (no number: a light plate) and a light, on its street face.
//  * Neighbour houses: walls with a painted window pattern and a plinth band (texture coordinates in metres), a hip, gable or
//    flat roof, a chimney.
//  * Cheap: about ten draw calls in total; shadows only on the "high" tier.
import * as THREE from "three";
import { DROPPED_KERB_REVEAL, projectToPolyline, type ResolvedFence, type ResolvedGate, type ResolvedPillar, type XY } from "@/lib/model/site";
import { disposeTree } from "./dispose";
import type { HouseContext } from "./context";
import { MeshBuilder } from "./meshBuilder";
import { generatedMaterial } from "./style";
import type { Tier } from "./tier";

export interface SurroundingsOptions {
  tier: Tier;
}

export interface SurroundingsScene {
  readonly group: THREE.Group;
  /** Neighbour houses: walls with windows, a roof from `neighbours[].house.roof` (`kind` hip | gable | flat, pitch, overhang), a chimney. */
  readonly neighbours: THREE.Group;
  /** Fences (by `kind`), gates, the pillar, the bin pad and the kerb. */
  readonly fences: THREE.Group;
  /** Colour of the fence and gate boards (they follow the timber look of the house). */
  setWood(color: THREE.ColorRepresentation): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Drawing details of the generated parts, metres (products and conventions, not the house). */
export const SURROUNDINGS = {
  /** Walls of a neighbour house sink this far into the ground (the plot is sloped). */
  wallSink: 0.4,
  /** Thickness of a flat roof slab. */
  flatRoofThickness: 0.25,
  /** Longest piece of a legacy fence; shorter pieces follow the slope. */
  fenceStep: 2.0,
  /** Height of the concrete plinth of a plinth fence. */
  plinthHeight: 0.35,
  /** The lower edge of a fence, a post or a pillar sinks this deep into the ground. */
  fenceSink: 0.15,
  /** Posts of a mesh fence. */
  postSize: 0.06,
  postSpacing: 2.5,
  /** Cell of the mesh pattern. */
  meshCell: 0.12,
  /** Gate leaves: steel frame tube, the gap under the leaf, how far the gate posts rise above the leaf. */
  gateTube: 0.06,
  gateClearance: 0.05,
  gatePostRise: 0.05,
  /** Boards of a gate that stands in no slat fence (otherwise the fence's own slat spec is used). */
  gateSlat: { orient: "h", board: 0.09, gap: 0.015, depth: 0.02 } as const,
  /** Neighbour facades: one window of `window` (width, height) every `windowPitch` along the wall, sill at `windowSill`; plinth band height. */
  window: [1.2, 1.4] as const,
  windowPitch: 3,
  windowSill: 0.95,
  storey: 3,
  plinthBand: 0.4,
  /** Chimney: plan size, height above the ridge, position along the ridge as a share of the half ridge length. */
  chimney: { size: 0.6, rise: 0.8, along: 0.45 },
  /** Wheelie bins on a bin pad: plan size and height, lid overhang and thickness, the most bins on one pad, the room each takes. */
  bin: { size: [0.58, 0.73] as const, height: 1.07, lid: 0.03, lidThickness: 0.04, max: 3, room: 0.72 },
} as const;

/** Items of a pillar on its street face, as shares of the pillar's width and height (a product layout, not the house). */
export const PILLAR_LAYOUT: Record<ResolvedPillar["items"][number], { u: [number, number]; v: [number, number]; proud: number; glow?: true }> = {
  "meter-box": { u: [0.18, 0.82], v: [0.12, 0.5], proud: 0.006 },
  mailbox: { u: [0.14, 0.62], v: [0.56, 0.74], proud: 0.012 },
  intercom: { u: [0.7, 0.86], v: [0.6, 0.72], proud: 0.012 },
  "house-number": { u: [0.3, 0.7], v: [0.8, 0.88], proud: 0.008, glow: true },
  light: { u: [0.42, 0.58], v: [0.94, 0.985], proud: 0.03, glow: true },
};

type Ring = [number, number][];

/** Rectangle `size` centred at `center`, turned by `rotDeg` counter-clockwise, grown by `grow` on every side (counter-clockwise ring). */
export function rotatedRect(center: XY, size: readonly [number, number], rotDeg: number, grow = 0): Ring {
  const a = size[0] / 2 + grow, b = size[1] / 2 + grow;
  const c = Math.cos((rotDeg * Math.PI) / 180), s = Math.sin((rotDeg * Math.PI) / 180);
  return ([[-a, -b], [a, -b], [a, b], [-a, b]] as const).map(([x, y]): [number, number] => [center[0] + x * c - y * s, center[1] + x * s + y * c]);
}

type NeighbourModel = HouseContext["site"]["model"]["neighbours"][number];

/** Height of the ridge above the wall top of a hip or gable roof over a house with half sizes a and b: the roof rises over the shorter span. */
export const ridgeRise = (pitchDeg: number, a: number, b: number): number => Math.min(a, b) * Math.tan((pitchDeg * Math.PI) / 180);

/**
 * Walls and roof of one neighbour house into two builders. The roof surface passes through the top of the walls; the
 * overhang continues it downwards, so the eave lies `overhang * tan(pitch)` below the wall top. Walls carry texture
 * coordinates in storeys: u along the wall (metres / window pitch), v height above the house's ground (metres / storey).
 */
function neighbourHouse(ctx: HouseContext, nb: NeighbourModel, walls: MeshBuilder, roofs: MeshBuilder): void {
  const { center, size, rotDeg, eaveHeight, roof } = nb.house;
  const ground = ctx.site.terrain.groundAt;
  const ring = rotatedRect(center, size, rotDeg);
  const base = Math.min(...ring.map((p) => ground(p[0], p[1]))) - SURROUNDINGS.wallSink;
  const g0 = ground(center[0], center[1]);
  const top = g0 + eaveHeight;
  const V = (z: number) => (z - g0) / SURROUNDINGS.storey;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const p = ring[i], q = ring[(i + 1) % 4];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const u0 = s / SURROUNDINGS.windowPitch, u1 = (s + len) / SURROUNDINGS.windowPitch;
    walls.quad([p[0], p[1], base], [q[0], q[1], base], [q[0], q[1], top], [p[0], p[1], top], [[u0, V(base)], [u1, V(base)], [u1, V(top)], [u0, V(top)]]);
    s += len;
  }
  const flatUv: [number, number][] = [[0.5, 0.99], [0.5, 0.99], [0.5, 0.99]];
  walls.tri([ring[0][0], ring[0][1], top], [ring[1][0], ring[1][1], top], [ring[2][0], ring[2][1], top], flatUv);
  walls.tri([ring[0][0], ring[0][1], top], [ring[2][0], ring[2][1], top], [ring[3][0], ring[3][1], top], flatUv);

  const a = size[0] / 2, b = size[1] / 2, o = roof.overhang;
  const cos = Math.cos((rotDeg * Math.PI) / 180), sin = Math.sin((rotDeg * Math.PI) / 180);
  const W = (lx: number, ly: number, z: number): [number, number, number] => [center[0] + lx * cos - ly * sin, center[1] + lx * sin + ly * cos, z];
  if (roof.kind === "flat") {
    roofs.prism(rotatedRect(center, size, rotDeg, o), () => top, () => top + SURROUNDINGS.flatRoofThickness);
    return;
  }
  const t = Math.tan((roof.pitchDeg * Math.PI) / 180);
  const A = a + o, B = b + o;
  const zEave = top - o * t, zRidge = top + ridgeRise(roof.pitchDeg, a, b);
  const e = [W(-A, -B, zEave), W(A, -B, zEave), W(A, B, zEave), W(-A, B, zEave)] as const;
  const long = a >= b; // the ridge runs along the longer side
  // a chimney through the ridge, at a share of the half ridge length from the middle
  const half = roof.kind === "hip" ? Math.abs(a - b) : long ? a : b;
  const cs = SURROUNDINGS.chimney;
  const along = half * cs.along;
  const cc = long ? W(along, 0, 0) : W(0, along, 0);
  const chimneyRing = rotatedRect([cc[0], cc[1]], [cs.size, cs.size], rotDeg);
  for (let i = 0; i < 4; i++) {
    const p = chimneyRing[i], q = chimneyRing[(i + 1) % 4];
    walls.quad([p[0], p[1], zEave], [q[0], q[1], zEave], [q[0], q[1], zRidge + cs.rise], [p[0], p[1], zRidge + cs.rise], [[0.5, 0.99], [0.5, 0.99], [0.5, 0.99], [0.5, 0.99]]);
  }
  roofs.prism(chimneyRing, () => zRidge + cs.rise, () => zRidge + cs.rise + 0.08);
  if (roof.kind === "hip") {
    const h = Math.abs(a - b);
    const r0 = long ? W(-h, 0, zRidge) : W(0, -h, zRidge), r1 = long ? W(h, 0, zRidge) : W(0, h, zRidge);
    if (long) {
      roofs.quad(e[0], e[1], r1, r0); roofs.tri(e[1], e[2], r1); roofs.quad(e[2], e[3], r0, r1); roofs.tri(e[3], e[0], r0);
    } else {
      roofs.quad(e[1], e[2], r1, r0); roofs.tri(e[2], e[3], r1); roofs.quad(e[3], e[0], r0, r1); roofs.tri(e[0], e[1], r0);
    }
    return;
  }
  // gable: two planes over the ridge, the rakes overhang by the same amount, the ends are walls above the wall top
  const gUv: [number, number][] = [[0.5, 0.99], [0.5, 0.99], [0.5, 0.99]];
  if (long) {
    const r0 = W(-A, 0, zRidge), r1 = W(A, 0, zRidge);
    roofs.quad(e[0], e[1], r1, r0); roofs.quad(e[2], e[3], r0, r1);
    walls.tri(W(a, -b, top), W(a, b, top), W(a, 0, zRidge), gUv);
    walls.tri(W(-a, b, top), W(-a, -b, top), W(-a, 0, zRidge), gUv);
  } else {
    const r0 = W(0, -B, zRidge), r1 = W(0, B, zRidge);
    roofs.quad(e[1], e[2], r1, r0); roofs.quad(e[3], e[0], r0, r1);
    walls.tri(W(-a, -b, top), W(a, -b, top), W(0, -b, zRidge), gUv);
    walls.tri(W(a, b, top), W(-a, b, top), W(0, b, zRidge), gUv);
  }
}

/** The walls and the roofs of all neighbour houses as two builders (scene frame). Pure: no GL context is needed. */
export function neighbourMeshes(ctx: HouseContext): { walls: MeshBuilder; roofs: MeshBuilder } {
  const walls = new MeshBuilder(), roofs = new MeshBuilder();
  for (const nb of ctx.site.model.neighbours) neighbourHouse(ctx, nb, walls, roofs);
  return { walls, roofs };
}

/** Pieces of a polyline no longer than `step`, each as [start, end]. */
export function splitPolyline(path: readonly XY[], step: number): [XY, XY][] {
  const out: [XY, XY][] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step - 1e-9));
    for (let k = 0; k < n; k++) {
      out.push([
        [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n],
        [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n],
      ]);
    }
  }
  return out;
}

/** A closed board between two points of a line: a box of thickness `t` whose lower and upper edges are given per end. */
function board(mb: MeshBuilder, a: XY, b: XY, t: number, bottom: (p: XY) => number, top: (p: XY) => number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (t / 2), ny = (dx / len) * (t / 2);
  // counter-clockwise from above: right side a -> b, then the left side b -> a
  const ring: Ring = [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
  const end = [a, b, b, a] as const;
  mb.prism(ring, (i) => bottom(end[i]), (i) => top(end[i]));
}

/** One panel of mesh between two points, with texture coordinates in metres along the line and up. */
function panel(mb: MeshBuilder, a: XY, b: XY, s0: number, bottom: (p: XY) => number, top: (p: XY) => number): void {
  const s1 = s0 + Math.hypot(b[0] - a[0], b[1] - a[1]);
  mb.quad([a[0], a[1], bottom(a)], [b[0], b[1], bottom(b)], [b[0], b[1], top(b)], [a[0], a[1], top(a)],
    [[s0, bottom(a)], [s1, bottom(b)], [s1, top(b)], [s0, top(a)]]);
}

/** A square post of side `size` at `p` from `z0` to `z1`. */
function post(mb: MeshBuilder, p: XY, size: number, z0: number, z1: number): void {
  const h = size / 2;
  mb.prism([[p[0] - h, p[1] - h], [p[0] + h, p[1] - h], [p[0] + h, p[1] + h], [p[0] - h, p[1] + h]], () => z0, () => z1);
}

/** The spans of a slat fence part between its posts: every segment cut into equal pieces of at most `spacing` (as the kernel places the posts). Pure. */
export function fenceSpans(part: readonly XY[], spacing: number): [XY, XY][] {
  return splitPolyline(part, spacing);
}

/** Heights of the boards of a slat fence above the ground: [bottom, top] of each board, from the plinth up to the fence height. Pure. */
export function boardRows(fence: Pick<ResolvedFence, "height" | "plinthHeight" | "slat">): [number, number][] {
  const slat = fence.slat;
  if (!slat) return [];
  const from = fence.plinthHeight ?? 0, pitch = slat.board + slat.gap;
  const n = Math.max(0, Math.floor((fence.height - from + slat.gap) / pitch + 1e-9));
  return Array.from({ length: n }, (_, k) => [from + k * pitch, from + k * pitch + slat.board] as [number, number]);
}

/** The leaf of a gate in its closed position: start and end on the leaf's line (house frame), the boarded part and the tail. Pure. */
export function gateLeaf(g: ResolvedGate): { boarded: [XY, XY]; tail: [XY, XY] | null; offset: number } {
  const k = g.side === "+" ? 1 : -1;
  const offset = g.park?.offset ?? 0;
  const at = (s: number): XY => [g.center[0] + g.along[0] * s + g.inward[0] * offset, g.center[1] + g.along[1] * s + g.inward[1] * offset];
  const boarded: [XY, XY] = [at(-k * (g.leaf / 2)), at(k * (g.leaf / 2))];
  const tail: [XY, XY] | null = g.tail > 0 ? [at(k * (g.leaf / 2)), at(k * (g.leaf / 2 + g.tail))] : null;
  return { boarded, tail, offset };
}

/** One piece of the kerb along the carriageway edge: arc lengths along the edge line and its height above the road. */
export interface KerbPiece {
  from: XY;
  to: XY;
  height: number;
}

/**
 * The kerb along the carriageway edge inside the domain: full height (`street.kerbHeight`), dropped to `DROPPED_KERB_REVEAL`
 * where the drive and the walk cross it (`layout.access.driveKerb`, `walkKerb`). Pure.
 */
export function kerbPieces(ctx: Pick<HouseContext, "site" | "layout">): KerbPiece[] {
  const street = ctx.site.zones.street;
  const b = ctx.site.bounds;
  const kerbWidth = ctx.site.model.street.kerbWidth ?? 0.15;
  const [p0, p1] = [street.carriageway[0], street.carriageway[1]];
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const d: XY = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
  // the kerb strip lies on the verge side of the edge: towards the plot
  const n: XY = [d[1], -d[0]];
  const side = (street.verge[0][0] - p0[0]) * n[0] + (street.verge[0][1] - p0[1]) * n[1] > 0 ? 1 : -1;
  const mid = kerbWidth / 2 * side;
  const at = (s: number): XY => [p0[0] + d[0] * s + n[0] * mid, p0[1] + d[1] * s + n[1] * mid];
  // the part of the edge inside the domain
  let s0 = Infinity, s1 = -Infinity;
  for (let s = 0; s <= len; s += 0.5) {
    const q = at(s);
    if (q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.y0 && q[1] <= b.y1) { s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
  }
  if (!(s1 > s0)) return [];
  const drops = [ctx.layout.access.driveKerb, ctx.layout.access.walkKerb]
    .filter((poly) => poly.length >= 3)
    .map((poly) => {
      const ss = poly.map((q) => projectToPolyline(q, [p0, p1]).s);
      return [Math.min(...ss), Math.max(...ss)] as [number, number];
    })
    .sort((x, y) => x[0] - y[0]);
  const full = ctx.site.model.street.kerbHeight;
  const out: KerbPiece[] = [];
  let s = s0;
  for (const [a, c] of drops) {
    if (c <= s0 || a >= s1) continue;
    if (a > s + 1e-6) out.push({ from: at(s), to: at(a), height: full });
    out.push({ from: at(Math.max(a, s0)), to: at(Math.min(c, s1)), height: DROPPED_KERB_REVEAL });
    s = Math.min(c, s1);
  }
  if (s1 > s + 1e-6) out.push({ from: at(s), to: at(s1), height: full });
  return out;
}

/** Plan rectangles of the wheelie bins on the bin pads (`site.paved` of kind "bins"), centre and size, turned along the pad. Pure. */
export function binsOnPads(ctx: Pick<HouseContext, "site">): { center: XY; size: readonly [number, number]; rotDeg: number }[] {
  const out: { center: XY; size: readonly [number, number]; rotDeg: number }[] = [];
  const B = SURROUNDINGS.bin;
  for (const pad of ctx.site.model.paved.filter((p) => p.kind === "bins")) {
    const poly = pad.polygon;
    // the longest edge gives the row direction
    let best = 0, a: XY = poly[0], c: XY = poly[1];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > best) { best = l; a = p; c = q; }
    }
    const n = Math.max(1, Math.min(B.max, Math.floor(best / B.room)));
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const d: XY = [(c[0] - a[0]) / best, (c[1] - a[1]) / best];
    const rotDeg = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * B.room;
      out.push({ center: [cx + d[0] * off, cy + d[1] * off], size: B.size, rotDeg });
    }
  }
  return out;
}

/** The window pattern of the neighbours' facades: one storey (v 0..1) of one window pitch (u 0..1), white wall, dark glass, a plinth band. */
function windowTexture(): THREE.CanvasTexture {
  const S = SURROUNDINGS, px = 96;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const g = canvas.getContext("2d");
  if (g) {
    const m = px / S.windowPitch, mv = px / S.storey;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, px, px);
    g.fillStyle = "#454b52"; // glass in shade, multiplied by the wall colour
    const w = S.window[0] * m, h = S.window[1] * mv;
    g.fillRect((px - w) / 2, px - (S.windowSill * mv + h), w, h);
    g.fillStyle = "#9a9a96"; // plinth band
    g.fillRect(0, px - S.plinthBand * mv, px, S.plinthBand * mv);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildSurroundings(ctx: HouseContext, opts: SurroundingsOptions): SurroundingsScene {
  const high = opts.tier === "high";
  const group = new THREE.Group();
  group.name = "surroundings";
  const material = (role: string, fallback: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const m = generatedMaterial(ctx.style, role, fallback);
    return new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metallic, side: THREE.DoubleSide, ...extra });
  };
  const add = (into: THREE.Group, parts: [string, MeshBuilder, THREE.Material][], cast: boolean) => {
    for (const [name, mb, mat] of parts) {
      if (!mb.triangleCount) { mat.dispose(); continue; }
      const mesh = new THREE.Mesh(mb.toGeometry(), mat);
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      into.add(mesh);
    }
  };

  // ---- neighbour houses (a few draw calls, they shade the plot in the evening)
  const neighbours = new THREE.Group();
  neighbours.name = "neighbours";
  const { walls, roofs } = neighbourMeshes(ctx);
  const facade = windowTexture();
  add(neighbours, [
    ["neighbour_walls", walls, material("neighbour_wall", "plaster", { map: facade, side: THREE.FrontSide })],
    ["neighbour_roofs", roofs, material("neighbour_roof", "roof_tile")],
  ], true);
  if (!walls.triangleCount) facade.dispose();

  // ---- the boundary: fences by kind, gates, pillar, bins, kerb
  const fences = new THREE.Group();
  fences.name = "fences";
  const ground = ctx.site.terrain.groundAt;
  const G = (p: XY) => ground(p[0], p[1]);
  const S = SURROUNDINGS;
  const lowEdge = (p: XY) => G(p) - S.fenceSink;
  const plinth = new MeshBuilder(), wood = new MeshBuilder(), metal = new MeshBuilder(), mesh = new MeshBuilder(), legacyPosts = new MeshBuilder();
  const glow = new MeshBuilder(), kerb = new MeshBuilder(), bins = new MeshBuilder();
  const slatPosts: { p: XY; size: number; z0: number; z1: number }[] = [];
  const boards = (mb: MeshBuilder, a: XY, b: XY, depth: number, rows: [number, number][], base: (p: XY) => number) => {
    for (const [lo, hi] of rows) board(mb, a, b, depth, (p) => base(p) + lo, (p) => base(p) + hi);
  };
  for (const f of ctx.layout.fences) {
    const upper = (p: XY) => G(p) + f.height;
    if (f.kind === "slat_fence" && f.slat) {
      const ph = f.plinthHeight ?? 0;
      const rows = boardRows(f);
      for (const part of f.parts) {
        for (const [a, b] of fenceSpans(part, f.postSpacing ?? S.postSpacing)) {
          if (ph > 0) board(plinth, a, b, f.thickness, lowEdge, (p) => G(p) + ph);
          if (f.slat.orient === "h") boards(wood, a, b, f.slat.depth, rows, G);
          else {
            // vertical slats: boards across the span, `board` wide, `gap` apart
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]), pitch = f.slat.board + f.slat.gap;
            const n = Math.max(1, Math.floor(len / pitch));
            for (let i = 0; i < n; i++) {
              const t0 = (i * pitch + f.slat.gap / 2) / len, t1 = Math.min(1, t0 + f.slat.board / len);
              const pa: XY = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], pb: XY = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
              board(wood, pa, pb, f.slat.depth, (p) => G(p) + ph, upper);
            }
          }
        }
      }
      for (const p of f.posts) slatPosts.push({ p, size: f.postSize ?? S.postSize, z0: G(p) - S.fenceSink, z1: G(p) + f.height });
      continue;
    }
    for (const part of f.parts) {
      let s = 0;
      for (const [a, b] of splitPolyline(part, S.fenceStep)) {
        if (f.kind === "plinth_fence") {
          const ph = (p: XY) => G(p) + S.plinthHeight;
          board(plinth, a, b, f.thickness, lowEdge, ph);
          board(wood, a, b, f.thickness * 0.6, ph, upper);
        } else if (f.kind === "wood_fence") {
          board(wood, a, b, f.thickness, lowEdge, upper);
        } else {
          panel(mesh, a, b, s, lowEdge, upper);
          for (const p of [a, b]) post(legacyPosts, p, S.postSize, lowEdge(p), upper(p) + 0.05);
        }
        s += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
  }

  // gates, closed: a steel frame with the boards of the fence; the sliding leaf with its tail on the plot side
  const fenceOf = (g: ResolvedGate) => ctx.layout.fences.find((f) => f.id === g.fence);
  for (const g of ctx.layout.gates) {
    const f = fenceOf(g);
    const leaf = gateLeaf(g);
    const z0 = Math.min(G(leaf.boarded[0]), G(leaf.boarded[1])) + S.gateClearance;
    const z1 = G(g.center) + g.height;
    const tube = S.gateTube, depth = g.thickness;
    const flat = (z: number) => () => z;
    const frame = (a: XY, b: XY, bottomOnly = false) => {
      board(metal, a, b, depth, flat(z0), flat(z0 + tube));
      if (bottomOnly) return;
      board(metal, a, b, depth, flat(z1 - tube), flat(z1));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
      board(metal, a, [a[0] + dx * tube, a[1] + dy * tube], depth, flat(z0), flat(z1));
      board(metal, [b[0] - dx * tube, b[1] - dy * tube], b, depth, flat(z0), flat(z1));
    };
    frame(leaf.boarded[0], leaf.boarded[1]);
    // the boards: the fence's rows between the rails (or evenly spaced rows when the gate stands in no slat fence)
    const slat = f?.slat ?? S.gateSlat;
    const pitch = slat.board + slat.gap;
    const inner = [z0 + tube, z1 - tube];
    for (let z = inner[0] + slat.gap; z + slat.board <= inner[1] + 1e-9; z += pitch) board(wood, leaf.boarded[0], leaf.boarded[1], slat.depth, flat(z), flat(z + slat.board));
    // the counterbalance tail of a sliding leaf: its bottom beam and a brace
    if (leaf.tail) {
      frame(leaf.tail[0], leaf.tail[1], true);
      board(metal, leaf.tail[0], leaf.tail[1], depth * 0.6, flat(z0 + tube), flat(z0 + tube + 0.12));
    }
    for (const p of g.posts) post(metal, p, g.postSize, G(p) - S.fenceSink, z1 + S.gatePostRise);
  }

  // the pillar and its items on the street face
  for (const pl of ctx.layout.pillars) pillar(pl);
  function pillar(pl: ResolvedPillar) {
    const [w, d, h] = pl.size;
    const z0 = Math.min(...pl.footprint.map(G)) - S.fenceSink, zg = G(pl.center);
    plinth.prism(pl.footprint as Ring, () => z0, () => zg + h);
    // the street face looks away from the plot
    const out: XY = [-pl.inward[0], -pl.inward[1]];
    const faceC: XY = [pl.center[0] + out[0] * (d / 2), pl.center[1] + out[1] * (d / 2)];
    for (const item of pl.items) {
      const L = PILLAR_LAYOUT[item];
      if (!L) continue;
      // along the face: u from the left end looking at it from the street (the along vector points to the right of the viewer or left; the layout is symmetric enough)
      const ua = (L.u[0] - 0.5) * w, ub = (L.u[1] - 0.5) * w;
      const pa: XY = [faceC[0] + pl.along[0] * ua, faceC[1] + pl.along[1] * ua];
      const pb: XY = [faceC[0] + pl.along[0] * ub, faceC[1] + pl.along[1] * ub];
      const shift = (p: XY, k: number): XY => [p[0] + out[0] * k, p[1] + out[1] * k];
      const target = L.glow ? glow : metal;
      board(target, shift(pa, L.proud / 2), shift(pb, L.proud / 2), L.proud, () => zg + L.v[0] * h, () => zg + L.v[1] * h);
    }
  }

  // wheelie bins on the bin pads
  for (const bin of binsOnPads(ctx)) {
    const zb = G(bin.center);
    bins.prism(rotatedRect(bin.center, bin.size, bin.rotDeg), () => zb, () => zb + S.bin.height - S.bin.lidThickness);
    bins.prism(rotatedRect(bin.center, bin.size, bin.rotDeg, S.bin.lid), () => zb + S.bin.height - S.bin.lidThickness, () => zb + S.bin.height);
  }

  // the kerb: full stones along the carriageway, dropped where the drive and the walk cross
  const kerbWidth = ctx.site.model.street.kerbWidth ?? 0.15;
  for (const k of kerbPieces(ctx)) {
    for (const [a, b] of splitPolyline([k.from, k.to], S.fenceStep)) board(kerb, a, b, kerbWidth, (p) => G(p) - 0.1, (p) => G(p) + k.height);
  }

  const meshAlpha = gridAlphaTexture();
  const woodMat = material("fence_wood", "wood_cladding");
  // the backlit house-number plate and the pillar light: the ivory of the plaster, glowing
  const glowBase = generatedMaterial(ctx.style, "pillar_light", "plaster").color;
  add(fences, [
    ["fence_plinth", plinth, material("fence_plinth", "slab")],
    ["fence_wood", wood, woodMat],
    ["fence_metal", metal, material("fence_post", "frame")],
    ["fence_posts", legacyPosts, material("fence_mesh", "frame")],
    ["fence_mesh", mesh, material("fence_mesh", "frame", { alphaMap: meshAlpha, alphaTest: 0.5 })],
    ["kerb", kerb, material("kerb", "slab")],
    ["bins", bins, material("equipment", "frame")],
    ["pillar_lights", glow, new THREE.MeshStandardMaterial({ color: glowBase, emissive: new THREE.Color(glowBase), emissiveIntensity: 0.9, roughness: 0.5 })],
  ], high);
  if (!mesh.triangleCount) meshAlpha.dispose();
  // the posts of the slat fences: one instanced box
  if (slatPosts.length) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const posts = new THREE.InstancedMesh(box, material("fence_post", "frame"), slatPosts.length);
    posts.name = "fence_slat_posts";
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion();
    slatPosts.forEach((p, i) => {
      // house (x, y, z) -> scene (x, z, -y)
      M.compose(new THREE.Vector3(p.p[0], (p.z0 + p.z1) / 2, -p.p[1]), Q, new THREE.Vector3(p.size, p.z1 - p.z0, p.size));
      posts.setMatrixAt(i, M);
    });
    posts.instanceMatrix.needsUpdate = true;
    posts.computeBoundingSphere();
    posts.castShadow = high;
    posts.receiveShadow = true;
    fences.add(posts);
  }

  group.add(neighbours, fences);
  return {
    group, neighbours, fences,
    setWood(color) { woodMat.color.set(color); },
    setVisible(v) { group.visible = v; },
    dispose() { disposeTree(group); },
  };
}

/** A square-grid alpha pattern (opaque lines on a clear field) for the mesh of a mesh fence; texture coordinates are metres. */
function gridAlphaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 16, 3);
    g.fillRect(0, 0, 3, 16);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / SURROUNDINGS.meshCell, 1 / SURROUNDINGS.meshCell);
  return t;
}
