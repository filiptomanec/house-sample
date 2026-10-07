// Animated slat screens: the free-standing vertical slat screens of the model (`house.screens`, `derived.screens`; pitch,
// width and depth of the slats in `house.shading.slats`), e.g. at the edge of the covered terrace. The GLB contains each
// screen as a static mesh (`role: "screen_slats"`, `userData.id` = the screen id); this module hides that mesh and draws
// movable slats in its place, so the screen can be turned and slid.
//
//  * Extent: the horizontal extent comes from `derived.screens[]` (`orient`, `at`, `from`, `to`); the vertical extent
//    (bottom, top) is read from the bounding box of the static GLB mesh with the same id, so the movable slats always
//    match what the pipeline built (the model stores no screen height).
//  * `setAngle(deg)`: every slat turns about its own vertical axis. 0 = slats parallel to the screen plane (closed, the
//    slat width covers the pitch), 90 = edge-on (open).
//  * `setSlide(t)`: the slats slide along the screen towards its `to` end, 0 = spread over the whole length (closed
//    layout), 1 = stacked at the end (open). Slat i moves by t times its distance to the stacked position.
//  * Occluders: all slats, as instanced meshes, for the sun analysis.
import * as THREE from "three";
import { extrasOf } from "./glb";
import type { HouseScene } from "./house";
import type { Viewer } from "./viewer";

export interface SlatScreens {
  readonly group: THREE.Group;
  /** Number of screens and of slats drawn. */
  readonly counts: { screens: number; slats: number };
  readonly angle: number;
  readonly slide: number;
  /** Degrees, 0..90 (clamped). */
  setAngle(deg: number): void;
  /** 0..1 (clamped). */
  setSlide(t: number): void;
  /** The slat meshes at their current angle and position. Fresh matrices (`updateMatrixWorld`) are the caller's duty before ray casting. */
  occluders(): THREE.Object3D[];
  dispose(): void;
}

export interface ScreenSlat {
  /** Position along the screen axis (house frame, metres) for slide 0 (spread) and slide 1 (stacked at the `to` end). */
  spread: number;
  stacked: number;
}

/**
 * Pure: the slat positions of a screen from `from` to `to` (along its axis). Slats are `pitch` apart (the first half a pitch
 * from the start); stacked, they touch each other with their broad face along the screen, the last one at the `to` end.
 */
export function slatPositions(from: number, to: number, pitch: number, broad: number): ScreenSlat[] {
  const n = Math.max(0, Math.floor((to - from) / pitch + 1e-9));
  return Array.from({ length: n }, (_, i) => ({ spread: from + pitch * (i + 0.5), stacked: to - broad / 2 - (n - 1 - i) * broad }));
}

/** Box with texture coordinates in metres (one texture unit is a metre, as in the GLB), so the grain keeps its scale. */
function slatBox(sx: number, sy: number, sz: number): THREE.BoxGeometry {
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
 * Builds the screens, adds them to the house scene (`house.adopt`) and hides the static `screen_slats` meshes.
 * Requests a render on every change. Returns screens with zero slats when the model has none.
 */
export function buildSlatScreens(viewer: Viewer, house: HouseScene): SlatScreens {
  const { ctx } = house;
  const { pitch, width, depth } = ctx.house.shading.slats;
  const broad = Math.max(width, depth), thin = Math.min(width, depth);
  const group = new THREE.Group();
  group.name = "slat_screens";
  const material = house.materials.get("screen_slats") ?? new THREE.MeshStandardMaterial();

  interface Built { mesh: THREE.InstancedMesh; axis: "h" | "v"; at: number; z0: number; slats: ScreenSlat[] }
  const built: Built[] = [];
  for (const screen of ctx.derived.screens) {
    // the static mesh of this screen (a join by id) gives the vertical extent: the model stores no screen height
    const statics: THREE.Mesh[] = [];
    house.building.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && extrasOf(m).role === "screen_slats" && extrasOf(m).id === screen.id) statics.push(m);
    });
    let z0 = 0, z1 = ctx.house.clearHeight;
    for (const m of statics) {
      m.visible = false;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      if (b) { z0 = b.min.y; z1 = b.max.y; }
    }
    const slats = slatPositions(screen.from, screen.to, pitch, broad);
    if (!slats.length) continue;
    const mesh = new THREE.InstancedMesh(slatBox(broad, z1 - z0, thin), material, slats.length);
    mesh.name = `slats_${screen.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    built.push({ mesh, axis: screen.orient, at: screen.at, z0, slats: slats.map((s) => ({ ...s })) });
    mesh.userData.height = z1 - z0;
  }

  let angle = 0, slide = 0;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  function layout() {
    for (const b of built) {
      // local x is the broad face along the screen; the baked orientation of a vertical screen turns it from scene x to scene -z
      Q.setFromAxisAngle(up, (b.axis === "v" ? Math.PI / 2 : 0) + (angle * Math.PI) / 180);
      const h = b.mesh.userData.height as number;
      b.slats.forEach((s, i) => {
        const t = s.spread + (s.stacked - s.spread) * slide;
        // house frame (x, y, z) -> scene (x, z, -y)
        if (b.axis === "h") P.set(t, b.z0 + h / 2, -b.at);
        else P.set(b.at, b.z0 + h / 2, -t);
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
    counts: { screens: built.length, slats: built.reduce((n, b) => n + b.slats.length, 0) },
    get angle() { return angle; },
    get slide() { return slide; },
    setAngle(deg) { angle = Math.min(90, Math.max(0, deg)); layout(); },
    setSlide(t) { slide = Math.min(1, Math.max(0, t)); layout(); },
    occluders() { return built.map((b) => b.mesh); },
    dispose() {
      // the shared material belongs to the house scene
      group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      for (const b of built) b.mesh.dispose();
      group.removeFromParent();
    },
  };
}
