// A tiny non-indexed mesh builder for the generated parts (neighbour houses, fences, plants). Vertices are given in the HOUSE
// frame (x east, y north, z up) and stored in the scene frame; faces are listed counter-clockwise seen from outside, so the
// flat normals computed at the end point outwards. Pure three.js geometry, no GL context needed (tests use it in node).
import * as THREE from "three";
import type { Pt3 } from "@/lib/model";

export class MeshBuilder {
  private pos: number[] = [];
  private uv: number[] = [];

  get triangleCount(): number { return this.pos.length / 9; }

  /** The vertex positions as stored (scene frame, three numbers per vertex, three vertices per triangle). */
  get positions(): readonly number[] { return this.pos; }

  /** One triangle, counter-clockwise seen from outside; optional texture coordinates per vertex. */
  tri(a: Readonly<Pt3>, b: Readonly<Pt3>, c: Readonly<Pt3>, uvs?: readonly [number, number][]): this {
    for (const [i, p] of [a, b, c].entries()) {
      this.pos.push(p[0], p[2], -p[1]);
      this.uv.push(uvs?.[i]?.[0] ?? 0, uvs?.[i]?.[1] ?? 0);
    }
    return this;
  }

  /** A quad a-b-c-d (counter-clockwise seen from outside), split into two triangles. */
  quad(a: Readonly<Pt3>, b: Readonly<Pt3>, c: Readonly<Pt3>, d: Readonly<Pt3>, uvs?: readonly [number, number][]): this {
    this.tri(a, b, c, uvs && [uvs[0], uvs[1], uvs[2]]);
    this.tri(a, c, d, uvs && [uvs[0], uvs[2], uvs[3]]);
    return this;
  }

  /**
   * A closed extrusion of a convex or simple polygon (house-frame plan points, counter-clockwise) between two heights per
   * vertex: top face, bottom face and the side walls. `bottom` and `top` give the height at each vertex.
   */
  prism(ring: readonly (readonly [number, number])[], bottom: (i: number) => number, top: (i: number) => number): this {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad([ring[i][0], ring[i][1], bottom(i)], [ring[j][0], ring[j][1], bottom(j)], [ring[j][0], ring[j][1], top(j)], [ring[i][0], ring[i][1], top(i)]);
    }
    for (let i = 1; i + 1 < n; i++) {
      this.tri([ring[0][0], ring[0][1], top(0)], [ring[i][0], ring[i][1], top(i)], [ring[i + 1][0], ring[i + 1][1], top(i + 1)]);
      this.tri([ring[0][0], ring[0][1], bottom(0)], [ring[i + 1][0], ring[i + 1][1], bottom(i + 1)], [ring[i][0], ring[i][1], bottom(i)]);
    }
    return this;
  }

  /** Geometry with flat normals; empty builders give an empty geometry. */
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
