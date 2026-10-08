// Merging static meshes: one mesh per key and material, nothing moves, ids are kept as a list, what must stay apart stays.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { mergeMeshes } from "./merge";
import { HOUSE_KEEP_APART } from "./house";
import { cellBox } from "./pv";

const box = (x: number, mat: THREE.Material, id: string, role = "floor_oak") => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  m.position.set(x, 0.5, 0);
  m.userData = { role, id };
  return m;
};
const worldBox = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

describe("mergeMeshes", () => {
  it("merges the meshes of one key and material into one mesh in place, keeping the ids as a list", () => {
    const oak = new THREE.MeshStandardMaterial(), tile = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    const meshes = [box(0, oak, "R1"), box(2, oak, "R2"), box(4, tile, "R3", "floor_tile"), box(6, oak, "R4")];
    root.add(...meshes);
    const before = worldBox(root);
    const r = mergeMeshes(meshes, (m) => m.userData.role);
    expect(r.merged).toBe(1);
    expect(r.replaced).toBe(3);
    expect(r.meshes).toHaveLength(2);
    expect(root.children).toHaveLength(2);
    const merged = r.meshes.find((m) => m.material === oak)!;
    expect(merged.userData.ids).toEqual(["R1", "R2", "R4"]);
    expect(merged.userData.role).toBe("floor_oak");
    expect(merged.userData.id).toBeUndefined();
    const after = worldBox(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-9);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-9);
    expect(merged.geometry.getAttribute("position").count).toBe(3 * 24);
  });

  it("keeps meshes apart whose key is null, whose shadow flags differ or whose attributes differ", () => {
    const mat = new THREE.MeshStandardMaterial();
    const a = box(0, mat, "A"), b = box(2, mat, "B"), c = box(4, mat, "C"), d = box(6, mat, "D");
    c.castShadow = true;
    d.geometry.deleteAttribute("uv");
    const root = new THREE.Group();
    root.add(a, b, c, d);
    const r = mergeMeshes([a, b, c, d], (m) => (m.userData.id === "B" ? null : "k"));
    expect(r.merged).toBe(0);
    expect(r.meshes).toEqual([a, b, c, d]);
  });

  it("keeps the place of a mesh under a transformed parent", () => {
    const mat = new THREE.MeshStandardMaterial();
    const parent = new THREE.Group();
    parent.position.set(10, 0, 0);
    parent.rotation.y = 0.5;
    const a = box(0, mat, "A"), b = box(3, mat, "B");
    parent.add(a, b);
    const scene = new THREE.Scene();
    scene.add(parent);
    scene.updateMatrixWorld(true);
    const before = worldBox(parent);
    mergeMeshes([a, b], () => "k");
    scene.updateMatrixWorld(true);
    const after = worldBox(parent);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
  });

  it("never merges what an add-on moves or hides by id", () => {
    for (const role of ["screen_slats", "garage_door"]) expect(HOUSE_KEEP_APART.has(role)).toBe(true);
  });
});

describe("cellBox (PV module)", () => {
  it("has two groups, five frame faces and the cell face on +z, covering the box once", () => {
    const g = cellBox();
    expect(g.groups).toEqual([{ start: 0, count: 30, materialIndex: 0 }, { start: 30, count: 6, materialIndex: 1 }]);
    const idx = g.getIndex()!, pos = g.getAttribute("position");
    for (let k = 30; k < 36; k++) expect(pos.getZ(idx.getX(k))).toBeCloseTo(0.5, 9);
    for (let k = 0; k < 30; k += 3) {
      const zs = [0, 1, 2].map((j) => pos.getZ(idx.getX(k + j)));
      expect(zs.every((z) => Math.abs(z - 0.5) < 1e-9)).toBe(false);
    }
    expect(new Set(Array.from({ length: 36 }, (_, k) => idx.getX(k))).size).toBe(24);
  });
});
