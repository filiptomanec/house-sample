// The garage door as a movable add-on (contract C5: `garageDoor.setOpen(t)`). The GLB holds the door leaf of every opening of
// kind "garage" as meshes with role `garage_door` and `userData.id` = the opening id (docs/ARCHITECTURE.md section 3, C2); this
// module finds them by role, joins them to the derived opening by that id (a join key, never a condition) and moves them.
//
//  * Motion of an overhead door: the bottom edge runs up the vertical track in the opening, the top edge runs into the garage
//    along the horizontal track at the head, so the leaf ends level under the ceiling, inside. `t` 0 is closed, 1 open. The
//    leaf turns about its own horizontal axis along the wall (`doorMotion`, pure); everything comes from the leaf's own extent
//    and the opening's outward azimuth, nothing is typed in.
//  * The leaf stays part of the house: it is cut by the section plane, lit by the interior fill and, being a house occluder
//    with its BVH, it shades in the sun analysis wherever it is (the analysis reads the current world matrices).
//  * A GLB without `garage_door` meshes (built before R2) has nothing to move: `available` is false and `setOpen` does nothing,
//    so the page can hide its switch.
import * as THREE from "three";
import type { HouseScene } from "./house";
import { prefersReducedMotion } from "./theme";
import type { Viewer } from "./viewer";

/** Duration of a full opening, seconds (eased; jumps with reduced motion). */
export const GARAGE_DOOR_TRAVEL = 1.6;

/**
 * Pure: the pose of a leaf of height `height` at opening `t` (0..1): the angle it has turned from the wall plane into the room
 * (radians, 0 vertical, pi/2 level) and how far its bottom edge has risen (metres). The top edge then lies `height * sin(angle)`
 * inside the opening, at the head; the leaf keeps its length.
 */
export function doorMotion(t: number, height: number): { angle: number; lift: number; inside: number } {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const angle = (k * Math.PI) / 2;
  return { angle, lift: height * (1 - Math.cos(angle)), inside: height * Math.sin(angle) };
}

export interface GarageDoor {
  /** True when the GLB has a door leaf to move. */
  readonly available: boolean;
  /** Number of garage doors found (openings of kind "garage" with a leaf in the GLB). */
  readonly count: number;
  /** Current opening, 0 closed .. 1 open (the target while it moves). */
  readonly open: number;
  /** Opens to `t` (0..1, clamped), eased over `GARAGE_DOOR_TRAVEL` (immediately with `animate: false` or reduced motion). */
  setOpen(t: number, opts?: { animate?: boolean }): void;
  /** Closes the door (puts the leaves back exactly) and stops listening to the frame loop. */
  dispose(): void;
}

interface Leaf {
  meshes: THREE.Mesh[];
  /** The rest matrices of the meshes (the closed door). */
  rest: THREE.Matrix4[];
  /** Pivot (bottom edge, middle of the leaf, scene frame), axis along the wall, height of the leaf. */
  pivot: THREE.Vector3;
  axis: THREE.Vector3;
  height: number;
}

/** Finds the door leaves of the garage openings, adds nothing to the scene, and returns the controller (starts closed). */
export function buildGarageDoor(viewer: Viewer, house: HouseScene): GarageDoor {
  const { derived } = house.ctx;
  const byId = new Map<string, THREE.Mesh[]>();
  house.building.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.role !== "garage_door") return;
    const id = m.userData.id as string | undefined;
    if (!id) return;
    const list = byId.get(id);
    if (list) list.push(m); else byId.set(id, [m]);
  });
  const leaves: Leaf[] = [];
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const o of derived.openings) {
    if (o.kind !== "garage" || o.azimuth === null) continue;
    const meshes = byId.get(o.id);
    if (!meshes?.length) continue;
    box.makeEmpty();
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(tmp.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld));
    }
    // house azimuth clockwise from +y; the inward normal is the opposite of the outward one, in the scene frame (x, -y)
    const a = (o.azimuth * Math.PI) / 180;
    const inward = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const up = new THREE.Vector3(0, 1, 0);
    // turning about up x inward by a positive angle tips the top of the leaf into the room
    const axis = new THREE.Vector3().crossVectors(up, inward).normalize();
    const centre = box.getCenter(new THREE.Vector3());
    leaves.push({ meshes, rest: meshes.map((m) => m.matrix.clone()), pivot: new THREE.Vector3(centre.x, box.min.y, centre.z), axis, height: box.max.y - box.min.y });
  }

  let open = 0, shown = 0;
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
  function pose(t: number) {
    shown = t;
    for (const leaf of leaves) {
      const { angle, lift } = doorMotion(t, leaf.height);
      // about the bottom edge, then up the track: T(pivot + lift) R(angle) T(-pivot)
      R.makeRotationAxis(leaf.axis, angle);
      T.makeTranslation(-leaf.pivot.x, -leaf.pivot.y, -leaf.pivot.z);
      M.makeTranslation(leaf.pivot.x, leaf.pivot.y + lift, leaf.pivot.z).multiply(R).multiply(T);
      leaf.meshes.forEach((m, i) => {
        m.matrix.copy(M).multiply(leaf.rest[i]);
        m.matrix.decompose(m.position, m.quaternion, m.scale);
        m.updateMatrixWorld(true);
      });
    }
    viewer.requestRender();
  }

  let from = 0, to = 0, k = 1;
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const offFrame = viewer.onFrame((dt) => {
    if (k >= 1) return false;
    k = Math.min(1, k + dt / GARAGE_DOOR_TRAVEL);
    pose(from + (to - from) * ease(k));
    return true;
  });

  return {
    available: leaves.length > 0,
    count: leaves.length,
    get open() { return open; },
    setOpen(t, opts = {}) {
      const next = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
      open = next;
      if (!leaves.length) return;
      if (opts.animate === false || prefersReducedMotion()) { k = 1; pose(next); return; }
      from = shown; to = next; k = 0;
      viewer.requestRender();
    },
    dispose() {
      offFrame();
      if (leaves.length && shown !== 0) pose(0);
    },
  };
}
