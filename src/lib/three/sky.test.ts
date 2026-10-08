// The compensation for the neutral tone mapper (backdrop and fog reach the screen through the output pass without a material).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { NEUTRAL_INVERSE_LIMIT, inverseNeutralToneMapping } from "./sky";

/** THREE.NeutralToneMapping (the Khronos PBR neutral tone mapper) as the fragment shader writes it, exposure 1. */
function neutral([r, g, b]: [number, number, number]): [number, number, number] {
  const startCompression = 0.8 - 0.04, desaturation = 0.15;
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c: [number, number, number] = [r - offset, g - offset, b - offset];
  const peak = Math.max(...c);
  if (peak < startCompression) return c;
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  c = c.map((v) => (v * newPeak) / peak) as [number, number, number];
  const gm = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return c.map((v) => v + (newPeak - v) * gm) as [number, number, number];
}

const srgbOf = (c: THREE.Color) => c.getHexString();

describe("inverseNeutralToneMapping", () => {
  it("what the mapper makes of the compensated colour is the colour itself (dark and mid colours)", () => {
    const levels = [0, 0.002, 0.01, 0.039, 0.04, 0.041, 0.08, 0.2, 0.45, 0.69];
    for (const r of levels) for (const g of levels) for (const b of levels) {
      const c = new THREE.Color(r, g, b);
      expect(Math.max(r, g, b)).toBeLessThan(NEUTRAL_INVERSE_LIMIT);
      const back = neutral(inverseNeutralToneMapping(c).toArray() as [number, number, number]);
      expect(back[0]).toBeCloseTo(r, 9);
      expect(back[1]).toBeCloseTo(g, 9);
      expect(back[2]).toBeCloseTo(b, 9);
    }
  });
  it("bright colours are returned unchanged, and the input is never modified", () => {
    const light = new THREE.Color("#cfdce4"), copy = light.clone();
    expect(srgbOf(inverseNeutralToneMapping(light))).toBe(srgbOf(light));
    expect(light.equals(copy)).toBe(true);
    const dark = new THREE.Color("#1d252b"), keep = dark.clone();
    inverseNeutralToneMapping(dark);
    expect(dark.equals(keep)).toBe(true);
  });
  it("without it a dark slate backdrop comes out darker and bluer; with it the screen shows the token", () => {
    const token = new THREE.Color("#1d252b");
    const bare = new THREE.Color(...neutral(token.toArray() as [number, number, number]));
    const compensated = new THREE.Color(...neutral(inverseNeutralToneMapping(token).toArray() as [number, number, number]));
    expect(srgbOf(compensated)).toBe(srgbOf(token));
    expect(bare.r * 255).toBeLessThan(token.r * 255 / 2); // the red channel collapses
    expect(srgbOf(bare)).not.toBe(srgbOf(token));
  });
  it("black stays black", () => {
    expect(inverseNeutralToneMapping(new THREE.Color(0, 0, 0)).toArray()).toEqual([0, 0, 0]);
  });
});
