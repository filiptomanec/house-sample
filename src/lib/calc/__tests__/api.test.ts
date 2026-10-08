// The contract of the calc modules (docs/CALC-API.md): the exports other agents code against, the JSON data files with their
// schemas, and the pieces that are implemented in phase 1 (plane keys, quantity table). These tests stay valid when the
// stubs get their bodies; the behaviour of each module is tested in its own file.
import { describe, expect, it } from "vitest";
import assumptionsJson from "@model/assumptions.json";
import pricebookJson from "@model/pricebook.json";
import pvgisJson from "@/lib/data/pvgis.json";
import { DIRS, FLOORS, OPENING_KINDS, ROOM_TYPES } from "@/lib/model/catalog";
import { baseline } from "@/lib/model/__tests__/helpers";
import * as budget from "../budget";
import * as energyCore from "../energy";
import * as energySchema from "../energySchema";
import * as printModel from "../printModel";
import * as roofLayout from "../roofLayout";
import * as storageKeys from "../storageKeys";
import * as sun from "../sun";
import * as uvalue from "../uvalue";

/** The energy API: the calculation (energy.ts) and the validator of the assumptions file (energySchema.ts, kept out of the browser bundle). */
const energy = { ...energyCore, ...energySchema };

const surface: Record<string, { module: Record<string, unknown>; functions: string[]; values: string[] }> = {
  sun: {
    module: sun,
    functions: [
      "placeOf", "zonedParts", "localToUtc", "utcOffsetHours", "monthOffsetMix", "sunPosition", "sunTimes", "sunArc", "sunDay",
      "monthSummary", "keyDays", "sunDirection", "cosIncidence", "skyPoint", "sunHoursOnSurface", "overhangShadedFraction", "overhangDailyShading",
    ],
    values: ["SUNRISE_ALTITUDE", "TYPICAL_DAY"],
  },
  uvalue: {
    module: uvalue,
    functions: ["layerResistance", "assemblyBreakdown", "uValue", "withLayerThickness", "thicknessForU", "floorOnGround"],
    values: ["SURFACE_RESISTANCE"],
  },
  roofLayout: {
    module: roofLayout,
    functions: [
      "planeKey", "groupRoofPlanes", "lightpipeObstacles", "layoutPanels", "panelCapacity", "defaultPanelCount", "defaultPvSelection",
      "resolvePvSelection", "currentPvSelection", "planeFullLayout",
    ],
    values: [],
  },
  energy: {
    module: energy,
    functions: [
      "parseAssumptions", "createEnergyContext", "defaultEnergyContext", "checkClimate", "energyInputSpecs", "defaultInputs", "sanitizeInputs",
      "computeEnvelope", "computeVentilation", "computeDesignLoad", "planeYield", "simulateDay", "utilisationFactor", "computeEnergy",
    ],
    values: ["AssumptionsSchema", "InputRangeSchema", "DAY_TYPE_KEYS", "NUMERIC_INPUT_KEYS"],
  },
  budget: {
    module: budget,
    functions: [
      "deriveQuantities", "materialTakeoff", "parsePricebook", "defaultPricebook", "defaultBudgetSettings", "sanitizeBudgetSettings",
      "computeBudget", "toCsv",
    ],
    values: ["UNIT_KEYS", "QUANTITY_DEFS", "QUANTITY_KEYS", "QuantityRuleSchema", "PriceLineSchema", "PriceGroupSchema", "PricebookSchema"],
  },
  printModel: {
    module: printModel,
    functions: ["buildPrintMesh", "checkBedFit", "fittingScale", "printReport", "toBinaryStl", "buildStl"],
    values: ["PRINT_SCALES", "PRINT_SCALE_RANGE", "PRINT_DEFAULTS"],
  },
  storageKeys: {
    module: storageKeys,
    functions: ["storage", "readStored", "writeStored", "clearStored", "fingerprint", "derivedFingerprint", "finiteIn", "parseStoredPv", "readStoredPv"],
    values: ["STORAGE_KEYS", "STORAGE_VERSIONS"],
  },
};

