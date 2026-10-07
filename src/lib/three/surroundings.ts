// What stands around the plot: the neighbours' houses, the fences with their gates, the kerb of the street. Generated
// from model/site.json (`neighbours`, `fences`, `street`), standing on the analytic ground. The painted ground (street,
// verge, field) is in terrain.ts; trees, shrubs and hedges are in vegetation.ts.
import * as THREE from "three";
import type { XY } from "@/lib/model/site";
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
  /** Neighbour houses: a box for the walls and a roof from `neighbours[].house.roof` (`kind` hip | gable | flat, pitch, overhang). */
  readonly neighbours: THREE.Group;
  /** Fence segments after the gate openings were cut (`ctx.layout.fences`): plinth, wooden and mesh fences by `kind`. */
  readonly fences: THREE.Group;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Drawing details of the generated parts, metres (products and conventions, not the house). */
export const SURROUNDINGS = {
  /** Walls of a neighbour house sink this far into the ground (the plot is sloped). */
  wallSink: 0.4,
  /** Thickness of a flat roof slab. */
  flatRoofThickness: 0.25,
  /** Longest piece of a fence; shorter pieces follow the slope. */
  fenceStep: 2.0,
  /** Height of the concrete plinth of a plinth fence. */
  plinthHeight: 0.35,
  /** The lower edge of a fence sinks this deep into the ground. */
  fenceSink: 0.15,
  /** Posts of a mesh fence. */
  postSize: 0.06,
  postSpacing: 2.5,
  /** Cell of the mesh pattern. */
  meshCell: 0.12,
} as const;

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
 * overhang continues it downwards, so the eave lies `overhang * tan(pitch)` below the wall top.
 */
function neighbourHouse(ctx: HouseContext, nb: NeighbourModel, walls: MeshBuilder, roofs: MeshBuilder): void {
  const { center, size, rotDeg, eaveHeight, roof } = nb.house;
  const ground = ctx.site.terrain.groundAt;
  const ring = rotatedRect(center, size, rotDeg);
  const base = Math.min(...ring.map((p) => ground(p[0], p[1]))) - SURROUNDINGS.wallSink;
  const top = ground(center[0], center[1]) + eaveHeight;
  walls.prism(ring, () => base, () => top);

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
  if (long) {
    const r0 = W(-A, 0, zRidge), r1 = W(A, 0, zRidge);
    roofs.quad(e[0], e[1], r1, r0); roofs.quad(e[2], e[3], r0, r1);
    walls.tri(W(a, -b, top), W(a, b, top), W(a, 0, zRidge));
    walls.tri(W(-a, b, top), W(-a, -b, top), W(-a, 0, zRidge));
  } else {
    const r0 = W(0, -B, zRidge), r1 = W(0, B, zRidge);
    roofs.quad(e[1], e[2], r1, r0); roofs.quad(e[3], e[0], r0, r1);
    walls.tri(W(-a, -b, top), W(a, -b, top), W(0, -b, zRidge));
    walls.tri(W(a, b, top), W(-a, b, top), W(0, b, zRidge));
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
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) {
      out.push([
        [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n],
        [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n],
      ]);
    }
  }
  return out;
}

/** A closed board between two points of a fence line: a box of thickness `t` whose lower and upper edges are given per end. */
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

  // neighbour houses (a few draw calls, they shade the plot in the evening)
  const neighbours = new THREE.Group();
  neighbours.name = "neighbours";
  const { walls, roofs } = neighbourMeshes(ctx);
  add(neighbours, [["neighbour_walls", walls, material("neighbour_wall", "plaster")], ["neighbour_roofs", roofs, material("neighbour_roof", "roof_tile")]], true);

  // fences by kind, one mesh per material
  const fences = new THREE.Group();
  fences.name = "fences";
  const ground = ctx.site.terrain.groundAt;
  const lowEdge = (p: XY) => ground(p[0], p[1]) - SURROUNDINGS.fenceSink;
  const plinth = new MeshBuilder(), wood = new MeshBuilder(), posts = new MeshBuilder(), mesh = new MeshBuilder();
  for (const f of ctx.layout.fences) {
    const upper = (p: XY) => ground(p[0], p[1]) + f.height;
    for (const part of f.parts) {
      let s = 0;
      for (const [a, b] of splitPolyline(part, SURROUNDINGS.fenceStep)) {
        if (f.kind === "plinth_fence") {
          const ph = (p: XY) => ground(p[0], p[1]) + SURROUNDINGS.plinthHeight;
          board(plinth, a, b, f.thickness, lowEdge, ph);
          board(wood, a, b, f.thickness * 0.6, ph, upper);
        } else if (f.kind === "wood_fence") {
          board(wood, a, b, f.thickness, lowEdge, upper);
        } else {
          panel(mesh, a, b, s, lowEdge, upper);
          const h = SURROUNDINGS.postSize / 2;
          for (const p of [a, b]) {
            const ring: Ring = [[p[0] - h, p[1] - h], [p[0] + h, p[1] - h], [p[0] + h, p[1] + h], [p[0] - h, p[1] + h]];
            posts.prism(ring, () => lowEdge(p), () => upper(p) + 0.05);
          }
        }
        s += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
  }
  const meshAlpha = gridAlphaTexture();
  add(fences, [
    ["fence_plinth", plinth, material("fence_plinth", "slab")],
    ["fence_wood", wood, material("fence_wood", "wood_cladding")],
    ["fence_posts", posts, material("fence_mesh", "frame")],
    ["fence_mesh", mesh, material("fence_mesh", "frame", { alphaMap: meshAlpha, alphaTest: 0.5 })],
  ], high);
  if (!mesh.triangleCount) meshAlpha.dispose();

  group.add(neighbours, fences);
  return {
    group, neighbours, fences,
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
