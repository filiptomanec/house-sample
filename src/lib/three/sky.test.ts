// The sky of the 3D scene: AgX in JS equals three's shader, its inverse puts the tokens on the screen, the sky follows the sun
// and never the colour scheme, the acceptance lightness of the plan (zenith and horizon at noon and at a low winter sun), and
// the bake threshold.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { localToUtc, placeOf, sunPosition } from "@/lib/calc/sun";
import { house } from "@/lib/model/instance";
import {
  REBAKE, SKY_TOKENS, agx, backdropIntensity, createSkyDome, displayOf, inverseAgx, lightnessOf, needsRebake, readSkyPalette, skyAt, skyLight,
  skyRadiance, skyUniforms, type Rgb,
} from "./sky";
import { EXPOSURE } from "./viewer";

const root = join(__dirname, "..", "..", "..");
const shader = readFileSync(join(root, "node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js"), "utf8");
const tokensCss = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
const palette = readSkyPalette();
const rgb = (c: THREE.Color): Rgb => [c.r, c.g, c.b];
const place = placeOf(house);
const altitudeAt = (month: number, day: number, hours: number) => sunPosition(localToUtc(place.tz, { year: 2026, month, day }, hours), place).altitude;

/** What the dome shows at the zenith and on the horizon line for a sun altitude (display-linear), as the shader computes it. */
function shown(altitude: number) {
  const state = skyAt(altitude, palette);
  const r = skyRadiance(state, EXPOSURE);
  return {
    top: displayOf(r.top.clone().multiplyScalar(state.intensity), EXPOSURE),
    horizon: displayOf(r.horizon.clone().multiplyScalar(state.intensity), EXPOSURE),
  };
}

describe("agx (a JS copy of three's AgXToneMapping)", () => {
  it("uses the constants of the shader three draws with", () => {
    for (const n of ["0.856627153315983", "1.1271005818144368", "-12.47393".replace("-", "- "), "4.026069", "15.5", "40.14", "31.96", "6.868", "0.4298", "0.1191", "0.00232", "1.6605", "0.6274"]) {
      expect(shader.includes(n), n).toBe(true);
    }
  });

  it("maps radiance into 0..1, black to (nearly) black, and grows with the radiance", () => {
    expect(Math.max(...agx([0, 0, 0]))).toBeLessThan(1e-3);
    let prev = -1;
    for (let e = -10; e <= 6; e += 0.5) {
      const y = agx([2 ** e, 2 ** e, 2 ** e]);
      for (const v of y) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(y[1]).toBeGreaterThanOrEqual(prev);
      prev = y[1];
    }
    // exposure is a multiplier of the radiance
    const a = agx([0.2, 0.3, 0.4], 2), b = agx([0.4, 0.6, 0.8]);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
  });
});

describe("inverseAgx", () => {
  it("returns the radiance AgX turns into the colour: every sky token and every colour the sky blends at any altitude", () => {
    const colours: Rgb[] = Object.values(palette).map(rgb);
    for (let a = -14; a <= 30; a += 0.5) { const st = skyAt(a, palette); colours.push(rgb(st.top), rgb(st.horizon)); }
    for (const c of colours) {
      const back = agx(inverseAgx(c, EXPOSURE), EXPOSURE);
      back.forEach((v, i) => expect(Math.abs(v - c[i]), `${c}`).toBeLessThan(2e-4));
    }
  });
});