describe("module surface", () => {
  for (const [name, { module, functions, values }] of Object.entries(surface)) {
    it(`${name} exports its documented functions and constants`, () => {
      for (const f of functions) expect(typeof module[f], `${name}.${f}`).toBe("function");
      for (const v of values) expect(module[v], `${name}.${v}`).toBeDefined();
    });
  }
});

describe("planeKey (implemented)", () => {
  const { derived } = baseline();
  const keyOfPlane = new Map<string, string>();
  for (const f of derived.roofPlanes) {
    const k = roofLayout.planeKey(f);
    if (keyOfPlane.has(f.plane)) expect(keyOfPlane.get(f.plane), `faces of plane ${f.plane}`).toBe(k);
    keyOfPlane.set(f.plane, k);
  }

  it("is the same for all faces of one plane and different for different planes", () => {
    expect(new Set(keyOfPlane.values()).size).toBe(keyOfPlane.size);
  });

  it("depends on the geometry only: side, true azimuth, pitch and the eave origin", () => {
    for (const f of derived.roofPlanes) {
      const k = roofLayout.planeKey(f);
      expect(k.startsWith(`${f.side}${Math.round(f.azimuthTrue)}.${Math.round(f.pitch)}@`)).toBe(true);
      expect(k).not.toContain(f.id);
      expect(k).not.toContain("-0");
      expect(k).not.toContain("NaN");
    }
  });

  it("does not change with the order of the faces", () => {
    const a = derived.roofPlanes.map(roofLayout.planeKey).sort();
    const b = [...derived.roofPlanes].reverse().map(roofLayout.planeKey).sort();
    expect(b).toEqual(a);
  });

  it("moves with the plane: a shifted eave origin gives another key", () => {
    const f = derived.roofPlanes[0];
    const shifted = { ...f, frame: { ...f.frame, origin: [f.frame.origin[0] + 1, f.frame.origin[1], f.frame.origin[2]] as typeof f.frame.origin } };
    expect(roofLayout.planeKey(shifted)).not.toBe(roofLayout.planeKey(f));
  });

  it("turns a negative zero into 0", () => {
    const f = derived.roofPlanes[0];
    const z = { ...f, frame: { ...f.frame, origin: [-0.01, -0.02, 0] as typeof f.frame.origin } };
    expect(roofLayout.planeKey(z).endsWith("@0,0")).toBe(true);
  });
});

describe("QUANTITY_DEFS", () => {
  const { QUANTITY_DEFS, QUANTITY_KEYS, UNIT_KEYS } = budget;

  it("uses known units and documents every quantity", () => {
    for (const k of QUANTITY_KEYS) {
      expect(UNIT_KEYS, k).toContain(QUANTITY_DEFS[k].unit);
      expect(QUANTITY_DEFS[k].doc.length, k).toBeGreaterThan(10);
    }
  });

  it("covers every floor finish and every opening kind of the catalogue", () => {
    for (const f of FLOORS) expect(QUANTITY_KEYS).toContain(`floorArea.${f}`);
    for (const o of OPENING_KINDS) {
      expect(QUANTITY_KEYS).toContain(`${o}.count`);
      expect(QUANTITY_KEYS).toContain(`${o}.area`);
      expect(QUANTITY_DEFS[`${o}.count` as budget.QuantityKey].unit).toBe("pcs");
      expect(QUANTITY_DEFS[`${o}.area` as budget.QuantityKey].unit).toBe("m2");
    }
  });

  it("has no duplicate keys and none that looks like an id of the model", () => {
    expect(new Set(QUANTITY_KEYS).size).toBe(QUANTITY_KEYS.length);
    for (const k of QUANTITY_KEYS) expect(k).not.toMatch(/^[A-Z]\d+$/);
  });
});

