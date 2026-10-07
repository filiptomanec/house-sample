import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { toScene } from "./frame";
import { INTERIOR_MAX_SHADE, INTERIOR_MAX_VERTS, createInteriorFill, interiorRegionOf, shadeBoxesOf } from "./interior";

const ctx = getHouseContext();

/** Brute-force point in polygon (ray casting along +x), independent of the implementation. */
function inPoly(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let hits = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a[1] > y === b[1] > y) continue;
    const xi = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    if (xi > x) hits++;
  }
  return hits % 2 === 1;
}

describe("interiorRegionOf", () => {
  const region = interiorRegionOf(ctx);

  it("is the outline of the building, inset to the middle of the wall, from under the slab to the ceiling", () => {
    expect(region.ring).toEqual(ctx.derived.outline.polygons[0].pts);
    expect(region.inset).toBeCloseTo(ctx.derived.wall.ext / 2, 12);
    expect(region.zFloor).toBe(-ctx.house.slab);
    expect(region.zFloor).toBeLessThan(0);
    expect(region.zCeil).toBe(ctx.house.clearHeight);
    expect(region.ring.length).toBeLessThanOrEqual(INTERIOR_MAX_VERTS);
  });

  it("refuses an outline with more corners than the shader holds", () => {
    const ring = Array.from({ length: INTERIOR_MAX_VERTS + 1 }, (_, i) => [Math.cos(i), Math.sin(i)] as [number, number]);
    const big = { ...ctx, derived: { ...ctx.derived, outline: { ...ctx.derived.outline, polygons: [{ pts: ring, area: 1 }] } } };
    expect(() => interiorRegionOf(big)).toThrow(/corners/);
  });
});

describe("shadeBoxesOf", () => {
  const boxes = shadeBoxesOf(ctx);
  const covered = ctx.derived.outdoor.filter((o) => o.covered);

  it("makes one box per covered outdoor area, over its rectangle", () => {
    expect(boxes.length).toBe(Math.min(covered.length, INTERIOR_MAX_SHADE));
    covered.slice(0, boxes.length).forEach((o, i) => {
      expect([boxes[i].min[0], boxes[i].min[1], boxes[i].max[0], boxes[i].max[1]]).toEqual(o.rect);
    });
  });

  it("reaches from under the paving to the underside of the roof, at least a ceiling high and below the ridge", () => {
    for (const b of boxes) {
      expect(b.min[2]).toBeLessThan(0);
      expect(b.max[2]).toBeGreaterThanOrEqual(ctx.house.clearHeight);
      expect(b.max[2]).toBeLessThan(ctx.derived.bbox.z1);
    }
  });
});

describe("InteriorFill", () => {
  const region = interiorRegionOf(ctx);
  const fill = createInteriorFill();
  fill.setRegion(region);

  it("contains exactly what is inside the outline between the slab and the ceiling (scene frame in, house frame out)", () => {
    let seed = 3;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const b = ctx.derived.bbox;
    for (let i = 0; i < 4000; i++) {
      const x = b.x0 + rnd() * b.w, y = b.y0 + rnd() * b.d, z = -1 + rnd() * 5;
      const [sx, sy, sz] = toScene([x, y, z]);
      const expected = inPoly(x, y, region.ring) && z >= region.zFloor && z <= region.zCeil;
      expect(fill.contains(new THREE.Vector3(sx, sy, sz)), `${x},${y},${z}`).toBe(expected);
    }
  });

  it("finds the label point of every room inside, at standing height", () => {
    for (const r of ctx.derived.rooms) {
      const [sx, sy, sz] = toScene([r.label.x, r.label.y, 1.2]);
      expect(fill.contains(new THREE.Vector3(sx, sy, sz)), r.id).toBe(true);
    }
  });

  it("patches a standard material once, keeps an existing hook and sets a program key", () => {
    const m = new THREE.MeshStandardMaterial();
    let prevCalls = 0;
    m.onBeforeCompile = () => { prevCalls++; };
    fill.patch(m);
    const hook = m.onBeforeCompile, key = m.customProgramCacheKey();
    fill.patch(m);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.customProgramCacheKey()).toBe(key);
    expect(key).toContain("interior");
    const shader = { uniforms: {} as Record<string, unknown>, fragmentShader: "#include <common>\n#include <lights_fragment_end>\n" };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(prevCalls).toBe(1);
    // the capacity is defined exactly once (a second definition would not compile), and the fragment code is injected
    expect(shader.fragmentShader.match(/#define INTERIOR_N /g)).toHaveLength(1);
    expect(shader.fragmentShader).toContain("interiorMask");
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(["interiorPoly", "interiorCount", "interiorSide", "shadeCount"]));
  });

  it("leaves transparent materials alone (glass would turn milky) and materials that are not standard", () => {
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 });
    const before = glass.onBeforeCompile;
    fill.patch(glass);
    expect(glass.onBeforeCompile).toBe(before);
    const basic = new THREE.MeshBasicMaterial();
    fill.patch(basic);
    expect(basic.userData.interior).toBeUndefined();
  });

  it("gives mirrors their own program (the reflection comes from the room)", () => {
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
    b.userData.mirror = true;
    fill.patch(a); fill.patch(b);
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    const shader = { uniforms: {}, fragmentShader: "#include <common>\n#include <lights_fragment_end>\n" };
    b.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("#define INTERIOR_MIRROR");
  });

  it("follows the daylight: stronger by day, weaker and warmer at night; the sun side is brighter", () => {
    const f = createInteriorFill();
    const read = (alt: number) => {
      f.setDaylight(alt, [0, 1]);
      const m = new THREE.MeshStandardMaterial();
      f.patch(m);
      const sh = { uniforms: {} as Record<string, { value: THREE.Color & THREE.Vector3 }>, fragmentShader: "#include <common>\n#include <lights_fragment_end>" };
      m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
      // the uniforms are live objects: take a copy of the values at this daylight
      return { side: sh.uniforms.interiorSide.value.clone() as THREE.Color, dir: (sh.uniforms.interiorDir.value as unknown as THREE.Vector3).clone() };
    };
    const night = read(-20), noon = read(50);
    expect(noon.side.g).toBeGreaterThan(night.side.g);
    const warmth = (u: ReturnType<typeof read>) => u.side.b / u.side.r;
    expect(warmth(night)).toBeLessThan(warmth(noon));
    // the horizontal sun direction is kept as (x, -y) in the scene: north (house +y) is scene -z
    expect(noon.dir.z).toBeLessThan(0);
    expect(night.dir.length()).toBeLessThan(noon.dir.length());
  });

  it("holds at most the capacity of shade boxes", () => {
    const f = createInteriorFill();
    const box = { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    f.setShade(Array.from({ length: INTERIOR_MAX_SHADE + 3 }, () => box));
    const m = new THREE.MeshStandardMaterial();
    f.patch(m);
    const sh = { uniforms: {} as Record<string, { value: number }>, fragmentShader: "#include <common>\n#include <lights_fragment_end>" };
    m.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(sh.uniforms.shadeCount.value).toBe(INTERIOR_MAX_SHADE);
  });
});
