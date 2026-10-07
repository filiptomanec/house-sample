// U-values of layered constructions (EN ISO 6946) and of the floor on the ground (EN ISO 13370). Used by Energy (envelope
// table, what-if insulation) and by the Floor plan page (cards of the assemblies of the model).
//
// Contract: docs/CALC-API.md, section 6. Pure, no text. Layers are listed from the OUTSIDE of the heated volume to the inside
// (the floor from the ground upwards), exactly as in `house.assemblies`. The kernel already derives `{thickness, R, U}` for
// the shipped assemblies (`assemblyU`, src/lib/model/derive.ts); this module must agree with it to 1e-4 and adds the
// breakdown per layer, what-if helpers and the ground floor.
import type { LayerRole } from "@/lib/model/catalog";
import type { Assembly, Layer } from "@/lib/model/types";

/** Direction of heat flow through a construction, which selects the interior surface resistance. */
export type HeatFlow = "horizontal" | "up" | "down";

/**
 * Surface resistances of EN ISO 6946, table 7 (m2 K/W). The model stores `rsi`/`rse` per assembly (they win over these
 * defaults); the table is for what-if constructions that have no assembly yet.
 */
export const SURFACE_RESISTANCE: Record<HeatFlow, { rsi: number; rse: number }> = {
  horizontal: { rsi: 0.13, rse: 0.04 },
  up: { rsi: 0.1, rse: 0.04 },
  down: { rsi: 0.17, rse: 0.04 },
};

/** EN ISO 13370, 9.1: the coefficient of the well-insulated slab branch (d_t >= B'), and 0.37 of the external periodic coefficient (Annex H). */
const SLAB_FACTOR = 0.457;
const PERIODIC_FACTOR = 0.37;

/** One layer of a breakdown. */
export interface LayerBreakdown {
  /** Layer id from the model (label; keys of a React list, not logic). */
  id: string;
  role: LayerRole | null;
  /** Thickness, m. */
  thickness: number;
  /** Conductivity, W/(m K), or null for layers given by a fixed resistance. */
  lambda: number | null;
  /** Thermal resistance of the layer, m2 K/W (`r`, or `t / lambda`). Counted as 0 when `ignored`, see below. */
  resistance: number;
  ventilated: boolean;
  /** True for layers outside a ventilated layer (EN ISO 6946, 6.9): they do not contribute. */
  ignored: boolean;
  /** Share of this layer in the total resistance of the construction, 0..1 (0 when ignored). For stacked bars. */
  share: number;
}

/** Full result for one construction. */
export interface AssemblyBreakdown {
  layers: LayerBreakdown[];
  /** Sum of all layer thicknesses, ignored ones included, m. */
  thickness: number;
  /** Resistance of the contributing layers, m2 K/W (kernel `DerivedAssembly.R`). */
  rLayers: number;
  /** Surface resistances actually used: with a ventilated layer `rse` is replaced by `rsi`. */
  rsi: number;
  rse: number;
  /** Total resistance rsi + rLayers + rse and U = 1 / rTotal. */
  rTotal: number;
  u: number;
  /** Does the construction contain a ventilated layer? */
  ventilated: boolean;
}

/**
 * Thermal resistance of one layer: `r` when given, else `t / lambda`. Throws RangeError for a layer that has neither a
 * positive lambda nor a resistance >= 0, or a non-positive thickness (model validation rejects these earlier).
 */
export function layerResistance(layer: Layer): number {
  if (!Number.isFinite(layer.t) || layer.t <= 0) throw new RangeError(`layerResistance: layer "${layer.id}" needs a positive thickness, got ${layer.t}`);
  if (layer.r !== undefined) {
    if (!Number.isFinite(layer.r) || layer.r < 0) throw new RangeError(`layerResistance: layer "${layer.id}" has an invalid resistance ${layer.r}`);
    return layer.r;
  }
  if (layer.lambda === undefined || !Number.isFinite(layer.lambda) || layer.lambda <= 0) {
    throw new RangeError(`layerResistance: layer "${layer.id}" needs a positive conductivity or a fixed resistance`);
  }
  return layer.t / layer.lambda;
}

/** Layer by layer breakdown and the U-value (EN ISO 6946, no thermal-bridge correction). */
export function assemblyBreakdown(assembly: Assembly): AssemblyBreakdown {
  // EN ISO 6946, 6.9: the ventilated layer and everything outside it do not contribute, and the outer surface resistance
  // becomes the inner one (the air in the gap moves freely).
  const vent = assembly.layers.findIndex((l) => l.ventilated === true);
  const raw = assembly.layers.map((l) => layerResistance(l));
  const rLayers = raw.reduce((s, r, i) => s + (i <= vent ? 0 : r), 0);
  const rsi = assembly.rsi;
  const rse = vent >= 0 ? assembly.rsi : assembly.rse;
  const rTotal = rsi + rLayers + rse;
  const layers: LayerBreakdown[] = assembly.layers.map((l, i) => {
    const ignored = i <= vent;
    const resistance = ignored ? 0 : raw[i];
    return {
      id: l.id,
      role: l.role ?? null,
      thickness: l.t,
      lambda: l.lambda ?? null,
      resistance,
      ventilated: l.ventilated === true,
      ignored,
      share: rLayers > 0 ? resistance / rLayers : 0,
    };
  });
  return {
    layers,
    thickness: assembly.layers.reduce((s, l) => s + l.t, 0),
    rLayers,
    rsi,
    rse,
    rTotal,
    u: rTotal > 0 ? 1 / rTotal : 0,
    ventilated: vent >= 0,
  };
}

