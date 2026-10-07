// Interior light of the rooms. The sky environment has no occlusion, so rooms out of the sun would get only a dim, blue sky
// light: white plaster reads blue-grey and light oak grey-taupe. In a real room daylight bounces off the walls and the floor
// and arrives from all sides, warm. The interior fill adds that light, keeps only part of the sky IBL indoors and lets
// glossy surfaces reflect the room instead of the sky, but only for fragments inside the interior region (the footprint
// of the building, inset to mid-wall, from the floor to the ceiling); facades, terraces and the garden keep the exterior
// lighting. A warm bounce under covered outdoor areas (the shade boxes) is added in the same shader hook.
//
// Differences from the earlier shader (docs/THREE-API.md section 5):
//  * The region is a polygon uniform array of fixed size (`INTERIOR_MAX_VERTS`) with a vertex count, so changing the
//    outline never needs a recompile or throws.
//  * One InteriorFill per viewer, no module-level state: materials of a disposed scene keep nothing alive.
//  * The scene is in the house frame (Y-up mapped), so the shader needs no plan matrix: plan x = world x, plan y = -world z.
import * as THREE from "three";
import { roofSurfaceAt, type Pt, type Pt3 } from "@/lib/model";
import type { HouseContext } from "./context";

/** Capacity of the polygon uniform array (the outline of an L- or U-shaped house has far fewer corners). */
export const INTERIOR_MAX_VERTS = 64;
/** Capacity of the shade boxes (covered outdoor areas). */
export const INTERIOR_MAX_SHADE = 4;

/** The part of the world that is "indoors" (house frame, metres). */
export interface InteriorRegion {
  /** Counter-clockwise outline of the building including walls (`derived.outline.polygons[0].pts`). */
  ring: readonly Pt[];
  /** The fill starts `inset` inside the ring (mid-wall: `derived.wall.ext / 2`). */
  inset: number;
  /** From just below the floor to the ceiling, metres above the floor (`house.clearHeight`). */
  zFloor: number;
  zCeil: number;
}

/** A box (house frame) under a covered outdoor area that gets the warm shade fill; it fades out around its edges. */
export interface ShadeBox {
  min: Pt3;
  max: Pt3;
}

/** The fill reaches this far above the ceiling before it fades out (the ceiling surface itself must still be lit), metres. */
const CEILING_FADE = 0.1;

/** The interior region of the house: outline ring, mid-wall inset, floor and ceiling heights. Throws when the ring has more than `INTERIOR_MAX_VERTS` corners. */
export function interiorRegionOf(ctx: HouseContext): InteriorRegion {
  const ring = ctx.derived.outline.polygons[0]?.pts ?? [];
  if (ring.length > INTERIOR_MAX_VERTS) throw new Error(`interior: outline has ${ring.length} corners, the limit is ${INTERIOR_MAX_VERTS}`);
  return {
    ring: ring.map((p): Pt => [p[0], p[1]]),
    inset: ctx.derived.wall.ext / 2,
    // the slab is under the floor: its underside is the lowest point that still belongs to the rooms
    zFloor: -ctx.house.slab,
    zCeil: ctx.house.clearHeight,
  };
}

/** One box per covered outdoor area (`derived.outdoor[].covered`), from below the paving to the underside of the roof above it. At most `INTERIOR_MAX_SHADE`. */
export function shadeBoxesOf(ctx: HouseContext): ShadeBox[] {
  const { derived, house } = ctx;
  const thickness = derived.assemblies.roof?.thickness ?? 0;
  const boxes: ShadeBox[] = [];
  for (const o of derived.outdoor) {
    if (!o.covered) continue;
    const [x0, y0, x1, y1] = o.rect;
    // the lowest roof surface above the area, less the roof build-up, is the underside the shade sits under
    const samples: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
    const tops = samples.map(([x, y]) => roofSurfaceAt(derived.roofPlanes, x, y)?.z).filter((z): z is number => z !== undefined);
    const top = tops.length ? Math.min(...tops) - thickness : house.clearHeight;
    boxes.push({ min: [x0, y0, -house.slab], max: [x1, y1, Math.max(top, house.clearHeight)] });
  }
  return boxes.slice(0, INTERIOR_MAX_SHADE);
}

