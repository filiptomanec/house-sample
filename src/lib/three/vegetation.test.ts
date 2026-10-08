import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { distToBoundary, pointInPolygon, polygonArea, type XY } from "@/lib/model/site";
import { getHouseContext } from "./context";
import { BED_PLANTING, COLUMNAR_RATIO, PLANT, TREE_MODEL_FILE, bedPlantings, crownShape, rng, seedAt, treeBlobs, treeInstanceMatrix, treeModelOf, usesTreeModel, type CrownShape } from "./vegetation";

const ctx = getHouseContext();

describe("random numbers", () => {
  it("are in [0, 1), repeat for a seed and differ between seeds", () => {
    const a = rng(1), b = rng(1), c = rng(2);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs).not.toEqual(Array.from({ length: 50 }, () => c()));
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });

  it("seeds a plant by its position, so the order of the list does not change how it looks", () => {
    expect(seedAt(1, 3.2, -11.2)).toBe(seedAt(1, 3.2, -11.2));
    expect(seedAt(1, 3.2, -11.2)).not.toBe(seedAt(1, 3.3, -11.2));
    expect(seedAt(1, 3.2, -11.2)).not.toBe(seedAt(2, 3.2, -11.2));
  });
});

describe("crownShape", () => {
  it("follows the proportions and the leaf habit of the data, not the name of the species", () => {
    expect(crownShape(false, 10, 8)).toBe("rounded");
    expect(crownShape(true, 10, 8)).toBe("conical");
    expect(crownShape(true, 10, 10 / (COLUMNAR_RATIO + 0.1))).toBe("columnar");
    expect(crownShape(false, 10, 10 / (COLUMNAR_RATIO + 0.1))).toBe("columnar");
    expect(crownShape(true, 10, 10 / COLUMNAR_RATIO)).toBe("conical");
  });
});

describe("treeBlobs", () => {
  const trees = ctx.site.model.trees;
  const species = ctx.site.model.species;

  it("has trees in the plot to look at", () => {
    expect(trees.length).toBeGreaterThan(0);
  });

  it("keeps every blob of every tree of the plot inside its crown: reach, base and tip are the data's", () => {
    for (const t of trees) {
      const shape = crownShape(species[t.species]?.evergreen ?? false, t.height, t.crown);
      const crownBase = t.crownBase ?? 0.3 * t.height;
      for (const seed of [1, 2, 3]) {
        const blobs = treeBlobs(shape, t.pos[0], t.pos[1], 0, t.height, t.crown, crownBase, rng(seedAt(seed, t.pos[0], t.pos[1])));
        expect(blobs.length).toBeGreaterThan(1);
        for (const b of blobs) {
          const reach = Math.hypot(b.centre[0] - t.pos[0], b.centre[1] - t.pos[1]) + Math.max(b.radii[0], b.radii[1]);
          expect(reach, `${t.id} reach`).toBeLessThanOrEqual(t.crown / 2 + 1e-9);
          expect(b.centre[2] - b.radii[2], `${t.id} base`).toBeGreaterThanOrEqual(crownBase - 1e-9);
          expect(b.centre[2] + b.radii[2], `${t.id} tip`).toBeLessThanOrEqual(t.height + 1e-9);
        }
      }
    }
  });

  it("is deterministic for a seed and depends on it", () => {
    const make = (seed: number) => treeBlobs("rounded", 0, 0, 0, 10, 8, 3, rng(seed));
    expect(make(4)).toEqual(make(4));
    expect(make(4)).not.toEqual(make(5));
  });

  it("stacks conical and columnar crowns from the base to the tip, each narrower than the one below for a cone", () => {
    for (const shape of ["conical", "columnar"] as CrownShape[]) {
      const blobs = treeBlobs(shape, 0, 0, 0, 12, 5, 2, rng(1));
      expect(blobs.length).toBe(PLANT.blobsStacked);
      for (let i = 1; i < blobs.length; i++) {
        expect(blobs[i].centre[2]).toBeGreaterThan(blobs[i - 1].centre[2]);
        if (shape === "conical") expect(blobs[i].radii[0]).toBeLessThan(blobs[i - 1].radii[0]);
      }
      // the lowest blob touches the base and the highest the tip
      expect(blobs[0].centre[2] - blobs[0].radii[2]).toBeCloseTo(2, 9);
      expect(blobs[blobs.length - 1].centre[2] + blobs[blobs.length - 1].radii[2]).toBeCloseTo(12, 9);
    }
  });
});