/** U-value, W/(m2 K). Equals `assemblyU(assembly).U` of the kernel to 1e-4. */
export function uValue(assembly: Assembly): number {
  return assemblyBreakdown(assembly).u;
}

/** Copy of the assembly with one layer set to a new thickness (what-if). Unknown layer id: throws RangeError. */
export function withLayerThickness(assembly: Assembly, layerId: string, thickness: number): Assembly {
  if (!assembly.layers.some((l) => l.id === layerId)) throw new RangeError(`withLayerThickness: unknown layer "${layerId}"`);
  if (!Number.isFinite(thickness) || thickness <= 0) throw new RangeError(`withLayerThickness: thickness must be positive, got ${thickness}`);
  return { ...assembly, layers: assembly.layers.map((l) => (l.id === layerId ? { ...l, t: thickness } : l)) };
}

/**
 * Thickness (m) that the given layer needs for the assembly to reach `targetU`, or null when it is impossible (target below
 * the U of an infinitely thick layer, i.e. the other layers already give a smaller resistance than required, or the
 * layer is outside a ventilated layer and so has no effect). Inverse of `withLayerThickness` + `uValue`.
 */
export function thicknessForU(assembly: Assembly, layerId: string, targetU: number): number | null {
  const index = assembly.layers.findIndex((l) => l.id === layerId);
  if (index < 0) throw new RangeError(`thicknessForU: unknown layer "${layerId}"`);
  if (!Number.isFinite(targetU) || targetU <= 0) return null;
  const layer = assembly.layers[index];
  const b = assemblyBreakdown(assembly);
  // no effect: outside a ventilated layer, or a layer of fixed resistance (its thickness does not change R)
  if (b.layers[index].ignored || layer.lambda === undefined) return null;
  const rOthers = b.rTotal - b.layers[index].resistance;
  const rNeeded = 1 / targetU - rOthers;
  return rNeeded > 0 ? rNeeded * layer.lambda : null;
}

// ------------------------------------------------------------------------------------------------ floor on the ground

export interface FloorOnGroundInput {
  /** Floor area of the heated part, m2, and the length of its perimeter that borders the outside, m. */
  area: number;
  exposedPerimeter: number;
  /** Total thickness of the exterior walls, m (`w` of EN ISO 13370). */
  wallThickness: number;
  /** Thermal resistance of the floor construction without surface films, m2 K/W (`DerivedAssembly.R` of `groundFloor`). */
  floorResistance: number;
  /** Surface resistances of the floor, m2 K/W (from the assembly). */
  rsi: number;
  rse: number;
  /** Conductivity of the soil, W/(m K). Source: model/assumptions.json `ground.soilLambda`. */
  soilLambda: number;
  /** Periodic penetration depth, m. Source: model/assumptions.json `ground.periodicDepthM`. */
  periodicDepthM: number;
}

export interface FloorOnGround {
  /** Characteristic dimension B' = A / (0.5 P), m. */
  bPrime: number;
  /** Equivalent thickness d_t = w + lambda (Rsi + R_f + Rse), m. */
  dt: number;
  /** Steady-state U-value of the floor on the ground (no edge insulation), W/(m2 K). */
  u: number;
  /** Steady-state conductance A * U, W/K. */
  hSteady: number;
  /** External periodic conductance H_pe = 0.37 P lambda ln(delta / d_t + 1), W/K (seasonal swing of the heat flow). */
  hPeriodic: number;
}

/**
 * Slab-on-ground floor of EN ISO 13370: `U = 2 lambda / (pi B' + d_t) * ln(pi B' / d_t + 1)` if `d_t < B'` (uninsulated or
 * moderately insulated), else `U = lambda / (0.457 B' + d_t)`. A non-positive area or perimeter returns zeros (never NaN).
 */
export function floorOnGround(input: FloorOnGroundInput): FloorOnGround {
  const { area, exposedPerimeter: perimeter, wallThickness, floorResistance, rsi, rse, soilLambda: lambda, periodicDepthM: delta } = input;
  if (!(area > 0) || !(perimeter > 0)) return { bPrime: 0, dt: 0, u: 0, hSteady: 0, hPeriodic: 0 };
  const bPrime = area / (0.5 * perimeter);
  const dt = wallThickness + lambda * (rsi + floorResistance + rse);
  if (!(dt > 0)) throw new RangeError("floorOnGround: equivalent thickness must be positive (check wall thickness and soil conductivity)");
  const u = dt < bPrime
    ? ((2 * lambda) / (Math.PI * bPrime + dt)) * Math.log((Math.PI * bPrime) / dt + 1)
    : lambda / (SLAB_FACTOR * bPrime + dt);
  return { bPrime, dt, u, hSteady: area * u, hPeriodic: PERIODIC_FACTOR * perimeter * lambda * Math.log(delta / dt + 1) };
}
