// The terrace louvre wall: vertical blades between a head rail and a sill rail (`derived.screens`, `house.shading.slats`) that
// only turn about their own vertical axis, exactly as the Blender builder places them (pipeline/blender/hb/exterior.py
// `build_screens`). The GLB holds the static blades (`role: "screen_slats"`, `userData.id` = the screen id) and the rails
// (`role: "screen_rail"`); this module hides only the blades and draws movable ones in their place, so the rails stay.
//
//  * Positions: `derived.screens[].blades.positions` (even spacing over the screen, the first half a pitch from the start); the
//    same rule is `slatPositions` for a screen without them. Chord and thickness from `blades` (`shading.slats` otherwise).
//  * Heights: the blades run between the rails, `SCREEN_RAIL.height` above `z0` and below `z1` (`derived.screens[].z0/z1`,
//    with `SCREEN_RAIL.gap` of air), as in the pipeline (the test reads its parameters).
//  * `setAngle(deg)`: every blade turns about its vertical axis. 0 = blades in the wall plane, 90 = square to the wall (open);
//    the angle is clamped to [`closedDeg`, 90]: the closed stop where neighbouring blades touch (`derived.screens[].closedDeg`).
//  * An older GLB without `screen_rail` meshes holds the rails inside the static blade mesh: then the rails are drawn here.
//  * Occluders: all blades (instanced meshes) for the sun analysis.
import * as THREE from "three";
import type { DerivedScreen } from "@/lib/model";
import { extrasOf } from "./glb";
import type { HouseScene } from "./house";
import type { Viewer } from "./viewer";

/** The rails of a louvre wall: height of each rail, the air between rail and blade, the rail is `chord + depthOverChord` deep but at least `minDepth` (pipeline/blender/hb/params.py `rail_h`, `rail_d`). */
export const SCREEN_RAIL = { height: 0.06, gap: 0.004, depthOverChord: 0.02, minDepth: 0.14 } as const;

export interface SlatScreens {
  readonly group: THREE.Group;
  /** Number of screens and of blades drawn. */
  readonly counts: { screens: number; slats: number };
  /** Current angle, degrees from the wall plane. */
  readonly angle: number;
  /** The physical range of the blades: `min` the closed stop (`closedDeg`), `max` 90 (open), `rest` the angle they start at. */
  readonly range: { min: number; max: number; rest: number };
  /** Turns the blades; clamped to `range`. */
  setAngle(deg: number): void;
  /**
   * @deprecated The louvres only turn (no slide). Kept as a no-op so a page written against the old API still runs; remove
   * the call. `slide` is always 0.
   */
  setSlide(t: number): void;
  /** @deprecated Always 0 (see `setSlide`). */
  readonly slide: number;
  /** The blade meshes at their current angle. Fresh matrices (`updateMatrixWorld`) are the caller's duty before ray casting. */
  occluders(): THREE.Object3D[];
  dispose(): void;
}

/**
 * Pure: blade centres of a screen from `from` to `to` (along its axis), as the pipeline spreads them: `n = floor(length /
 * pitch)` blades on an even pitch `length / n`, the first half a pitch from the start.
 */
export function slatPositions(from: number, to: number, pitch: number): number[] {
  const len = to - from;
  const n = Math.max(0, Math.floor(len / pitch + 1e-9));
  if (!n) return [];
  const p = len / n;
  return Array.from({ length: n }, (_, i) => from + p * (i + 0.5));
}

/** Pure: the closed stop of blades turning about their centres (neighbours touch when `pitch * sin(angle) = thickness`), rounded up to 5 degrees. */
export function closedAngle(pitch: number, thickness: number): number {
  return Math.ceil((Math.asin(Math.min(1, thickness / pitch)) * 180) / Math.PI / 5 - 1e-9) * 5;
}

/** The vertical extent of the blades of a screen: between the rails. */
export function bladeHeights(screen: Pick<DerivedScreen, "z0" | "z1">): { bottom: number; top: number } {
  return { bottom: screen.z0 + SCREEN_RAIL.height + SCREEN_RAIL.gap, top: screen.z1 - SCREEN_RAIL.height - SCREEN_RAIL.gap };
}

/** Box with texture coordinates in metres (one texture unit is a metre, as in the GLB), so the grain keeps its scale. */
function metreBox(sx: number, sy: number, sz: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry faces in order +x, -x, +y, -y, +z, -z, four vertices each: the two face dimensions
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = dims[Math.floor(i / 4)];
    uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  }
  return g;
}

