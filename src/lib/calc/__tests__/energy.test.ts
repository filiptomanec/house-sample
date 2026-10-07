// Tests of energy.ts. No golden numbers of the house: invariants of the model, a one-room house computed by hand from the raw
// numbers, independent re-derivations (U-values from layers, ground floor formula, utilisation factor closed forms) and
// monotonicity of the whole calculation.
import { describe, expect, it } from "vitest";
import { DAYS_IN_MONTH } from "@/lib/calendar";
import { derived as projectDerived, house as projectHouse } from "@/lib/model/instance";
import type { Assembly } from "@/lib/model/types";
import {
  checkClimate,
  closedShare,
  computeDesignLoad,
  computeEnergy,
  computeEnvelope,
  computeVentilation,
  defaultEnergyContext,
  defaultInputs,
  energyInputSpecs,
  NUMERIC_INPUT_KEYS,
  planeYield,
  sanitizeInputs,
  simulateDay,
  utilisationFactor,
  type EnergyInputs,
  type EnergyResult,
} from "../energy";
import { BOX, boxHouse, climate, clone, contextOf, rng } from "./energyFixtures";

const ctx = defaultEnergyContext();
const base = defaultInputs(ctx);
const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0);
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-12, Math.max(Math.abs(a), Math.abs(b)));

