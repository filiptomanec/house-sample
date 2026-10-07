// Freeing GPU and CPU memory of a scene graph: geometries (with their BVH), materials and the textures they hold.
// iOS kills pages that keep dead scenes around, and the Model and Sun pages are navigated between, so every piece of the
// engine disposes what it built through here.
import * as THREE from "three";

type BvhGeometry = THREE.BufferGeometry & { boundsTree?: unknown; disposeBoundsTree?: () => void };

const TEXTURE_SLOTS = [
  "map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "alphaMap", "emissiveMap", "bumpMap", "displacementMap",
  "envMap", "lightMap", "clearcoatMap", "clearcoatNormalMap", "clearcoatRoughnessMap", "transmissionMap", "thicknessMap",
  "sheenColorMap", "sheenRoughnessMap", "specularColorMap", "specularIntensityMap", "iridescenceMap", "iridescenceThicknessMap",
] as const;

/** Disposes a material and every texture it references. */
export function disposeMaterial(material: THREE.Material): void {
  const m = material as unknown as Record<string, unknown>;
  for (const slot of TEXTURE_SLOTS) {
    const t = m[slot];
    if (t && (t as THREE.Texture).isTexture) (t as THREE.Texture).dispose();
  }
  material.dispose();
}

/** Disposes a geometry and its BVH, if one was built. */
export function disposeGeometry(geometry: THREE.BufferGeometry): void {
  const g = geometry as BvhGeometry;
  if (g.boundsTree && g.disposeBoundsTree) g.disposeBoundsTree();
  geometry.dispose();
}

const materialsOf = (o: THREE.Object3D): THREE.Material[] => {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  return m ? (Array.isArray(m) ? m : [m]) : [];
};

/**
 * Disposes everything under `root` (geometries, materials, textures, InstancedMesh buffers) and detaches it from its parent.
 * Materials listed in `keep` are shared with something that outlives `root` and are not touched.
 */
export function disposeTree(root: THREE.Object3D, keep: ReadonlySet<THREE.Material> = new Set()): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) disposeGeometry(mesh.geometry);
    for (const m of materialsOf(o)) if (!keep.has(m)) disposeMaterial(m);
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) inst.dispose();
  });
  root.removeFromParent();
}