describe("model/assumptions.json", () => {
  const parse = (j: unknown) => energy.AssumptionsSchema.safeParse(j);
  const clone = () => JSON.parse(JSON.stringify(assumptionsJson)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("satisfies its schema", () => {
    const r = parse(assumptionsJson);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
    expect(energy.parseAssumptions(assumptionsJson).schema).toBe("assumptions/1");
  });

  it("has a range for every numeric input and defaults inside the ranges", () => {
    const a = energy.parseAssumptions(assumptionsJson);
    for (const k of energy.NUMERIC_INPUT_KEYS) {
      const r = a.inputs[k];
      expect(r.min, k).toBeLessThan(r.max);
      if (r.default !== undefined) {
        expect(r.default, k).toBeGreaterThanOrEqual(r.min);
        expect(r.default, k).toBeLessThanOrEqual(r.max);
      }
    }
    // the plant efficiencies take their default from the model
    expect(a.inputs.scop.default).toBeUndefined();
    expect(a.inputs.scopDhw.default).toBeUndefined();
  });

  it("has day types with weights summing to 1 and a weighted mean factor of 1", () => {
    const a = energy.parseAssumptions(assumptionsJson);
    expect(a.pv.dayTypes.map((d) => d.key).sort()).toEqual([...energy.DAY_TYPE_KEYS].sort());
    expect(a.pv.dayTypes.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1, 2);
    expect(a.pv.dayTypes.reduce((s, d) => s + d.weight * d.factor, 0)).toBeCloseTo(1, 1);
  });

  it("only names unheated room types that exist and heated hours that exist", () => {
    const a = energy.parseAssumptions(assumptionsJson);
    for (const t of Object.keys(a.thermal.unheatedB)) expect(ROOM_TYPES as readonly string[]).toContain(t);
    for (const h of [...a.dhw.daytimeHours, ...a.dhw.defaultHours, ...a.profiles.evDaytimeHours, ...a.profiles.evNightHours]) expect(h >= 0 && h <= 23).toBe(true);
  });

  it("rejects what the schema is meant to catch", () => {
    const bad: Record<string, (a: Record<string, any>) => void> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      "unknown top-level key": (a) => { a.extra = 1; },
      "wrong schema id": (a) => { a.schema = "assumptions/2"; },
      "default outside the range": (a) => { a.inputs.persons.default = 99; },
      "min above max": (a) => { a.inputs.persons.min = 20; },
      "missing numeric input": (a) => { delete a.inputs.n50; },
      "weights not summing to 1": (a) => { a.pv.dayTypes[0].weight = 0.9; },
      "mean factor not 1": (a) => { a.pv.dayTypes[0].factor = 3; },
      "duplicate day type": (a) => { a.pv.dayTypes[1].key = a.pv.dayTypes[0].key; },
      "profile of the wrong length": (a) => { a.profiles.appliances.pop(); },
      "hour out of range": (a) => { a.dhw.daytimeHours = [24]; },
      "unknown room type in unheatedB": (a) => { a.thermal.unheatedB = { attic: 0.5 }; },
      "b factor above 1": (a) => { a.thermal.unheatedB = { garage: 1.5 }; },
      "negative lambda": (a) => { a.ground.soilLambda = -1; },
    };
    for (const [name, mutate] of Object.entries(bad)) {
      const a = clone();
      mutate(a);
      expect(parse(a).success, name).toBe(false);
    }
  });
});