describe("the broad crown of a big tree (the walnut)", () => {
  it("fills most of its crown diameter, so a big tree reads big and broad", () => {
    const big = [...ctx.site.model.trees].sort((a, b) => b.crown - a.crown)[0];
    const shape = crownShape(ctx.site.model.species[big.species]?.evergreen ?? false, big.height, big.crown);
    expect(shape).toBe("rounded");
    const blobs = treeBlobs(shape, 0, 0, 0, big.height, big.crown, big.crownBase ?? 0.3 * big.height, rng(seedAt(1, big.pos[0], big.pos[1])));
    const xs = blobs.flatMap((b) => [b.centre[0] - b.radii[0], b.centre[0] + b.radii[0]]);
    const ys = blobs.flatMap((b) => [b.centre[1] - b.radii[1], b.centre[1] + b.radii[1]]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.8 * big.crown);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.8 * big.crown);
    // and it has more blobs than a small tree
    const small = treeBlobs("rounded", 0, 0, 0, 4.5, 4, 1.35, rng(1));
    expect(blobs.length).toBeGreaterThan(small.length);
  });
});

/** A synthetic baked tree as vegetation_bake.py writes it: bark and leaves meshes with their roles, the size in the scene extras. */
function bakedScene(extras = true) {
  const scene = new THREE.Group();
  const bark = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial());
  bark.userData = { role: "bark" };
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6).translate(0, 4, 0), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
  leaves.userData = { role: "leaves" };
  scene.add(bark, leaves);
  if (extras) scene.userData = { height: 6, crown: 4, crownBase: 2 };
  return scene;
}

/**
 * The pipeline's file (docs/PIPELINE.md section 9): nodes `tree_bark` / `tree_foliage` with roles "bark" / "foliage", normalised to
 * height 1 and crown 1, `crownBase` as a share of the height, the crown off the trunk by `crownCentre` (house x / y, in crowns).
 */
function pipelineScene(centre: [number, number]) {
  const scene = new THREE.Group();
  const bark = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6).translate(0, 0.25, 0), new THREE.MeshStandardMaterial());
  bark.name = "tree_bark"; bark.userData = { role: "bark" };
  // a crown of diameter 1 between 0.32 and 1, its centre at house (centre) × 1, i.e. scene (cx, ·, -cy)
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8).scale(1, 0.68, 1).translate(centre[0], 0.66, -centre[1]), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
  leaves.name = "tree_foliage"; leaves.userData = { role: "foliage" };
  scene.add(bark, leaves);
  scene.userData = { crownBase: 0.32, crownCentre: centre, sourceHeight: 4.6, sourceCrown: 3.6, source: "test" };
  return scene;
}

