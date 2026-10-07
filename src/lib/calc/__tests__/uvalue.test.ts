// Tests of uvalue.ts: hand-computed constructions, agreement with the kernel's assemblyU on the model and on random stacks,
// the ventilated-layer rule, what-if helpers and the floor on the ground (EN ISO 13370) against hand calculations.
import { describe, expect, it } from "vitest";
import { assemblyU } from "@/lib/model/derive";
import { derived, house } from "@/lib/model/instance";
import type { Assembly, Layer } from "@/lib/model/types";
import { assemblyBreakdown, floorOnGround, layerResistance, SURFACE_RESISTANCE, thicknessForU, uValue, withLayerThickness } from "../uvalue";

const text = { cs: "x", en: "x" };
const layer = (id: string, t: number, rest: Partial<Layer>): Layer => ({ id, name: text, t, ...rest }) as Layer;
const assembly = (layers: Layer[], rsi = 0.13, rse = 0.04): Assembly => ({ name: text, rsi, rse, layers });

/** Small seeded generator (mulberry32) so that the "random" stacks are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("layerResistance", () => {
  it("is t / lambda for a conductive layer and r for a fixed one", () => {
    expect(layerResistance(layer("a", 0.2, { lambda: 0.04 }))).toBeCloseTo(5, 12);
    expect(layerResistance(layer("b", 0.025, { r: 0.18 }))).toBe(0.18);
  });
  it("rejects layers that have no usable resistance", () => {
    expect(() => layerResistance(layer("a", 0, { lambda: 0.04 }))).toThrow(RangeError);
    expect(() => layerResistance(layer("a", 0.1, {}))).toThrow(RangeError);
    expect(() => layerResistance(layer("a", 0.1, { lambda: -1 }))).toThrow(RangeError);
    expect(() => layerResistance(layer("a", 0.1, { r: -0.1 }))).toThrow(RangeError);
  });
});

describe("assemblyBreakdown", () => {
  it("matches a hand calculation of a three-layer wall", () => {
    // 0.01/0.7 + 0.2/0.04 + 0.3/0.5 = 0.0142857 + 5 + 0.6 = 5.6142857; total with 0.13 + 0.04 = 5.7842857
    const a = assembly([layer("plaster", 0.01, { lambda: 0.7 }), layer("eps", 0.2, { lambda: 0.04 }), layer("block", 0.3, { lambda: 0.5 })]);
    const b = assemblyBreakdown(a);
    expect(b.rLayers).toBeCloseTo(0.01 / 0.7 + 5 + 0.6, 12);
    expect(b.rTotal).toBeCloseTo(0.17 + 0.01 / 0.7 + 5.6, 12);
    expect(b.u).toBeCloseTo(1 / b.rTotal, 12);
    expect(b.u).toBeCloseTo(0.17289, 4);
    expect(b.thickness).toBeCloseTo(0.51, 12);
    expect(b.ventilated).toBe(false);
  });

  it("makes the shares of the layers add up to 1", () => {
    const b = assemblyBreakdown(house.assemblies.exteriorWall);
    expect(b.layers.reduce((s, l) => s + l.share, 0)).toBeCloseTo(1, 12);
    for (const l of b.layers) expect(l.share).toBeGreaterThanOrEqual(0);
  });

  it("ignores a ventilated layer and everything outside it and uses rsi for rse", () => {
    const a = assembly([layer("cladding", 0.02, { lambda: 0.13 }), layer("gap", 0.04, { r: 0.2, ventilated: true }), layer("wood", 0.1, { lambda: 0.1 }), layer("board", 0.015, { lambda: 0.2 })], 0.13, 0.04);
    const b = assemblyBreakdown(a);
    expect(b.ventilated).toBe(true);
    expect(b.layers.map((l) => l.ignored)).toEqual([true, true, false, false]);
    expect(b.layers[0].resistance).toBe(0);
    expect(b.rLayers).toBeCloseTo(1 + 0.075, 12);
    expect(b.rse).toBe(0.13);
    expect(b.rTotal).toBeCloseTo(0.13 + 1.075 + 0.13, 12);
  });

  it("does not change the argument", () => {
    const a = assembly([layer("a", 0.1, { lambda: 0.1 })]);
    const copy = JSON.stringify(a);
    assemblyBreakdown(a);
    expect(JSON.stringify(a)).toBe(copy);
  });
});

describe("agreement with the kernel", () => {
  it("equals assemblyU for every assembly of the model", () => {
    for (const [key, a] of Object.entries(house.assemblies)) {
      expect(Math.abs(uValue(a) - assemblyU(a).U), key).toBeLessThan(1e-4);
      expect(Math.abs(assemblyBreakdown(a).rLayers - assemblyU(a).R), key).toBeLessThan(1e-4);
      expect(Math.abs(uValue(a) - derived.assemblies[key].U), key).toBeLessThan(1e-4);
    }
  });

  it("equals assemblyU for random layer stacks, with and without a ventilated layer", () => {
    const next = rng(2024);
    for (let n = 0; n < 200; n++) {
      const count = 1 + Math.floor(next() * 7);
      const layers: Layer[] = Array.from({ length: count }, (_, i) =>
        next() < 0.2
          ? layer(`l${i}`, 0.005 + next() * 0.05, { r: next() * 0.4, ...(next() < 0.3 ? { ventilated: true } : {}) })
          : layer(`l${i}`, 0.005 + next() * 0.4, { lambda: 0.03 + next() * 1.5 }),
      );
      // the kernel looks for the first ventilated layer; keep only one flag so that both read the same stack
      let seen = false;
      for (const l of layers) {
        if (l.ventilated && seen) delete l.ventilated;
        if (l.ventilated) seen = true;
      }
      const a = assembly(layers, 0.1 + next() * 0.1, 0.03 + next() * 0.05);
      expect(Math.abs(uValue(a) - assemblyU(a).U)).toBeLessThan(1e-4);
    }
  });
});

describe("what-if helpers", () => {
  const base = assembly([layer("finish", 0.01, { lambda: 0.7 }), layer("insulation", 0.1, { lambda: 0.04 }), layer("structure", 0.2, { lambda: 0.8 })]);

  it("withLayerThickness changes one layer and leaves the original alone", () => {
    const thicker = withLayerThickness(base, "insulation", 0.2);
    expect(thicker.layers[1].t).toBe(0.2);
    expect(base.layers[1].t).toBe(0.1);
    expect(uValue(thicker)).toBeLessThan(uValue(base));
    expect(() => withLayerThickness(base, "nope", 0.2)).toThrow(RangeError);
    expect(() => withLayerThickness(base, "insulation", 0)).toThrow(RangeError);
  });

  it("thicknessForU is the inverse of withLayerThickness + uValue", () => {
    for (const target of [0.1, 0.15, 0.2]) {
      const t = thicknessForU(base, "insulation", target);
      expect(t).not.toBeNull();
      expect(uValue(withLayerThickness(base, "insulation", t as number))).toBeCloseTo(target, 10);
    }
  });

  it("thicknessForU answers null when the target is met without the layer, for a layer without effect, and for a bad target", () => {
    expect(thicknessForU(base, "insulation", 5)).toBeNull();
    expect(thicknessForU(base, "insulation", 0)).toBeNull();
    expect(thicknessForU(base, "insulation", Number.NaN)).toBeNull();
    const vent = assembly([layer("cladding", 0.02, { lambda: 0.13 }), layer("gap", 0.04, { r: 0.2, ventilated: true }), layer("wood", 0.1, { lambda: 0.1 })]);
    expect(thicknessForU(vent, "cladding", 0.5)).toBeNull();
    expect(thicknessForU(vent, "gap", 0.5)).toBeNull();
    expect(thicknessForU(vent, "wood", 0.5)).not.toBeNull();
    expect(() => thicknessForU(base, "nope", 0.2)).toThrow(RangeError);
  });
});

describe("SURFACE_RESISTANCE (EN ISO 6946, table 7)", () => {
  it("has the standard values", () => {
    expect(SURFACE_RESISTANCE.horizontal).toEqual({ rsi: 0.13, rse: 0.04 });
    expect(SURFACE_RESISTANCE.up.rsi).toBe(0.1);
    expect(SURFACE_RESISTANCE.down.rsi).toBe(0.17);
  });
});

describe("floorOnGround (EN ISO 13370)", () => {
  const base = { area: 100, exposedPerimeter: 40, wallThickness: 0.4, floorResistance: 3, rsi: 0.17, rse: 0.04, soilLambda: 2, periodicDepthM: 3.2 };

  it("matches a hand calculation of the well-insulated branch (d_t >= B')", () => {
    // B' = 100 / 20 = 5, d_t = 0.4 + 2 (0.17 + 3 + 0.04) = 6.82 >= 5 -> U = 2 / (0.457 * 5 + 6.82)
    const f = floorOnGround(base);
    expect(f.bPrime).toBeCloseTo(5, 12);
    expect(f.dt).toBeCloseTo(6.82, 12);
    expect(f.u).toBeCloseTo(2 / (0.457 * 5 + 6.82), 12);
    expect(f.hSteady).toBeCloseTo(100 * f.u, 10);
    expect(f.hPeriodic).toBeCloseTo(0.37 * 40 * 2 * Math.log(3.2 / 6.82 + 1), 12);
  });

  it("matches a hand calculation of the uninsulated branch (d_t < B')", () => {
    // B' = 100 / 10 = 10 (P = 20), d_t = 0.4 + 2 (0.17 + 0.5 + 0.04) = 1.82 < 10
    const f = floorOnGround({ ...base, exposedPerimeter: 20, floorResistance: 0.5 });
    const bp = 10, dt = 1.82;
    expect(f.u).toBeCloseTo(((2 * 2) / (Math.PI * bp + dt)) * Math.log((Math.PI * bp) / dt + 1), 12);
  });

  it("is continuous at d_t = B' within a few percent (the two branches describe the same physics)", () => {
    // choose the floor resistance so that d_t is just below and just above B' = 5
    const at = (dt: number) => floorOnGround({ ...base, floorResistance: (dt - 0.4) / 2 - 0.21 });
    const below = at(4.99), above = at(5.01);
    expect(below.dt).toBeLessThan(below.bPrime);
    expect(above.dt).toBeGreaterThan(above.bPrime);
    expect(Math.abs(below.u - above.u) / above.u).toBeLessThan(0.06);
  });

  it("falls with more insulation and with a larger B' (more area per metre of perimeter)", () => {
    let last = Infinity;
    for (const r of [0, 0.5, 1, 2, 4, 8]) {
      const u = floorOnGround({ ...base, floorResistance: r }).u;
      expect(u).toBeLessThan(last);
      last = u;
    }
    last = Infinity;
    for (const area of [30, 60, 120, 240, 480]) {
      const u = floorOnGround({ ...base, area }).u;
      expect(u).toBeLessThan(last);
      last = u;
    }
  });

  it("gives zeros, never NaN, for no area or no perimeter", () => {
    for (const bad of [{ area: 0 }, { exposedPerimeter: 0 }, { area: -3 }]) {
      const f = floorOnGround({ ...base, ...bad });
      expect(f).toEqual({ bPrime: 0, dt: 0, u: 0, hSteady: 0, hPeriodic: 0 });
    }
  });

  it("rejects an equivalent thickness of zero", () => {
    expect(() => floorOnGround({ ...base, wallThickness: 0, soilLambda: 0 })).toThrow(RangeError);
  });
});
