// The garage door add-on: the overhead motion keeps the leaf's length and ends level under the head, inside; the leaf is found
// by role and joined to the derived garage opening by its id; a file without a leaf leaves the switch unavailable.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { buildGarageDoor, doorMotion } from "./garageDoor";
import type { HouseScene } from "./house";
import type { Viewer } from "./viewer";

const ctx = getHouseContext();
const garage = ctx.derived.openings.find((o) => o.kind === "garage")!;

/** A leaf in the opening as the Blender builder makes it: a thin box in the wall from the sill to the head (scene frame). */
function leafMesh(): THREE.Mesh {
  const a = (garage.azimuth! * Math.PI) / 180;
  const out = [Math.sin(a), Math.cos(a)];
  const along = garage.orient === "h" ? [1, 0] : [0, 1];
  const len = garage.w, h = garage.head - garage.sill, t = 0.05;
  const g = new THREE.BoxGeometry(along[0] * len + Math.abs(out[0]) * t, h, along[1] * len + Math.abs(out[1]) * t);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: "garage_door" }));
  m.position.set(garage.cx, garage.sill + h / 2, -garage.cy);
  m.userData = { role: "garage_door", id: garage.id };
  return m;
}

function fake(withLeaf: boolean) {
  const building = new THREE.Group();
  const leaf = leafMesh();
  if (withLeaf) building.add(leaf);
  building.updateMatrixWorld(true);
  const frames: ((dt: number) => boolean | void)[] = [];
  const viewer = { requestRender: () => undefined, onFrame: (cb: (dt: number) => boolean | void) => { frames.push(cb); return () => frames.splice(frames.indexOf(cb), 1); } } as unknown as Viewer;
  const house = { ctx, building } as unknown as HouseScene;
  return { viewer, house, leaf, frames };
}

const worldBox = (m: THREE.Mesh) => { m.updateMatrixWorld(true); m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld); };

describe("doorMotion", () => {
  it("turns the leaf from vertical (closed) to level (open), lifting the bottom edge so the length is kept", () => {
    const H = 2.4;
    expect(doorMotion(0, H)).toEqual({ angle: 0, lift: 0, inside: 0 });
    const open = doorMotion(1, H);
    expect(open.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(open.lift).toBeCloseTo(H, 12);
    expect(open.inside).toBeCloseTo(H, 12);
    for (const t of [0.1, 0.3, 0.5, 0.8]) {
      const m = doorMotion(t, H);
      // bottom edge at (0, lift), top edge at (inside, H): the leaf keeps its height H as its length
      expect(Math.hypot(m.inside, H - m.lift)).toBeCloseTo(H, 9);
    }
    expect(doorMotion(-1, H)).toEqual(doorMotion(0, H));
    expect(doorMotion(7, H)).toEqual(doorMotion(1, H));
    expect(doorMotion(Number.NaN, H)).toEqual(doorMotion(0, H));
  });
});

describe("buildGarageDoor", () => {
  it("finds the leaf of the garage opening by role and id, and opens it level under the head, inside the garage", () => {
    const { viewer, house, leaf } = fake(true);
    const before = worldBox(leaf);
    const door = buildGarageDoor(viewer, house);
    expect(door.available).toBe(true);
    expect(door.count).toBe(1);
    door.setOpen(1, { animate: false });
    expect(door.open).toBe(1);
    const after = worldBox(leaf);
    // level: thin in height, at the head
    expect(after.max.y - after.min.y).toBeLessThan(0.1);
    expect(after.max.y).toBeCloseTo(garage.head, 1);
    // inside: towards the room from the wall (the opposite of the outward normal)
    const a = (garage.azimuth! * Math.PI) / 180;
    const outward = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    const c0 = before.getCenter(new THREE.Vector3()), c1 = after.getCenter(new THREE.Vector3());
    expect(c1.clone().sub(c0).dot(outward)).toBeLessThan(-0.5);
    // closing puts it back exactly
    door.setOpen(0, { animate: false });
    const back = worldBox(leaf);
    expect(back.min.distanceTo(before.min)).toBeLessThan(1e-9);
    expect(back.max.distanceTo(before.max)).toBeLessThan(1e-9);
  });

  it("eases to the target in the frame loop and leaves the door closed on dispose", () => {
    const { viewer, house, leaf, frames } = fake(true);
    const before = worldBox(leaf);
    const door = buildGarageDoor(viewer, house);
    door.setOpen(1);
    expect(frames).toHaveLength(1);
    let redraws = 0;
    for (let i = 0; i < 200; i++) if (frames[0](0.05)) redraws++;
    expect(redraws).toBeGreaterThan(5);
    expect(worldBox(leaf).max.y - worldBox(leaf).min.y).toBeLessThan(0.1);
    door.dispose();
    expect(frames).toHaveLength(0);
    expect(worldBox(leaf).max.distanceTo(before.max)).toBeLessThan(1e-9);
  });

  it("is unavailable and harmless with a file that has no door leaf", () => {
    const { viewer, house } = fake(false);
    const door = buildGarageDoor(viewer, house);
    expect(door.available).toBe(false);
    door.setOpen(1, { animate: false });
    expect(door.open).toBe(1);
    door.dispose();
  });
});