/** Paths of every number in a value that is NaN or infinite (JSON.stringify would hide NaN as null). */
function nonFinite(value: unknown, path = "result"): string[] {
  if (typeof value === "number") return Number.isFinite(value) ? [] : [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonFinite(v, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([k, v]) => nonFinite(v, `${path}.${k}`));
  return [];
}

/** U-value of an assembly computed here from the raw layers (first ventilated layer and everything outside it ignored). */
function uFromLayers(a: Assembly): number {
  const vent = a.layers.findIndex((l) => l.ventilated);
  const active = vent >= 0 ? a.layers.slice(vent + 1) : a.layers;
  const r = active.reduce((s, l) => s + (l.r ?? l.t / (l.lambda as number)), 0);
  return 1 / (a.rsi + r + (vent >= 0 ? a.rsi : a.rse));
}

// ---------------------------------------------------------------------------------------------------------- utilisation factor
describe("utilisationFactor (EN ISO 13790)", () => {
  it("is the closed form (1 - g^a) / (1 - g^(a+1))", () => {
    for (const a of [1, 1.8, 2.5, 4]) for (const g of [0.05, 0.3, 0.7, 0.95, 1.05, 1.5, 3, 12]) {
      expect(utilisationFactor(g, a)).toBeCloseTo((1 - g ** a) / (1 - g ** (a + 1)), 9);
    }
  });
  it("has the limits: 1 without gains, a/(a+1) at gamma 1, 0 without losses", () => {
    expect(utilisationFactor(1e-12, 2)).toBeCloseTo(1, 9);
    expect(utilisationFactor(0, 2)).toBe(1);
    expect(utilisationFactor(1, 3)).toBeCloseTo(0.75, 12);
    expect(utilisationFactor(1 + 1e-12, 3)).toBeCloseTo(0.75, 9);
    expect(utilisationFactor(Infinity, 2)).toBe(0);
    expect(utilisationFactor(Number.NaN, 2)).toBe(0);
  });
  it("stays within [0, 1], never NaN, and does not increase with gamma", () => {
    let last = 1;
    for (let g = 0; g <= 400; g += 0.01) {
      const v = utilisationFactor(g, 2.2);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      last = v;
    }
    expect(utilisationFactor(1e6, 50)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- the hand-computed house
describe("a one-room house, computed by hand", () => {
  const house = boxHouse();
  const c = contextOf(house);
  const a = c.assumptions;
  const t = house.wall.ext;
  const h = house.clearHeight + house.slab; // wall height: the roof's wall top
  const inputs: EnergyInputs = { ...defaultInputs(c), persons: 3, indoorTempC: 20, n50: 1.5, heatRecovery: true, appliancesKwhYear: 2500, evKmYear: 0, pv: { ...defaultInputs(c).pv, panelCount: 0 } };
  const r = computeEnergy(inputs, c);

  // geometry from the raw numbers: axis rectangle 8 x 6, walls of thickness t, roof over the outer faces
  const wallArea = 2 * (BOX.w + BOX.d) * h;
  const outerA = (BOX.w + t) * (BOX.d + t);
  const outerP = 2 * (BOX.w + t + BOX.d + t);
  const pitch = house.roofs[0].pitch;
  const roofArea = outerA / Math.cos((pitch * Math.PI) / 180);
  const uWall = uFromLayers(house.assemblies.exteriorWall);
  const uRoof = uFromLayers(house.assemblies.roof);

  it("has the walls, the roof, the floor and the bridge allowance, and nothing else", () => {
    expect(r.envelope.rows.map((x) => x.kind)).toEqual(["wall", "wall", "wall", "wall", "roof", "floor", "bridge"]);
    expect(sum(r.envelope.rows.filter((x) => x.kind === "wall").map((x) => x.area))).toBeCloseTo(wallArea, 9);
    const roof = r.envelope.rows.find((x) => x.kind === "roof");
    expect(roof?.area).toBeCloseTo(roofArea, 6);
    expect(roof?.u).toBeCloseTo(uRoof, 9);
    for (const w of r.envelope.rows.filter((x) => x.kind === "wall")) expect(w.u).toBeCloseTo(uWall, 9);
  });

  it("computes the floor on the ground with EN ISO 13370 from the raw numbers", () => {
    const g = house.assemblies.groundFloor;
    const rf = g.layers.reduce((s, l) => s + (l.r ?? l.t / (l.lambda as number)), 0);
    const bPrime = outerA / (0.5 * outerP);
    const dt = t + a.ground.soilLambda * (g.rsi + rf + g.rse);
    const u = dt < bPrime
      ? ((2 * a.ground.soilLambda) / (Math.PI * bPrime + dt)) * Math.log((Math.PI * bPrime) / dt + 1)
      : a.ground.soilLambda / (0.457 * bPrime + dt);
    const floor = r.envelope.rows.find((x) => x.kind === "floor");
    expect(floor?.area).toBeCloseTo(outerA, 9);
    expect(floor?.u).toBeCloseTo(u, 9);
  });

  it("adds the thermal bridges on the area that borders the outside air", () => {
    const bridge = r.envelope.rows.find((x) => x.kind === "bridge");
    expect(bridge?.area).toBeCloseTo(wallArea + roofArea, 6);
    expect(bridge?.h).toBeCloseTo((wallArea + roofArea) * a.thermal.thermalBridgeDeltaU, 6);
  });

  it("sums the transmission coefficient from the rows", () => {
    const floor = r.envelope.rows.find((x) => x.kind === "floor");
    const expected = wallArea * uWall + roofArea * uRoof + (floor?.h ?? 0) + (wallArea + roofArea) * a.thermal.thermalBridgeDeltaU;
    expect(r.envelope.hTransmission).toBeCloseTo(expected, 6);
    for (const row of r.envelope.rows) expect(row.h).toBeCloseTo(row.area * row.u * row.b, 12);
  });

  it("computes the ventilation coefficient from the volume, n50, the people and the recovery", () => {
    const volume = (BOX.w - t) * (BOX.d - t) * house.clearHeight;
    expect(r.envelope.heatedVolume).toBeCloseTo(volume, 6);
    const airflow = Math.max(a.ventilation.airflowPerPersonM3h * 3, a.ventilation.minAirChangeRate * volume);
    const hV = a.thermal.airHeatCapacityWhPerM3K * volume * (a.ventilation.shielding * 1.5 + (airflow / volume) * (1 - house.equipment.ventilation.heatRecoveryEfficiency));
    expect(r.ventilation.airflowM3h).toBeCloseTo(airflow, 9);
    expect(r.ventilation.hV).toBeCloseTo(hV, 9);
    expect(r.ventilation.fanW).toBeCloseTo(house.equipment.ventilation.specificFanPower * airflow, 9);
    // without heat recovery the whole flow is lost and the fans stand still
    const open = computeVentilation({ ...inputs, heatRecovery: false }, c);
    expect(open.hV).toBeCloseTo(a.thermal.airHeatCapacityWhPerM3K * volume * (a.ventilation.shielding * 1.5 + airflow / volume), 9);
    expect(open.fanW).toBe(0);
  });

  it("computes the monthly heat demand with the utilisation factor from the raw numbers", () => {
    const floorRow = r.envelope.rows.find((x) => x.kind === "floor");
    const hFloor = floorRow?.h ?? 0;
    const hAir = r.envelope.hTransmission - hFloor + r.ventilation.hV;
    const monthMean = climate.tempUTC.map((row) => sum(row) / 24);
    const yearMean = sum(monthMean.map((x, m) => x * DAYS_IN_MONTH[m])) / 365;
    const g = house.assemblies.groundFloor;
    const rf = g.layers.reduce((s, l) => s + (l.r ?? l.t / (l.lambda as number)), 0);
    const dt = t + a.ground.soilLambda * (g.rsi + rf + g.rse);
    const hPe = 0.37 * outerP * a.ground.soilLambda * Math.log(a.ground.periodicDepthM / dt + 1);
    const phi = 3 * a.gains.personW + (a.gains.applianceHeatShare * 2500 * 1000) / 8760;
    const tau = (a.thermal.internalHeatCapacityKjPerM2K * 1000 * r.envelope.heatedFloorArea) / ((hAir + hFloor) * 3600);
    const aF = 1 + tau / a.thermal.utilisationReferenceTimeH;
    let total = 0;
    for (let m = 0; m < 12; m++) {
      const hours = DAYS_IN_MONTH[m] * 24;
      const qht = Math.max(0, ((hAir * (20 - monthMean[m]) + hFloor * (20 - yearMean) + hPe * (yearMean - monthMean[m])) * hours) / 1000);
      const gains = (phi * hours) / 1000; // no windows: no solar gains
      const eta = qht > 0 ? (1 - (gains / qht) ** aF) / (1 - (gains / qht) ** (aF + 1)) : 0;
      const need = qht > 0 ? Math.max(0, qht - eta * gains) : 0;
      total += need;
      expect(r.months[m].lossKwh).toBeCloseTo(qht, 6);
      expect(r.months[m].internalGainKwh).toBeCloseTo(gains, 6);
      expect(r.months[m].solarGainKwh).toBe(0);
      expect(r.months[m].heatNeedKwh).toBeCloseTo(need, 6);
    }
    expect(r.totals.heatNeedKwh).toBeCloseTo(total, 6);
  });

  it("computes the design load of EN 12831 from the same coefficients", () => {
    const floorRow = r.envelope.rows.find((x) => x.kind === "floor");
    const hFloor = floorRow?.h ?? 0;
    const monthMean = climate.tempUTC.map((row) => sum(row) / 24);
    const yearMean = sum(monthMean.map((x, m) => x * DAYS_IN_MONTH[m])) / 365;
    const dT = 20 - a.climate.designOutdoorC;
    const expected = (r.envelope.hTransmission - hFloor + r.ventilation.hV) * dT + hFloor * a.ground.fg1 * (20 - yearMean);
    const d = computeDesignLoad(inputs, c);
    expect(d.totalW).toBeCloseTo(expected, 6);
    expect(d.transmissionW + d.groundW + d.ventilationW).toBeCloseTo(d.totalW, 9);
    expect(d.specificWm2).toBeCloseTo(expected / r.envelope.heatedFloorArea, 9);
    expect(r.designLoad).toEqual(d);
  });

  it("has no production, no investment and no payback without panels", () => {
    expect(r.layout.count).toBe(0);
    expect(r.totals.pvKwh).toBe(0);
    expect(r.totals.pvSpecificYield).toBeNull();
    expect(r.economics.investmentGross).toBe(0);
    expect(r.economics.paybackYears).toBeNull();
    expect(r.economics.status).toBe("none");
    expect(r.economics.savings).toBeCloseTo(0, 9);
    expect(r.totals.importKwh).toBeCloseTo(r.totals.elTotalKwh, 6);
  });
});

describe("solar gains of a window, from the raw numbers", () => {
  // a south window on a house without roof overhang and without blinds: no shading at all
  const house = boxHouse((raw) => {
    raw.openings = [{ id: "W1", kind: "window", orient: "h", cx: 4, cy: 0, w: 2, sill: 0.9, head: 2.1 }];
    raw.shading.blinds.kinds = ["slider"];
  });
  const c = contextOf(house);
  const r = computeEnergy(defaultInputs(c), c);
  it("equals area x (1 - frame) x g x correction x (1 - beam share x overhang shading) x irradiation", () => {
    const glazing = 2 * (2.1 - 0.9);
    const dir = c.derived.openings[0].dir as "N" | "E" | "S" | "W";
    const w = house.windows;
    for (let m = 0; m < 12; m++) {
      const expected = glazing * (1 - w.frameShare) * w.g * c.assumptions.thermal.solarCorrection * climate.vertical[dir][m];
      // the eave is flush with the wall, so the overhang cannot shade the window: the factor is exactly 1
      expect(r.months[m].solarGainKwh).toBeCloseTo(expected, 6);
    }
  });
});

describe("closedShare (blind estimate)", () => {
  it("rises with the irradiation, falls with the threshold and stays in [0, 1]", () => {
    let last = -1;
    for (let kwh = 0; kwh <= 8; kwh += 0.25) {
      const v = closedShare(kwh, 8, 250);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
    let lower = 2;
    for (let thr = 0; thr <= 1200; thr += 50) {
      const v = closedShare(5, 8, thr);
      expect(v).toBeLessThanOrEqual(lower);
      lower = v;
    }
  });
  it("is 0 without sun, without irradiation, and at a threshold above the peak", () => {
    expect(closedShare(0, 8, 250)).toBe(0);
    expect(closedShare(5, 0, 250)).toBe(0);
    expect(closedShare(0.5, 8, 5000)).toBe(0);
    expect(closedShare(5, 8, 0)).toBeCloseTo(1, 12);
  });
});

// ---------------------------------------------------------------------------------------------------------- the project's house: invariants
describe("the energy balance of the project's house", () => {
  const r = computeEnergy(base, ctx);

  it("contains no NaN and no infinite number anywhere", () => {
    expect(nonFinite(r)).toEqual([]);
  });

  it("has the right shape: 12 months, 12 days of 24 hours", () => {
    expect(r.months).toHaveLength(12);
    expect(r.days).toHaveLength(12);
    for (const d of r.days) for (const k of ["load", "pv", "direct", "toBattery", "fromBattery", "toGrid", "fromGrid", "soc"] as const) expect(d[k]).toHaveLength(24);
  });

  it("sums the months into the totals", () => {
    const col = (f: (m: EnergyResult["months"][number]) => number) => sum(r.months.map(f));
    expect(r.totals.heatNeedKwh).toBeCloseTo(col((m) => m.heatNeedKwh), 9);
    expect(r.totals.elTotalKwh).toBeCloseTo(col((m) => m.elTotalKwh), 9);
    expect(r.totals.pvKwh).toBeCloseTo(col((m) => m.pvKwh), 9);
    expect(r.totals.importKwh).toBeCloseTo(col((m) => m.importKwh), 9);
    expect(r.totals.exportKwh).toBeCloseTo(col((m) => m.exportKwh), 9);
    expect(r.totals.elTotalKwh).toBeCloseTo(r.totals.elHeatKwh + r.totals.elDhwKwh + r.totals.elApplianceKwh + r.totals.elEvKwh + r.totals.elVentKwh, 9);
  });

  it("balances energy: import = consumption - self-use; production = self-use + export + battery losses", () => {
    for (const m of r.months) {
      expect(m.importKwh).toBeCloseTo(m.elTotalKwh - m.selfUseKwh, 6);
      expect(m.pvKwh).toBeCloseTo(m.selfUseKwh + m.exportKwh + (m.batteryInKwh - m.batteryOutKwh), 6);
    }
    expect(rel(r.totals.importKwh, r.totals.elTotalKwh - r.totals.selfUseKwh)).toBeLessThan(1e-9);
    // the battery returns the round-trip efficiency of what it takes in (steady state)
    expect(rel(sum(r.months.map((m) => m.batteryOutKwh)), ctx.assumptions.battery.roundTripEfficiency * sum(r.months.map((m) => m.batteryInKwh)))).toBeLessThan(1e-6);
  });

  it("balances every hour of every day type", () => {
    for (const d of r.days) {
      for (const t of d.types) {
        for (let h = 0; h < 24; h++) {
          expect(t.pv[h]).toBeCloseTo(t.direct[h] + t.toBattery[h] + t.toGrid[h], 9);
          expect(t.load[h]).toBeCloseTo(t.direct[h] + t.fromBattery[h] + t.fromGrid[h], 9);
        }
      }
      for (let h = 0; h < 24; h++) expect(d.load[h]).toBeCloseTo(d.parts.heat[h] + d.parts.dhw[h] + d.parts.appliances[h] + d.parts.ev[h] + d.parts.ventilation[h], 9);
    }
  });

  it("keeps the battery within its capacity and power", () => {
    const opt = ctx.house.equipment.battery.options.find((o) => o.id === base.pv.batteryId) as { capacityKwh: number; powerKw: number };
    const usable = opt.capacityKwh * ctx.assumptions.battery.usableShare;
    for (const d of r.days) for (const t of d.types) for (let h = 0; h < 24; h++) {
      expect(t.soc[h]).toBeGreaterThanOrEqual(-1e-9);
      expect(t.soc[h]).toBeLessThanOrEqual(usable + 1e-9);
      expect(t.toBattery[h]).toBeLessThanOrEqual(opt.powerKw + 1e-9);
      expect(t.fromBattery[h]).toBeLessThanOrEqual(opt.powerKw + 1e-9);
    }
  });

  it("weights the day types so that the month total is the PVGIS value (before clipping)", () => {
    const c2 = contextOf(projectHouse, { assumptions: { ...ctx.assumptions, pv: { ...ctx.assumptions.pv, inverterClipping: false } } });
    const res = computeEnergy(defaultInputs(c2), c2);
    for (let m = 0; m < 12; m++) {
      const fromPlanes = sum(res.planes.map((p) => p.monthlyKwh[m]));
      expect(res.months[m].pvKwh).toBeCloseTo(fromPlanes, 6);
    }
    const weights = sum(r.days[0].types.map((t) => t.weight));
    expect(weights).toBeCloseTo(1, 12);
    expect(sum(r.days[0].types.map((t) => t.weight * t.pvFactor))).toBeCloseTo(1, 12);
  });

  it("clips the production at the inverter, never below the unclipped total by more than the clipped energy", () => {
    const unclipped = sum(r.planes.map((p) => p.yearlyKwh));
    expect(r.totals.pvKwh).toBeLessThanOrEqual(unclipped + 1e-6);
    for (const d of r.days) for (const t of d.types) for (let h = 0; h < 24; h++) expect(t.pv[h]).toBeLessThanOrEqual(ctx.house.equipment.pv.inverter.ratedKw + 1e-9);
  });

  it("delivers exactly the seasonal COP that was asked for", () => {
    expect(r.totals.heatPumpSeasonalCop).toBeCloseTo(base.scop, 9);
    const delivered = r.totals.heatNeedKwh * (1 + ctx.assumptions.heating.distributionLossShare);
    expect(delivered / r.totals.elHeatKwh).toBeCloseTo(base.scop, 9);
    expect(r.totals.dhwHeatKwh / r.totals.elDhwKwh).toBeCloseTo(base.scopDhw, 9);
    for (const m of r.months) if (m.copHeat !== null) expect(m.copHeat).toBeGreaterThan(1);
  });

  it("gives a colder month a lower COP", () => {
    const cops = r.months.filter((m) => m.copHeat !== null).map((m) => [m.outdoorC, m.copHeat as number]);
    const coldest = cops.reduce((a, b) => (b[0] < a[0] ? b : a));
    const warmest = cops.reduce((a, b) => (b[0] > a[0] ? b : a));
    expect(coldest[1]).toBeLessThan(warmest[1]);
  });

  it("rejects nothing in the shipped data: the climate file belongs to the model", () => {
    expect(checkClimate(ctx.house, ctx.derived, ctx.climate)).toEqual([]);
    expect(r.warnings.find((w) => w.key === "climateMismatch")).toBeUndefined();
  });

  it("splits PV and battery so that the parts add up", () => {
    const e = r.economics;
    expect(e.pvOnly.investment + e.battery.investment).toBeCloseTo(e.investment, 6);
    expect(e.pvOnly.savings + e.battery.savings).toBeCloseTo(e.savings, 6);
    expect(e.savings).toBeCloseTo(e.costWithoutPv - e.costWithPv, 6);
  });

  it("is deterministic, and does not change the context or the inputs", () => {
    const before = JSON.stringify([ctx.house, ctx.assumptions, ctx.climate]);
    const input = clone(base);
    const a = computeEnergy(input, ctx);
    const b = computeEnergy(input, ctx);
    expect(b).toEqual(a);
    expect(input).toEqual(base);
    expect(JSON.stringify([ctx.house, ctx.assumptions, ctx.climate])).toBe(before);
  });

  it("returns fresh objects that callers may change", () => {
    const a = computeEnergy(base, ctx);
    a.months[0].heatNeedKwh = -1;
    a.envelope.rows[0].area = -1;
    const b = computeEnergy(base, ctx);
    expect(b.months[0].heatNeedKwh).toBeGreaterThanOrEqual(0);
    expect(computeEnvelope(ctx).rows[0].area).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- monotonicity
describe("monotonicity", () => {
  const at = (extra: Partial<EnergyInputs>): EnergyResult => computeEnergy({ ...base, ...extra }, ctx);
  const capacity = computeEnergy(base, ctx).layout.capacity;

  it("more panels never lower the production or the self-use", () => {
    let pv = -1, self = -1;
    for (let n = 0; n <= capacity; n += 3) {
      const r = at({ pv: { ...base.pv, panelCount: n } });
      expect(r.totals.pvKwh).toBeGreaterThanOrEqual(pv - 1e-9);
      expect(r.totals.selfUseKwh).toBeGreaterThanOrEqual(self - 1e-9);
      pv = r.totals.pvKwh;
      self = r.totals.selfUseKwh;
    }
  });

  it("a bigger battery never lowers the self-use and never raises the import", () => {
    const options = ctx.house.equipment.battery.options.slice().sort((a, b) => a.capacityKwh - b.capacityKwh);
    let self = -1, imp = Infinity;
    for (const o of options) {
      const r = at({ pv: { ...base.pv, batteryId: o.id } });
      expect(r.totals.selfUseKwh).toBeGreaterThanOrEqual(self - 1e-9);
      expect(r.totals.importKwh).toBeLessThanOrEqual(imp + 1e-9);
      self = r.totals.selfUseKwh;
      imp = r.totals.importKwh;
    }
  });

  it("a lower set-point, a tighter house and better recovery never raise the heat demand", () => {
    const sp = energyInputSpecs(ctx);
    let last = Infinity;
    for (let t = sp.indoorTempC.max; t >= sp.indoorTempC.min; t -= 1) {
      const need = at({ indoorTempC: t }).totals.heatNeedKwh;
      expect(need).toBeLessThanOrEqual(last + 1e-9);
      last = need;
    }
    last = Infinity;
    for (let n = sp.n50.max; n >= sp.n50.min; n -= 0.5) {
      const need = at({ n50: n }).totals.heatNeedKwh;
      expect(need).toBeLessThanOrEqual(last + 1e-9);
      last = need;
    }
    expect(at({ heatRecovery: true }).totals.heatNeedKwh).toBeLessThan(at({ heatRecovery: false }).totals.heatNeedKwh);
  });

  it("better insulation (a lower U) never raises the heat demand", () => {
    let last = Infinity;
    for (const t of [0.05, 0.1, 0.15, 0.25, 0.4]) {
      const house = boxHouse((raw) => {
        const eps = raw.assemblies.exteriorWall.layers.find((l: { role?: string }) => l.role === "insulation");
        eps.t = t;
      });
      const c = contextOf(house);
      const need = computeEnergy(defaultInputs(c), c).totals.heatNeedKwh;
      expect(need).toBeLessThanOrEqual(last + 1e-9);
      last = need;
    }
  });

  it("more people never lower the electricity, a dearer tariff never lowers the cost", () => {
    expect(at({ persons: 6 }).totals.elTotalKwh).toBeGreaterThan(at({ persons: 2 }).totals.elTotalKwh);
    expect(at({ priceBuy: 8 }).economics.costWithPv).toBeGreaterThan(at({ priceBuy: 4 }).economics.costWithPv);
  });

  it("a household with an electric car uses more electricity, the heat demand is the same", () => {
    const withCar = at({ evKmYear: 15000 });
    expect(withCar.totals.elEvKwh).toBeGreaterThan(0);
    expect(withCar.totals.heatNeedKwh).toBeCloseTo(at({ evKmYear: 0 }).totals.heatNeedKwh, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------- economics
describe("economics", () => {
  it("clips subsidy and prices to be non-negative and the subsidy to the investment", () => {
    const r = computeEnergy({ ...base, pv: { ...base.pv, panelCount: 1 }, subsidy: energyInputSpecs(ctx).subsidy.max }, ctx);
    expect(r.economics.investment).toBe(0);
    expect(r.economics.status).toBe("none");
    expect(r.economics.investmentGross).toBeGreaterThan(0);
    // negative prices are clamped to the lowest price of the range, which is never negative
    const sp = energyInputSpecs(ctx);
    const cheap = computeEnergy({ ...base, pvPricePerKwp: -5, batteryPricePerKwh: -5 }, ctx);
    const battery = ctx.house.equipment.battery.options.find((o) => o.id === base.pv.batteryId)?.capacityKwh ?? 0;
    expect(cheap.economics.investmentGross).toBeCloseTo(cheap.layout.kwp * sp.pvPricePerKwp.min + battery * sp.batteryPricePerKwh.min, 6);
  });

  it("computes the payback as investment / savings, and reports 'never' above the cap or without savings", () => {
    const r = computeEnergy(base, ctx);
    expect(r.economics.status).toBe("ok");
    expect(r.economics.paybackYears).toBeCloseTo(r.economics.investment / r.economics.savings, 9);
    const dear = computeEnergy({ ...base, pvPricePerKwp: 1e6, batteryPricePerKwh: 1e6 }, ctx);
    expect(dear.economics.status).toBe("never");
    expect(dear.economics.paybackYears).toBeNull();
    const noSale = computeEnergy({ ...base, priceBuy: 0, priceSell: 0 }, ctx);
    expect(noSale.economics.status).toBe("never");
  });

  it("charges for the battery only when there are panels", () => {
    const r = computeEnergy({ ...base, pv: { ...base.pv, panelCount: 0 } }, ctx);
    expect(r.economics.investmentGross).toBe(0);
    expect(r.warnings.map((w) => w.key)).toContain("batteryWithoutPv");
  });
});

// ---------------------------------------------------------------------------------------------------------- PV per plane
describe("planeYield", () => {
  const plane = ctx.planes.find((p) => p.side === "S") as (typeof ctx.planes)[number];

  it("returns the climate data unchanged for a plane that matches its facing", () => {
    const y = planeYield(plane, ctx);
    expect(y.exact).toBe(true);
    expect(y.factor).toBe(1);
    expect(y.monthly).toEqual(ctx.climate.monthly[y.basis]);
    expect(y.profileUTC).toEqual(ctx.climate.profileUTC[y.basis]);
  });

  // a climate with symmetric east and west and no house rotation: equal angles from south must give equal yields
  const sym = clone(climate);
  sym.houseAxisBearingDeg = 0;
  sym.facings = { N: { ...sym.facings.N, azimuthDeg: 0 }, E: { ...sym.facings.E, azimuthDeg: 90 }, S: { ...sym.facings.S, azimuthDeg: 180 }, W: { ...sym.facings.W, azimuthDeg: 270 } };
  sym.monthly.W = sym.monthly.E.slice();
  sym.profileUTC.W = sym.profileUTC.E.map((row) => row.slice());
  const cs = contextOf(projectHouse, { climate: sym });
  const turned = (azimuth: number, pitch = sym.slope) => planeYield({ ...plane, key: `x${azimuth}`, azimuthTrue: azimuth, pitch }, cs);

  it("is symmetric about south", () => {
    for (const d of [5, 15, 30, 45, 60, 75, 85]) {
      const e = turned(180 - d), w = turned(180 + d);
      for (let m = 0; m < 12; m++) expect(e.monthly[m]).toBeCloseTo(w.monthly[m], 9);
    }
  });

  it("falls monotonically as the plane turns away from south", () => {
    let last = Infinity;
    for (let az = 180; az >= 0; az -= 5) {
      const y = turned(az).yearly;
      expect(y).toBeLessThanOrEqual(last + 1e-9);
      last = y;
    }
    last = Infinity;
    for (let az = 180; az <= 360; az += 5) {
      const y = turned(az).yearly;
      expect(y).toBeLessThanOrEqual(last + 1e-9);
      last = y;
    }
  });

  it("passes through the facings' own data at their azimuths and blends linearly between them", () => {
    expect(turned(90).yearly).toBeCloseTo(sum(sym.monthly.E), 6);
    const mid = turned(135);
    for (let m = 0; m < 12; m++) expect(mid.monthly[m]).toBeCloseTo((sym.monthly.E[m] + sym.monthly.S[m]) / 2, 9);
    expect(mid.exact).toBe(false);
    expect(mid.factor).toBeGreaterThan(0);
  });

  it("changes with the pitch, in the direction of the clear-sky geometry", () => {
    const steep = turned(180, 60), flat = turned(180, 10), data = turned(180);
    // a south plane at the roof pitch is the data; steeper favours winter, flatter favours summer
    expect(data.exact).toBe(true);
    expect(steep.monthly[11]).toBeGreaterThan(data.monthly[11]);
    expect(flat.monthly[5]).toBeGreaterThan(steep.monthly[5]);
  });

  it("wraps around north without a jump", () => {
    const a = turned(359).yearly, b = turned(1).yearly, c = turned(0).yearly;
    expect(Math.abs(a - c)).toBeLessThan(0.02 * c + 1);
    expect(Math.abs(b - c)).toBeLessThan(0.02 * c + 1);
  });
});

// ---------------------------------------------------------------------------------------------------------- hourly dispatch
describe("simulateDay", () => {
  const sunny = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * 4);
  const evening = Array.from({ length: 24 }, (_, h) => (h >= 17 && h <= 22 ? 1.5 : 0.3));
  const bat = (usableKwh: number, powerKw = 3, roundTripEfficiency = 0.9) => ({ usableKwh, powerKw, roundTripEfficiency });

  it("serves the load from PV first and exports the rest without a battery", () => {
    const f = simulateDay(sunny, evening, bat(0, 0));
    for (let h = 0; h < 24; h++) {
      expect(f.direct[h]).toBeCloseTo(Math.min(sunny[h], evening[h]), 12);
      expect(f.toGrid[h]).toBeCloseTo(Math.max(0, sunny[h] - evening[h]), 12);
      expect(f.fromGrid[h]).toBeCloseTo(Math.max(0, evening[h] - sunny[h]), 12);
      expect(f.soc[h]).toBe(0);
    }
  });

  it("balances every hour and respects capacity and power (seeded random days)", () => {
    const next = rng(7);
    for (let k = 0; k < 200; k++) {
      const pv = Array.from({ length: 24 }, () => (next() < 0.5 ? 0 : next() * 6));
      const load = Array.from({ length: 24 }, () => next() * 3);
      const b = bat(next() * 15, next() * 6, 0.7 + next() * 0.3);
      const f = simulateDay(pv, load, b);
      for (let h = 0; h < 24; h++) {
        expect(f.pv[h]).toBeCloseTo(f.direct[h] + f.toBattery[h] + f.toGrid[h], 9);
        expect(f.load[h]).toBeCloseTo(f.direct[h] + f.fromBattery[h] + f.fromGrid[h], 9);
        expect(f.soc[h]).toBeGreaterThanOrEqual(-1e-9);
        expect(f.soc[h]).toBeLessThanOrEqual(b.usableKwh + 1e-9);
        expect(f.toBattery[h]).toBeLessThanOrEqual(b.powerKw + 1e-9);
        expect(f.fromBattery[h]).toBeLessThanOrEqual(b.powerKw + 1e-9);
        for (const key of ["direct", "toBattery", "fromBattery", "toGrid", "fromGrid"] as const) expect(f[key][h]).toBeGreaterThanOrEqual(-1e-12);
      }
      // steady state: what the battery gives back is the round-trip efficiency of what it took in
      expect(sum(f.fromBattery)).toBeCloseTo(b.roundTripEfficiency * sum(f.toBattery), 6);
    }
  });

  it("a bigger battery never lowers the self-use", () => {
    let last = -1;
    for (const kwh of [0, 2, 4, 8, 16, 32]) {
      const f = simulateDay(sunny, evening, bat(kwh, 5));
      const self = sum(f.direct) + sum(f.fromBattery);
      expect(self).toBeGreaterThanOrEqual(last - 1e-9);
      last = self;
    }
  });

  it("clips the PV at the inverter before the dispatch", () => {
    const f = simulateDay(sunny, evening, bat(0, 0), 2);
    expect(Math.max(...f.pv)).toBeCloseTo(2, 12);
    expect(sum(f.pv)).toBeLessThan(sum(sunny));
  });

  it("is safe for bad numbers and refuses mismatched lengths", () => {
    const f = simulateDay([Number.NaN, -3, 2], [1, Number.NaN, -1], bat(5));
    for (const key of ["pv", "load", "direct", "toBattery", "fromBattery", "toGrid", "fromGrid", "soc"] as const) for (const v of f[key]) expect(Number.isFinite(v)).toBe(true);
    expect(() => simulateDay([1, 2], [1], bat(1))).toThrow(RangeError);
    const dead = simulateDay(sunny, evening, bat(5, 3, 0));
    expect(sum(dead.toBattery)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- inputs
describe("inputs", () => {
  it("has a range and a default inside it for every numeric input, from the data", () => {
    const sp = energyInputSpecs(ctx);
    for (const k of NUMERIC_INPUT_KEYS) {
      expect(sp[k].min).toBeLessThan(sp[k].max);
      expect(sp[k].default).toBeGreaterThanOrEqual(sp[k].min);
      expect(sp[k].default).toBeLessThanOrEqual(sp[k].max);
    }
    expect(sp.scop.default).toBe(ctx.house.equipment.heating.scop);
    expect(sp.scopDhw.default).toBe(ctx.house.equipment.heating.scopDhw);
    expect(defaultInputs(ctx).heatRecovery).toBe(ctx.house.equipment.ventilation.type === "mvhr");
    expect(sanitizeInputs(defaultInputs(ctx), ctx)).toEqual(defaultInputs(ctx));
  });

  it("sanitises garbage: complete, in range, finite, idempotent (seeded random inputs)", () => {
    const next = rng(99);
    const sp = energyInputSpecs(ctx);
    const junk = (): unknown => {
      const r = next();
      if (r < 0.15) return Number.NaN;
      if (r < 0.25) return Infinity;
      if (r < 0.3) return -Infinity;
      if (r < 0.4) return "12";
      if (r < 0.45) return null;
      if (r < 0.5) return {};
      if (r < 0.55) return [1, 2];
      if (r < 0.6) return undefined;
      return (next() - 0.5) * 1e7;
    };
    for (let i = 0; i < 300; i++) {
      const raw: Record<string, unknown> = {};
      for (const k of [...NUMERIC_INPUT_KEYS, "evChargeDaytime", "heatRecovery", "dhwDaytime", "pv"]) if (next() < 0.8) raw[k] = junk();
      if (next() < 0.5) raw.pv = { panelCount: junk(), enabledPlanes: next() < 0.5 ? [junk(), "S999"] : junk(), batteryId: junk() };
      const s = sanitizeInputs(raw, ctx);
      for (const k of NUMERIC_INPUT_KEYS) {
        expect(Number.isFinite(s[k]), k).toBe(true);
        expect(s[k], k).toBeGreaterThanOrEqual(sp[k].min);
        expect(s[k], k).toBeLessThanOrEqual(sp[k].max);
      }
      for (const k of ["evChargeDaytime", "heatRecovery", "dhwDaytime"] as const) expect(typeof s[k]).toBe("boolean");
      expect(Number.isInteger(s.pv.panelCount) && s.pv.panelCount >= 0).toBe(true);
      expect(sanitizeInputs(s, ctx)).toEqual(s);
      if (i % 3 === 0) {
        const result = computeEnergy(s, ctx);
        expect(nonFinite(result)).toEqual([]);
        expect(Number.isFinite(result.totals.elTotalKwh)).toBe(true);
        expect(Number.isFinite(result.economics.savings)).toBe(true);
      }
    }
  }, 30_000);

  it("accepts a subset of fields and takes the rest from the defaults", () => {
    const s = sanitizeInputs({ persons: 6, indoorTempC: 22 }, ctx);
    expect(s.persons).toBe(6);
    expect(s.indoorTempC).toBe(22);
    expect(s.n50).toBe(defaultInputs(ctx).n50);
    expect(sanitizeInputs(null, ctx)).toEqual(defaultInputs(ctx));
    expect(sanitizeInputs("nonsense", ctx)).toEqual(defaultInputs(ctx));
  });

  it("clamps to the ranges, rounds to the step, and reports it", () => {
    const sp = energyInputSpecs(ctx);
    const s = sanitizeInputs({ persons: 3.7, indoorTempC: 99, n50: -4, subsidy: -1 }, ctx);
    expect(s.persons).toBe(4);
    expect(s.indoorTempC).toBe(sp.indoorTempC.max);
    expect(s.n50).toBe(sp.n50.min);
    expect(s.subsidy).toBe(sp.subsidy.min);
    expect(computeEnergy({ ...base, indoorTempC: 99 }, ctx).warnings.map((w) => w.key)).toContain("inputsClamped");
    expect(computeEnergy(base, ctx).warnings.map((w) => w.key)).not.toContain("inputsClamped");
  });

  it("warns when the panels asked for do not fit, and when no roof plane is on", () => {
    const big = computeEnergy({ ...base, pv: { ...base.pv, panelCount: 10_000 } }, ctx);
    expect(big.warnings.map((w) => w.key)).toContain("panelsClamped");
    expect(big.layout.count).toBe(big.layout.capacity);
    const none = computeEnergy({ ...base, pv: { ...base.pv, enabledPlanes: [] } }, ctx);
    expect(none.warnings.map((w) => w.key)).toContain("noPlanesEnabled");
    expect(none.totals.pvKwh).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------- climate and context
describe("checkClimate", () => {
  it("flags a changed pitch, bearing and location", () => {
    const pitch = clone(climate);
    pitch.slope += 3;
    expect(checkClimate(projectHouse, projectDerived, pitch)).toEqual(["pitch"]);
    const bearing = clone(climate);
    bearing.houseAxisBearingDeg += 10;
    expect(checkClimate(projectHouse, projectDerived, bearing)).toEqual(["bearing"]);
    const place = clone(climate);
    place.meta.lat += 1;
    expect(checkClimate(projectHouse, projectDerived, place)).toEqual(["location"]);
    expect(checkClimate(projectHouse, projectDerived, climate)).toEqual([]);
  });

  it("puts climateMismatch into the result", () => {
    const wrong = clone(climate);
    wrong.slope += 3;
    const c = contextOf(projectHouse, { climate: wrong });
    expect(computeEnergy(defaultInputs(c), c).warnings.map((w) => w.key)).toContain("climateMismatch");
  });
});