describe("the sky follows the sun, never the colour scheme", () => {
  it("reads only scheme-independent tokens: each --sky-* key is written once in tokens.css, in :root, with the fallback's value", () => {
    for (const [token, fallback] of Object.values(SKY_TOKENS)) {
      const defs = [...tokensCss.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, "g"))].map((m) => m[1].trim().toLowerCase());
      expect(defs, token).toEqual([fallback]);
    }
  });

  it("shows the day tokens at full strength with the sun up, night colours dimmed below the horizon", () => {
    const noon = skyAt(55, palette);
    expect(noon.top.getHexString()).toBe(palette.dayTop.getHexString());
    expect(noon.horizon.getHexString()).toBe(palette.dayHorizon.getHexString());
    expect(noon.intensity).toBe(1);
    expect(noon.glowStrength).toBe(0);
    const night = skyAt(-20, palette);
    expect(night.top.getHexString()).toBe(palette.nightTop.getHexString());
    expect(night.intensity).toBeCloseTo(0.3, 12);
    // the zenith only gets lighter as the sun rises
    let prev = -1;
    for (let a = -20; a <= 60; a += 1) { const l = lightnessOf(shown(a).top); expect(l).toBeGreaterThanOrEqual(prev - 1e-9); prev = l; }
  });

  it("never dims the backdrop while the sun is above 3 degrees: 0.3 + 0.7 smoothstep(alt, -6, 3)", () => {
    expect(backdropIntensity(-30)).toBeCloseTo(0.3, 12);
    expect(backdropIntensity(-1.5)).toBeCloseTo(0.65, 12);
    for (const a of [3, 5, 12, 40, 80]) expect(backdropIntensity(a)).toBe(1);
  });

  it("puts the token on the screen: the shown zenith at noon is the day token", () => {
    const top = shown(60).top;
    rgb(top).forEach((v, i) => expect(Math.abs(v - rgb(palette.dayTop)[i])).toBeLessThan(2e-4));
  });

  it("meets the plan's lightness on 21 June 13:00 (zenith >= 76, horizon >= 90) and on 21 December 15:30 (horizon >= 80)", () => {
    const june = shown(altitudeAt(5, 21, 13));
    expect(lightnessOf(june.top)).toBeGreaterThanOrEqual(76);
    expect(lightnessOf(june.horizon)).toBeGreaterThanOrEqual(90);
    const dec = shown(altitudeAt(11, 21, 15.5));
    expect(altitudeAt(11, 21, 15.5)).toBeGreaterThan(0);
    expect(lightnessOf(dec.horizon)).toBeGreaterThanOrEqual(80);
  });

  it("glows warm white near a low sun only, and the glow is not orange", () => {
    expect(skyAt(3, palette).glowStrength).toBeGreaterThan(0.5);
    expect(skyAt(30, palette).glowStrength).toBe(0);
    const c = palette.glow.clone().convertLinearToSRGB();
    expect(Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)).toBeLessThan(0.15); // a pale warm white, not a saturated orange
    expect(Math.min(c.r, c.g, c.b)).toBeGreaterThan(0.8);
  });
});

describe("lighting dome and bake", () => {
  it("lights the ground half with the reflected sunlight, in proportion to the irradiance", () => {
    const state = skyAt(40, palette);
    const lawn = new THREE.Color("#5f7f45");
    const a = skyLight(state, lawn, 2, 0.35), b = skyLight(state, lawn, 4, 0.35);
    expect(b.ground.g).toBeCloseTo(2 * a.ground.g, 9);
    expect(a.ground.g).toBeGreaterThan(0);
    expect(a.top.getHexString()).toBe(state.top.getHexString());
  });

  it("re-bakes only when the sun moved at least the threshold (azimuth across north too)", () => {
    expect(needsRebake(null, 10, 100)).toBe(true);
    expect(needsRebake({ altitude: 10, azimuth: 100 }, 10 + REBAKE.altitudeDeg * 0.9, 100 + REBAKE.azimuthDeg * 0.9)).toBe(false);
    expect(needsRebake({ altitude: 10, azimuth: 100 }, 10 + REBAKE.altitudeDeg, 100)).toBe(true);
    expect(needsRebake({ altitude: 10, azimuth: 358 }, 10, 2)).toBe(false);
    expect(needsRebake({ altitude: 10, azimuth: 358 }, 10, 358 + REBAKE.azimuthDeg - 360)).toBe(true);
  });

  it("draws the dome as a tone-mapped, depth-free backdrop that rays ignore", () => {
    const dome = createSkyDome(skyUniforms());
    const m = dome.material as THREE.ShaderMaterial;
    expect(m.toneMapped).toBe(true);
    expect(m.fragmentShader).toContain("#include <tonemapping_fragment>");
    expect(m.fragmentShader).toContain("#include <colorspace_fragment>");
    expect(m.depthWrite).toBe(false);
    expect(m.fog).toBe(false);
    expect(dome.frustumCulled).toBe(false);
    const hits: THREE.Intersection[] = [];
    dome.raycast(new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 1, 0)), hits);
    expect(hits).toHaveLength(0);
    const bake = createSkyDome(skyUniforms(), { forBake: true });
    expect((bake.material as THREE.ShaderMaterial).uniforms.uGroundMix.value).toBe(1);
  });
});