describe("model/pricebook.json", () => {
  const parse = (j: unknown) => budget.PricebookSchema.safeParse(j);
  const clone = () => JSON.parse(JSON.stringify(pricebookJson)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("satisfies its schema", () => {
    const r = parse(pricebookJson);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  });

  it("refers only to quantities that exist and uses the unit of the quantity", () => {
    const book = budget.parsePricebook(pricebookJson);
    for (const g of book.groups) {
      for (const l of g.lines) {
        if ("ref" in l.quantity) expect(l.unit, `${g.id}/${l.id}`).toBe(budget.QUANTITY_DEFS[l.quantity.ref].unit);
      }
    }
  });

  it("keeps its prices coherent with the Energy assumptions (PV and battery, with VAT)", () => {
    const book = budget.parsePricebook(pricebookJson);
    const a = energy.parseAssumptions(assumptionsJson);
    const lineOf = (ref: budget.QuantityKey) => {
      for (const g of book.groups) for (const l of g.lines) if ("ref" in l.quantity && l.quantity.ref === ref) return { line: l, rate: book.vat.classes[g.vat] };
      throw new Error(`no line uses ${ref}`);
    };
    const pv = lineOf("pv.kwp");
    const bat = lineOf("battery.kwh");
    expect(pv.line.price * (1 + pv.rate)).toBeCloseTo(a.inputs.pvPricePerKwp.default as number, -2);
    expect(bat.line.price * (1 + bat.rate)).toBeCloseTo(a.inputs.batteryPricePerKwh.default as number, -2);
  });

  it("rejects what the schema is meant to catch", () => {
    const bad: Record<string, (b: Record<string, any>) => void> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      "unknown quantity": (b) => { b.groups[0].lines[0].quantity = { ref: "nonsense" }; },
      "negative price": (b) => { b.groups[0].lines[0].price = -1; },
      "unknown unit": (b) => { b.groups[0].lines[0].unit = "bags"; },
      "unknown VAT class": (b) => { b.groups[0].vat = "luxury"; },
      "duplicate line id": (b) => { b.groups[0].lines[1].id = b.groups[0].lines[0].id; },
      "duplicate group id": (b) => { b.groups[1].id = b.groups[0].id; },
      "overhead id clashes with a line": (b) => { b.siteOverhead.id = b.groups[0].lines[0].id; },
      "overhead in an unknown group": (b) => { b.siteOverhead.groupId = "nowhere"; },
      "overhead in an optional group": (b) => { b.siteOverhead.groupId = "outdoor"; },
      "non-optional group switched off": (b) => { b.groups[0].defaultOn = false; },
      "reserve default outside its range": (b) => { b.reserve.default = 0.5; },
      "VAT rate above 1": (b) => { b.vat.classes.residential = 12; },
      "empty group": (b) => { b.groups[0].lines = []; },
      "missing Czech name": (b) => { b.groups[0].name = { en: "x" }; },
    };
    for (const [name, mutate] of Object.entries(bad)) {
      const b = clone();
      mutate(b);
      expect(parse(b).success, name).toBe(false);
    }
  });

  it("accepts a book without the overhead line", () => {
    const b = clone();
    b.siteOverhead = null;
    expect(parse(b).success).toBe(true);
  });
});

describe("climate data (src/lib/data/pvgis.json) as ClimateData", () => {
  it("has every field the energy module reads, for each house-frame facing", () => {
    const c = pvgisJson as unknown as energyCore.ClimateData;
    expect(c.schema).toBe("pvgis/1");
    for (const d of DIRS) {
      expect(c.facings[d].azimuthDeg, d).toBeTypeOf("number");
      expect(c.monthly[d], d).toHaveLength(12);
      expect(c.vertical[d], d).toHaveLength(12);
      expect(c.profileUTC[d], d).toHaveLength(12);
      expect(c.profileUTC[d][0], d).toHaveLength(24);
    }
    expect(c.tempUTC).toHaveLength(12);
    expect(c.tempUTC[0]).toHaveLength(24);
  });

  it("belongs to the model: roof pitch, house axis bearing and location", () => {
    const { house, derived } = baseline();
    const c = pvgisJson as unknown as energyCore.ClimateData;
    for (const f of derived.roofPlanes) expect(Math.abs(f.pitch - c.slope)).toBeLessThan(0.5);
    expect(Math.abs(derived.houseAxisBearingDeg - c.houseAxisBearingDeg)).toBeLessThan(0.5);
    expect(c.meta.lat).toBe(house.location.lat);
    expect(c.meta.lon).toBe(house.location.lon);
  });
});
