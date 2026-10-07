// Cross-module consistency (docs/CALC-API.md, section 11): the kWp shown by Energy, the Model layer and the Budget is one
// number for one selection, and the Budget's PV investment is the Energy investment without VAT.
import siteJson from "@model/site.json";
import { describe, expect, it } from "vitest";
import { createSite } from "@/lib/model/site";
import { derived, house, metrics } from "@/lib/model/instance";
import { computeBudget, defaultBudgetSettings, defaultPricebook, deriveQuantities, pvQuantities } from "../budget";
import { computeEnergy, defaultEnergyContext, defaultInputs } from "../energy";
import { currentPvSelection, defaultPvSelection, layoutPanels } from "../roofLayout";
import { rng } from "./energyFixtures";

const ctx = defaultEnergyContext();
const site = createSite(siteJson, house.location.houseAxisBearingDeg);
const batteryOf = (id: string) => house.equipment.battery.options.find((o) => o.id === id)?.capacityKwh ?? 0;

describe("one selection, one kWp", () => {
  it("is the same in Energy, in the Model layout, in the derived data and in the Budget for the default selection", () => {
    const sel = defaultPvSelection(house, ctx.planes, derived);
    const layout = layoutPanels(ctx.planes, house.equipment.pv, { count: sel.panelCount, enabledPlanes: sel.enabledPlanes, obstacles: ctx.obstacles });
    const energy = computeEnergy(defaultInputs(ctx), ctx);
    const q = deriveQuantities(house, derived, site, { metrics });
    expect(energy.totals.kwp).toBeCloseTo(layout.kwp, 12);
    expect(layout.kwp).toBeCloseTo(derived.pv.kwp, 12);
    expect(q["pv.kwp"]).toBeCloseTo(layout.kwp, 12);
    expect(q["pv.count"]).toBe(layout.count);
    expect(q["battery.kwh"]).toBe(batteryOf(sel.batteryId));
  });

  it("is the same for random selections (seeded)", () => {
    const next = rng(31);
    const capacity = computeEnergy(defaultInputs(ctx), ctx).layout.capacity;
    const batteries = house.equipment.battery.options.map((o) => o.id);
    for (let i = 0; i < 40; i++) {
      const enabled = ctx.planes.filter(() => next() < 0.6).map((p) => p.key);
      const sel = { panelCount: Math.floor(next() * (capacity + 10)), enabledPlanes: enabled, batteryId: batteries[Math.floor(next() * batteries.length)] };
      const energy = computeEnergy({ ...defaultInputs(ctx), pv: sel }, ctx);
      const layout = layoutPanels(ctx.planes, house.equipment.pv, { count: sel.panelCount, enabledPlanes: sel.enabledPlanes, obstacles: ctx.obstacles });
      const q = deriveQuantities(house, derived, site, { metrics, pv: { panelCount: layout.count, kwp: layout.kwp, batteryKwh: batteryOf(sel.batteryId) } });
      expect(energy.totals.kwp).toBeCloseTo(layout.kwp, 12);
      expect(q["pv.kwp"]).toBeCloseTo(layout.kwp, 12);
      expect(q["pv.count"]).toBe(layout.count);
      expect(q["battery.kwh"]).toBe(batteryOf(sel.batteryId));
    }
  });

  it("returns the defaults on the server (no storage)", () => {
    expect(currentPvSelection(defaultPvSelection(house, ctx.planes, derived), ctx.planes, house.equipment.battery.options.map((o) => o.id))).toEqual(defaultPvSelection(house, ctx.planes, derived));
  });
});

describe("investment: Budget and Energy", () => {
  it("the price book's PV and battery lines, with VAT, equal the Energy gross investment at the default prices", () => {
    const book = defaultPricebook();
    const energy = computeEnergy(defaultInputs(ctx), ctx);
    const sel = energy.inputs.pv;
    const layout = energy.layout;
    const pv = pvQuantities(house, derived.pv, { panelCount: layout.count, kwp: layout.kwp, batteryKwh: batteryOf(sel.batteryId) });
    const q = { ...deriveQuantities(house, derived, site, { metrics }), ...pv };
    const group = book.groups.find((g) => g.lines.some((l) => "ref" in l.quantity && l.quantity.ref === "pv.kwp"));
    expect(group).toBeDefined();
    const settings = defaultBudgetSettings(book);
    if (group?.optional) settings.groups[group.id] = true;
    const result = computeBudget(book, q, settings);
    const lines = result.groups.find((g) => g.id === group?.id)?.lines ?? [];
    const amount = lines.filter((l) => l.quantityRef === "pv.kwp" || l.quantityRef === "battery.kwh").reduce((s, l) => s + l.amount, 0);
    const withVat = amount * (1 + (book.vat.classes[group?.vat ?? book.vat.default] ?? 0));
    expect(Math.abs(withVat - energy.economics.investmentGross) / energy.economics.investmentGross).toBeLessThan(0.01);
  });
});
