import { describe, expect, it } from "vitest";
import { MeshBuilder } from "./meshBuilder";
import { fromScene } from "./frame";

/** Signed volume of a closed triangle soup (scene frame): positive when the faces point outwards. */
function volume(mb: MeshBuilder): number {
  const p = mb.positions;
  let v = 0;
  for (let t = 0; t < p.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.slice(t, t + 9);
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe("MeshBuilder", () => {
  const square: [number, number][] = [[0, 0], [2, 0], [2, 3], [0, 3]];

  it("extrudes a counter-clockwise ring into a closed solid with outward faces (volume = area x height)", () => {
    const mb = new MeshBuilder().prism(square, () => 1, () => 4);
    expect(volume(mb)).toBeCloseTo(2 * 3 * 3, 9);
    // 4 side quads (8 triangles) plus top and bottom fans of 2 triangles each
    expect(mb.triangleCount).toBe(12);
  });

  it("follows a sloped base and top (a wedge)", () => {
    // the bottom is flat at 0, the top rises from 1 to 3 along the ring: the volume is the plan area times the mean top height
    const mb = new MeshBuilder().prism(square, () => 0, (i) => (i === 0 || i === 3 ? 1 : 3));
    expect(volume(mb)).toBeCloseTo(2 * 3 * 2, 9);
  });

  it("stores vertices in the scene frame: house (x, y, z) is scene (x, z, -y)", () => {
    const mb = new MeshBuilder().tri([1, 2, 3], [4, 5, 6], [7, 8, 9]);
    const p = mb.positions;
    expect([p[0], p[1], p[2]]).toEqual([1, 3, -2]);
    expect(fromScene([p[0], p[1], p[2]])).toEqual([1, 2, 3]);
  });

  it("makes geometry with unit flat normals that point out of a closed solid", () => {
    const g = new MeshBuilder().prism(square, () => 0, () => 1).toGeometry();
    const pos = g.attributes.position, nor = g.attributes.normal;
    expect(g.attributes.uv.count).toBe(pos.count);
    const cx = 1, cy = 0.5, cz = -1.5; // the centre of the solid in the scene frame
    for (let i = 0; i < pos.count; i++) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 6);
      const out = (pos.getX(i) - cx) * nor.getX(i) + (pos.getY(i) - cy) * nor.getY(i) + (pos.getZ(i) - cz) * nor.getZ(i);
      expect(out).toBeGreaterThan(0);
    }
  });
});