export interface InteriorFill {
  /** Sets (or changes) the region. May be called at any time; materials already patched pick it up on the next frame. */
  setRegion(region: InteriorRegion): void;
  setShade(boxes: readonly ShadeBox[]): void;
  /**
   * Strength and colour of the fill follow the daylight: `altitudeDeg` of the sun and its horizontal direction in the
   * house frame (x east, y north). By day about as strong as the sky light; towards night weaker and warmer (lamps).
   */
  setDaylight(altitudeDeg: number, sunHorizontal: readonly [number, number]): void;
  /**
   * Lets a standard material receive the fill (idempotent, keeps an existing `onBeforeCompile`). Not for transparent
   * materials (glass would turn milky from outside). A material with `userData.mirror` reflects the bright room
   * instead of the sky.
   */
  patch(material: THREE.Material): void;
  /** Is a point (scene frame) inside the region? Used for the ambient-occlusion radius and for tests. */
  contains(pointScene: Readonly<THREE.Vector3>): boolean;
  dispose(): void;
}

const GLSL_PARS = /* glsl */ `
#ifndef INTERIOR_N
#define INTERIOR_N ${INTERIOR_MAX_VERTS}
#define INTERIOR_SHADE_N ${INTERIOR_MAX_SHADE}
#endif
uniform vec2 interiorPoly[ INTERIOR_N ];
uniform int interiorCount;
uniform vec4 interiorBox;
uniform vec3 interiorZ;
uniform vec3 interiorSky;
uniform vec3 interiorSide;
uniform vec3 interiorGround;
uniform vec3 interiorDir;
uniform float interiorIbl;
uniform float interiorSpec;
uniform vec3 shadeMin[ INTERIOR_SHADE_N ];
uniform vec3 shadeMax[ INTERIOR_SHADE_N ];
uniform int shadeCount;
uniform vec3 shadeFill;
// 1 inside the walls (fading in over the wall thickness), 0 outside; p is in plan metres (x east, y north, z up)
float interiorMask( vec3 p ) {
  if ( interiorCount < 3 || p.z < interiorZ.x || p.z > interiorZ.y + ${CEILING_FADE.toFixed(2)} ) return 0.0;
  if ( p.x < interiorBox.x || p.y < interiorBox.y || p.x > interiorBox.z || p.y > interiorBox.w ) return 0.0;
  bool inside = false; float d = 1e4;
  for ( int i = 0; i < INTERIOR_N; i ++ ) {
    if ( i >= interiorCount ) break;
    vec2 a = interiorPoly[ i ], b = interiorPoly[ i == 0 ? interiorCount - 1 : i - 1 ];
    if ( ( a.y > p.y ) != ( b.y > p.y ) && p.x < ( b.x - a.x ) * ( p.y - a.y ) / ( b.y - a.y ) + a.x ) inside = ! inside;
    vec2 ab = b - a, ap = p.xy - a;
    d = min( d, length( ap - ab * clamp( dot( ap, ab ) / dot( ab, ab ), 0.0, 1.0 ) ) );
  }
  return inside ? smoothstep( interiorZ.z - 0.05, interiorZ.z + 0.05, d ) * ( 1.0 - smoothstep( interiorZ.y, interiorZ.y + ${CEILING_FADE.toFixed(2)}, p.z ) ) : 0.0;
}
// what a mirror shows (world reflection direction r): a light room, brighter towards the ceiling and the sunlit windows,
// the warm floor below, a slightly cool glass tint; never the sky or the horizon
vec3 interiorMirror( vec3 r ) {
  vec3 top = interiorSide * vec3( 1.32, 1.4, 1.46 ), low = interiorSide * vec3( 0.7, 0.58, 0.46 );
  vec3 c = mix( low, top, smoothstep( -0.5, 0.2, r.y ) );
  return c * ( 1.0 + 0.9 * dot( r.xz, interiorDir.xz ) );
}
`;

