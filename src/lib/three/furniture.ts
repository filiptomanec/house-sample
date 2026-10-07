// Preparing the furniture GLB for the scene: materials get the interior fill and the section plane, shadows are limited to
// the pieces that are worth them, mirrors reflect the room instead of the sky. Furniture never blocks the sun in the
// analysis and is never ground; the house scene keeps it out of both lists.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { InteriorFill } from "./interior";
import type { TierSettings } from "./tier";

/** Thin or glossy parts whose shadows nobody would miss (taps, screens, frames, mirrors, glass). Material roles of the furniture pipeline. */
export const FURNITURE_NO_SHADOW = /^[ft]_(chrome|screen|mirror|black_metal|glass)/;
/** Material roles of mirrors: bright glass that shows a light room (the interior fill's mirror mode), never the sky. */
export const FURNITURE_MIRROR = /^f_mirror/;
/** Mirror look: polished, almost white. */
const MIRROR = { roughness: 0.08, metalness: 1, color: "#e6e9ea" } as const;

export interface FurnitureOptions {
  settings: TierSettings;
  interior: InteriorFill;
  clip: readonly THREE.Plane[];
}

/**
 * Merges the meshes that share a material into one mesh (the geometry is already in house coordinates, so nothing moves).
 * The pipeline writes one mesh per room and material; a phone cannot afford hundreds of draw calls. Groups whose geometries
 * do not have the same attributes are left as they are. Keeps `role` and `toggle` in `userData`; `roomId` is dropped.
 */
export function mergeByMaterial(root: THREE.Object3D): number {
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const list = groups.get(m.material);
    if (list) list.push(m); else groups.set(m.material, [m]);
  });
  let merged = 0;
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometry = mergeGeometries(meshes.map((m) => m.geometry), false);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `furniture_${material.name}`;
    mesh.userData = { role: material.name, toggle: "furniture" };
    const parent = meshes[0].parent ?? root;
    for (const m of meshes) { m.geometry.dispose(); m.removeFromParent(); }
    parent.add(mesh);
    merged++;
  }
  return merged;
}

/** Sets up every mesh and material of a loaded furniture scene (once). Returns the root. */
export function prepareFurniture(root: THREE.Object3D, { settings, interior, clip }: FurnitureOptions): THREE.Object3D {
  if (settings.mergeFurniture) mergeByMaterial(root);
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.envMapIntensity = 1;
      // the grain of the wood textures stays sharp at grazing angles (table tops, shelves)
      if (m.map) m.map.anisotropy = settings.anisotropy;
      if (FURNITURE_MIRROR.test(m.name)) {
        m.roughness = MIRROR.roughness;
        m.metalness = MIRROR.metalness;
        m.color.set(MIRROR.color);
        m.userData.mirror = true;
      }
      m.clippingPlanes = clip as THREE.Plane[];
      m.clipShadows = true;
      interior.patch(m);
    }
    mesh.receiveShadow = true;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const height = box ? box.max.y - box.min.y : 0;
    mesh.castShadow = settings.furnitureShadows && !mats.some((m) => m.transparent || FURNITURE_NO_SHADOW.test(m.name)) && height >= settings.furnitureShadowMinHeight;
  });
  return root;
}