/**
 * Builds the louvre walls, adds them to the house scene (`house.adopt`) and hides the static blades. Starts at the rest angle
 * of the model. Requests a render on every change. Returns screens with zero blades when the model has none.
 */
export function buildSlatScreens(viewer: Viewer, house: HouseScene): SlatScreens {
  const { ctx } = house;
  const slats = ctx.house.shading.slats;
  const group = new THREE.Group();
  group.name = "slat_screens";
  const material = house.materials.get("screen_slats") ?? new THREE.MeshStandardMaterial();
  const railMaterial = house.materials.get("screen_rail") ?? house.materials.get("post") ?? house.materials.get("frame") ?? material;
  const owned: THREE.BufferGeometry[] = [];

  interface Built { mesh: THREE.InstancedMesh; screen: DerivedScreen; positions: number[]; mid: number }
  const built: Built[] = [];
  let min = 0, rest = 90;
  for (const screen of ctx.derived.screens) {
    // the static blades of this screen (a join by id) are replaced by the movable ones; the rails stay when the file has them
    let rails = false;
    house.building.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || extrasOf(m).id !== screen.id) return;
      const role = extrasOf(m).role;
      if (role === "screen_slats") m.visible = false;
      if (role === "screen_rail") rails = true;
    });
    const { chord, thickness: thick } = screen.blades;
    const positions = screen.blades.positions.length ? [...screen.blades.positions] : slatPositions(screen.from, screen.to, slats.pitch);
    if (!positions.length) continue;
    const { bottom, top } = bladeHeights(screen);
    const mesh = new THREE.InstancedMesh(metreBox(chord, top - bottom, thick), material, positions.length);
    owned.push(mesh.geometry);
    mesh.name = `slats_${screen.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    built.push({ mesh, screen, positions, mid: (bottom + top) / 2 });
    min = Math.max(min, screen.closedDeg);
    rest = screen.restDeg;
    if (!rails) {
      // an older GLB: the rails were part of the static blade mesh, so they are drawn here
      const depth = Math.max(SCREEN_RAIL.minDepth, chord + SCREEN_RAIL.depthOverChord);
      const len = screen.to - screen.from, c = (screen.from + screen.to) / 2;
      for (const zc of [screen.z0 + SCREEN_RAIL.height / 2, screen.z1 - SCREEN_RAIL.height / 2]) {
        const g = metreBox(screen.orient === "h" ? len : depth, SCREEN_RAIL.height, screen.orient === "h" ? depth : len);
        owned.push(g);
        const rail = new THREE.Mesh(g, railMaterial);
        rail.name = `rail_${screen.id}`;
        // house frame (x, y, z) -> scene (x, z, -y)
        if (screen.orient === "h") rail.position.set(c, zc, -screen.at); else rail.position.set(screen.at, zc, -c);
        rail.castShadow = true;
        rail.receiveShadow = true;
        group.add(rail);
      }
    }
  }
  const range = { min, max: 90, rest: Math.min(90, Math.max(min, rest)) };

  let angle = range.rest;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  function layout() {
    for (const b of built) {
      // local x is the chord; it lies along the screen at 0 degrees. A turn about scene +Y is a counter-clockwise turn in the
      // plan (the pipeline's convention); a vertical screen runs along house y, a quarter turn from house x
      Q.setFromAxisAngle(up, (b.screen.orient === "v" ? Math.PI / 2 : 0) + (angle * Math.PI) / 180);
      b.positions.forEach((s, i) => {
        // house frame (x, y, z) -> scene (x, z, -y)
        if (b.screen.orient === "h") P.set(s, b.mid, -b.screen.at);
        else P.set(b.screen.at, b.mid, -s);
        b.mesh.setMatrixAt(i, M.compose(P, Q, S));
      });
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
    }
    group.updateMatrixWorld(true);
    viewer.requestRender();
  }
  layout();
  if (built.length) house.adopt(group);

  return {
    group,
    counts: { screens: built.length, slats: built.reduce((n, b) => n + b.positions.length, 0) },
    get angle() { return angle; },
    range,
    setAngle(deg) {
      if (!Number.isFinite(deg)) return;
      angle = Math.min(range.max, Math.max(range.min, deg));
      layout();
    },
    setSlide() { /* deprecated: the louvres only turn */ },
    slide: 0,
    occluders() { return built.map((b) => b.mesh); },
    dispose() {
      // the shared materials belong to the house scene
      for (const g of owned) g.dispose();
      for (const b of built) b.mesh.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}