describe("the baked tree model", () => {
  it("is read from the roles and the scene extras, else from the bounding boxes", () => {
    const m = treeModelOf(bakedScene())!;
    expect(m).not.toBeNull();
    expect([m.height, m.crown, m.crownBase]).toEqual([6, 4, 2]);
    expect(m.leafMap).not.toBeNull();
    const n = treeModelOf(bakedScene(false))!;
    expect(n.height).toBeCloseTo(6, 6);
    expect(n.crown).toBeCloseTo(4, 6);
    expect(n.crownBase).toBeCloseTo(2, 6);
    const lonely = new THREE.Group();
    lonely.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    expect(treeModelOf(lonely)).toBeNull();
  });

  it("reads the pipeline's normalised file: height and crown 1, crown base a share of the height, the crown centred", () => {
    const m = treeModelOf(pipelineScene([0.05, -0.18]))!;
    expect(m).not.toBeNull();
    expect([m.height, m.crown]).toEqual([1, 1]);
    expect(m.crownBase).toBeCloseTo(0.32, 9);
    // the crown, not the trunk, stands on the vertical axis: an instance puts it on the site position
    const lb = m.leaves.boundingBox!;
    expect((lb.min.x + lb.max.x) / 2).toBeCloseTo(0, 6);
    expect((lb.min.z + lb.max.z) / 2).toBeCloseTo(0, 6);
    // and the trunk moved with it, by the same offset (house x east, house y = scene -z)
    const bb = m.bark.boundingBox!;
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(-0.05, 6);
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(-0.18, 6);
    // without an offset nothing moves
    const n = treeModelOf(pipelineScene([0, 0]))!;
    expect((n.bark.boundingBox!.min.x + n.bark.boundingBox!.max.x) / 2).toBeCloseTo(0, 9);
  });

  it("is scaled to each tree's height and crown and stands on its foot", () => {
    const model = treeModelOf(bakedScene())!;
    for (const t of ctx.site.model.trees) {
      const z0 = ctx.site.terrain.groundAt(t.pos[0], t.pos[1]);
      const m = treeInstanceMatrix(model, t, z0, 1.234);
      const box = new THREE.Box3().setFromBufferAttribute(model.leaves.getAttribute("position") as THREE.BufferAttribute);
      const top = new THREE.Vector3(0, model.height, 0).applyMatrix4(m);
      expect(top.y).toBeCloseTo(z0 + t.height, 6);
      const foot = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
      expect([foot.x, foot.y, -foot.z]).toEqual([t.pos[0], z0, t.pos[1]].map((v) => expect.closeTo(v, 6)));
      const leafWidth = (box.max.x - box.min.x) * (t.crown / model.crown);
      expect(leafWidth).toBeCloseTo(t.crown, 6);
    }
  });

  it("is used for rounded crowns only, and only when the manifest lists it (the procedural trees are the fallback)", () => {
    expect(usesTreeModel("rounded")).toBe(true);
    expect(usesTreeModel("conical")).toBe(false);
    expect(usesTreeModel("columnar")).toBe(false);
    expect(TREE_MODEL_FILE).toBe("tree.glb");
  });
});

describe("the planted beds", () => {
  const beds = ctx.site.model.beds, shrubs = ctx.site.model.shrubs;
  const planted = beds.filter((b) => (BED_PLANTING.kinds as readonly string[]).includes(b.kind));
  const plants = bedPlantings(beds, shrubs);

  it("has planted beds in the data to fill", () => {
    expect(planted.length).toBeGreaterThan(0);
  });

  it("puts every clump wholly inside a planted bed and outside every shrub's crown", () => {
    for (const p of plants) {
      const bed = planted.find((b) => pointInPolygon(p.pos, b.polygon as XY[]));
      expect(bed, `clump at ${p.pos}`).toBeDefined();
      expect(distToBoundary(p.pos, bed!.polygon as XY[])).toBeGreaterThanOrEqual(p.width / 2 + BED_PLANTING.edge - 1e-9);
      for (const sh of shrubs) expect(Math.hypot(sh.pos[0] - p.pos[0], sh.pos[1] - p.pos[1])).toBeGreaterThanOrEqual((sh.width + p.width) / 2 - 1e-9);
      expect(p.width).toBeGreaterThanOrEqual(BED_PLANTING.width[0]);
      expect(p.width).toBeLessThanOrEqual(BED_PLANTING.width[1]);
      expect(p.height).toBeGreaterThanOrEqual(BED_PLANTING.height[0]);
      expect(p.height).toBeLessThanOrEqual(BED_PLANTING.height[1]);
    }
    // nothing on a bed of another kind (gravel)
    for (const b of beds.filter((x) => !planted.includes(x))) expect(plants.some((p) => pointInPolygon(p.pos, b.polygon as XY[]))).toBe(false);
  });

  it("fills every planted bed that has room, at most at the density of the spec", () => {
    for (const b of planted) {
      const inBed = plants.filter((p) => pointInPolygon(p.pos, b.polygon as XY[])).length;
      expect(inBed).toBeLessThanOrEqual(Math.ceil(polygonArea(b.polygon as XY[]) * BED_PLANTING.perM2) + 2);
      // a bed wider than a clump plus its edges on both sides gets plants unless shrubs fill it
      const xs = b.polygon.map((q) => q[0]), ys = b.polygon.map((q) => q[1]);
      const free = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > BED_PLANTING.width[1] + 2 * BED_PLANTING.edge + 0.3;
      const shrubbed = shrubs.some((sh) => pointInPolygon(sh.pos as XY, b.polygon as XY[]));
      if (free && !shrubbed) expect(inBed, b.id).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a seed", () => {
    expect(bedPlantings(beds, shrubs, 1)).toEqual(plants);
    expect(bedPlantings(beds, shrubs, 2)).not.toEqual(plants);
  });
});
