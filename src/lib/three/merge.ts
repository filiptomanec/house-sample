// Merging static meshes into fewer draw calls. A phone has a budget of about 150 draw calls for the whole Model page; the
// house GLB holds one mesh per room floor, per pane of glass and per cladding strip, the battery is a dozen small boxes. Meshes
// that share a key (role and material) are merged into one mesh in world coordinates; nothing moves on screen. Pure three.js,
// no GL context needed (tested in node).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** The attribute names of a geometry, sorted: geometries merge only when they agree (and all are indexed or none). */
const signature = (g: THREE.BufferGeometry): string => `${g.index ? "i" : "n"}:${Object.keys(g.attributes).sort().join(",")}`;

export interface MergeResult {
  /** The meshes after merging, in the order of the input (a merged mesh takes the place of its first member). */
  meshes: THREE.Mesh[];
  /** Number of merged meshes created and of input meshes they replaced. */
  merged: number;
  replaced: number;
}

/**
 * Merges the meshes of each key (`keyOf` returns null for a mesh that must stay apart) into one mesh with the shared material,
 * in world coordinates (`updateMatrixWorld` first). The merged mesh is added to the parent of the first member, with identity
 * transform relative to the world when that parent has none; members are removed and their geometries disposed. A merged
 * mesh copies `castShadow`, `receiveShadow`, `renderOrder`, `visible` and the `userData` of its first member, plus
 * `userData.ids`: the `userData.id` of every member. Groups whose geometries do not share their attributes stay as they are.
 */
export function mergeMeshes(meshes: readonly THREE.Mesh[], keyOf: (mesh: THREE.Mesh) => string | null): MergeResult {
  const groups = new Map<string, THREE.Mesh[]>();
  for (const m of meshes) {
    if (Array.isArray(m.material)) continue;
    const k = keyOf(m);
    if (k === null) continue;
    const key = `${k}|${(m.material as THREE.Material).uuid}|${signature(m.geometry)}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}${m.visible ? 1 : 0}`;
    const list = groups.get(key);
    if (list) list.push(m); else groups.set(key, [m]);
  }
  const replacedBy = new Map<THREE.Mesh, THREE.Mesh | null>();
  let merged = 0, replaced = 0;
  const identity = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0];
    const parent = first.parent;
    parent?.updateWorldMatrix(true, false);
    for (const m of list) m.updateWorldMatrix(true, false);
    const geos = list.map((m) => (m.matrixWorld.equals(identity) ? m.geometry : m.geometry.clone().applyMatrix4(m.matrixWorld)));
    const geometry = mergeGeometries(geos, false);
    geos.forEach((g, i) => { if (g !== list[i].geometry) g.dispose(); });
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, first.material);
    mesh.name = `${first.name || "mesh"}_merged`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.visible = first.visible;
    mesh.userData = { ...first.userData, ids: list.map((m) => m.userData.id).filter((id): id is string => typeof id === "string") };
    delete mesh.userData.id;
    // the geometry is in world coordinates: undo the parent's transform so the mesh stays where it was
    if (parent && !parent.matrixWorld.equals(identity)) mesh.applyMatrix4(parent.matrixWorld.clone().invert());
    parent?.add(mesh);
    for (const m of list) {
      m.geometry.dispose();
      m.removeFromParent();
      replacedBy.set(m, null);
    }
    replacedBy.set(first, mesh);
    merged++;
    replaced += list.length;
  }
  const out: THREE.Mesh[] = [];
  for (const m of meshes) {
    if (!replacedBy.has(m)) out.push(m);
    else { const r = replacedBy.get(m); if (r) out.push(r); }
  }
  return { meshes: out, merged, replaced };
}