const GLSL_MAIN = /* glsl */ `
#if defined( RE_IndirectDiffuse ) && defined( RE_IndirectSpecular )
{
  // plan position from the view-space position: world = camera + R^T v (R = the view rotation); plan = (x, -z, y)
  vec3 interiorW = cameraPosition - vViewPosition * mat3( viewMatrix );
  vec3 interiorP = vec3( interiorW.x, - interiorW.z, interiorW.y );
  float interiorIn = interiorMask( interiorP ), interiorK = interiorIn;
  if ( interiorK > 0.0 ) {
    vec3 interiorN = inverseTransformDirection( normal, viewMatrix );
    // a little less light low down (the floor and the foot of walls and furniture), so rooms stay grounded without AO
    interiorK *= mix( 0.8, 1.0, smoothstep( interiorZ.x + 0.3, interiorZ.x + 1.7, interiorP.z ) );
    // the sunlit windows light the walls across the room: faces turned towards the sun get more, the others less
    vec3 interiorS = interiorSide * ( 1.0 + dot( interiorN.xz, interiorDir.xz ) );
    irradiance += interiorK * PI * mix( interiorS, interiorN.y > 0.0 ? interiorSky : interiorGround, abs( interiorN.y ) );
    iblIrradiance *= mix( 1.0, interiorIbl, interiorK );
    #ifdef INTERIOR_MIRROR
      radiance = mix( radiance, interiorMirror( inverseTransformDirection( reflect( - geometryViewDir, normal ), viewMatrix ) ), interiorK );
    #else
      radiance = mix( radiance, 0.8 * interiorSide, interiorK * interiorSpec );
    #endif
  }
  // under a covered outdoor area: a warm bounce instead of part of the cold sky light (not in the rooms behind the glass)
  float shadeK = 0.0;
  for ( int i = 0; i < INTERIOR_SHADE_N; i ++ ) {
    if ( i >= shadeCount ) break;
    vec3 shadeD = max( shadeMin[ i ] - interiorP, interiorP - shadeMax[ i ] );
    shadeK = max( shadeK, 1.0 - smoothstep( 0.0, 0.5, max( max( shadeD.x, shadeD.y ), shadeD.z ) ) );
  }
  shadeK *= 1.0 - interiorIn;
  if ( shadeK > 0.0 ) {
    irradiance += shadeK * PI * shadeFill;
    iblIrradiance *= 1.0 - 0.25 * shadeK;
  }
}
#endif
`;

const PROGRAM_KEY = "interior-v1";

