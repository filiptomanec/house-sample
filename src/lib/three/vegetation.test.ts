import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { COLUMNAR_RATIO, PLANT, crownShape, rng, seedAt, treeBlobs, type CrownShape } from "./vegetation";

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