export function createInteriorFill(): InteriorFill {
  const ring: Pt[] = [];
  let zFloor = 0, zCeil = 0;
  const uniforms = {
    interiorPoly: { value: Array.from({ length: INTERIOR_MAX_VERTS }, () => new THREE.Vector2()) },
    interiorCount: { value: 0 },
    interiorBox: { value: new THREE.Vector4(1e4, 1e4, -1e4, -1e4) },
    interiorZ: { value: new THREE.Vector3() }, // floor, ceiling, inset from the outer face (m)
    interiorSky: { value: new THREE.Color() }, // light from above (floors, table tops), linear
    interiorSide: { value: new THREE.Color() }, // light from the sides (walls, fronts)
    interiorGround: { value: new THREE.Color() }, // light from below (ceilings)
    interiorDir: { value: new THREE.Vector3() }, // towards the sun, horizontal, scaled by how much brighter the walls facing it are
    interiorIbl: { value: 0.45 }, // share of the diffuse sky IBL kept indoors
    interiorSpec: { value: 0.9 }, // share of the sky reflections replaced by the room
    shadeMin: { value: Array.from({ length: INTERIOR_MAX_SHADE }, () => new THREE.Vector3(1e4, 1e4, 1e4)) },
    shadeMax: { value: Array.from({ length: INTERIOR_MAX_SHADE }, () => new THREE.Vector3(-1e4, -1e4, -1e4)) },
    shadeCount: { value: 0 },
    shadeFill: { value: new THREE.Color() }, // warm bounce under covered outdoor areas, linear
  };
  const smooth = THREE.MathUtils.smoothstep;

  return {
    setRegion(region) {
      if (region.ring.length > INTERIOR_MAX_VERTS) throw new Error(`interior: ${region.ring.length} corners, the limit is ${INTERIOR_MAX_VERTS}`);
      ring.length = 0;
      ring.push(...region.ring);
      zFloor = region.zFloor;
      zCeil = region.zCeil;
      region.ring.forEach((p, i) => uniforms.interiorPoly.value[i].set(p[0], p[1]));
      uniforms.interiorCount.value = region.ring.length;
      const xs = region.ring.map((p) => p[0]), ys = region.ring.map((p) => p[1]);
      uniforms.interiorBox.value.set(Math.min(...xs) - 0.1, Math.min(...ys) - 0.1, Math.max(...xs) + 0.1, Math.max(...ys) + 0.1);
      uniforms.interiorZ.value.set(region.zFloor, region.zCeil, region.inset);
    },
    setShade(boxes) {
      const n = Math.min(boxes.length, INTERIOR_MAX_SHADE);
      for (let i = 0; i < INTERIOR_MAX_SHADE; i++) {
        const b = boxes[i];
        if (i < n) {
          // plan (x, y, z) -> the shader works in plan coordinates, so the boxes go in unchanged
          uniforms.shadeMin.value[i].set(b.min[0], b.min[1], b.min[2]);
          uniforms.shadeMax.value[i].set(b.max[0], b.max[1], b.max[2]);
        } else {
          uniforms.shadeMin.value[i].set(1e4, 1e4, 1e4);
          uniforms.shadeMax.value[i].set(-1e4, -1e4, -1e4);
        }
      }
      uniforms.shadeCount.value = n;
    },
    setDaylight(altitudeDeg, sunHorizontal) {
      // by day the walls and the floor bounce about as much light as the sky brings; towards night the fill is weaker and warmer
      const day = smooth(altitudeDeg, -8, 20), fill = 0.34 + 0.5 * day;
      uniforms.interiorSide.value.setRGB(1, 0.86 + 0.08 * day, 0.7 + 0.16 * day).multiplyScalar(fill * 1.14);
      uniforms.interiorSky.value.setRGB(1, 0.86 + 0.08 * day, 0.7 + 0.16 * day).multiplyScalar(fill * 1.02);
      uniforms.interiorGround.value.setRGB(1, 0.82 + 0.06 * day, 0.64 + 0.1 * day).multiplyScalar(fill * 0.75);
      uniforms.shadeFill.value.setRGB(1, 0.86, 0.68).multiplyScalar(0.3 * day);
      // house frame (x east, y north) to the scene frame (x, -y)
      uniforms.interiorDir.value.set(sunHorizontal[0], 0, -sunHorizontal[1]).normalize().multiplyScalar(0.24 * smooth(altitudeDeg, -2, 12));
    },
    patch(material) {
      const s = material as THREE.MeshStandardMaterial;
      // not for see-through materials: glass in the wall would turn milky from outside
      if (!s.isMeshStandardMaterial || s.transparent || s.userData.interior) return;
      s.userData.interior = true;
      const mirror = !!s.userData.mirror;
      const prev = s.onBeforeCompile, prevKey = s.customProgramCacheKey();
      s.onBeforeCompile = (sh, r) => {
        prev.call(s, sh, r);
        Object.assign(sh.uniforms, uniforms);
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", `#include <common>\n${mirror ? "#define INTERIOR_MIRROR\n" : ""}${GLSL_PARS}`)
          .replace("#include <lights_fragment_end>", `${GLSL_MAIN}\n#include <lights_fragment_end>`);
      };
      s.customProgramCacheKey = () => `${prevKey}|${PROGRAM_KEY}${mirror ? "m" : ""}`;
      s.needsUpdate = true;
    },
    contains(p) {
      const n = ring.length;
      if (n < 3) return false;
      const x = p.x, y = -p.z, z = p.y;
      if (z < zFloor || z > zCeil) return false;
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    dispose() {
      // the patched materials belong to the scene and go with it; nothing else is held here
      ring.length = 0;
      uniforms.interiorCount.value = 0;
      uniforms.shadeCount.value = 0;
    },
  };
}
