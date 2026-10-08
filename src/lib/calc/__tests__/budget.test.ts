// Totals, settings and CSV of the budget. The synthetic book is small enough to check every number by hand (see budgetFixtures.ts);
// the real book is checked against its own invariants and against the model.
import { describe, expect, it } from "vitest";
import {
  computeBudget, defaultBudgetSettings, defaultPricebook, estimateBand, parsePricebook, ruleQuantity, sanitizeBudgetSettings, toCsv, QUANTITY_DEFS, UNIT_KEYS,
  type BudgetSettings, type CsvLabels, type PriceGroup, type Quantities, type QuantityKey,
} from "../budget";
import { modelQuantities, prng, readCsv, syntheticBook, syntheticQuantities } from "./budgetFixtures";

const book = syntheticBook();
const q = syntheticQuantities();
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

describe("computeBudget on a book that can be checked by hand", () => {
  const r = computeBudget(book, q);

  it("adds up the groups, the overhead, the reserve and the VAT", () => {
    // g1 = 100 x 1000 + 2 x 50000 = 200000, overhead round(0.03 x 200000 / 1000) x 1000 = 6000 -> 206000; g2 = 80 x 500 = 40000; g3 = 30000 (on); g4 = 7000 (off)
    expect(r.works).toBe(200_000);
    expect(r.groups.map((g) => g.subtotal)).toEqual([206_000, 40_000, 30_000, 7_000]);
    expect(r.groups.map((g) => g.on)).toEqual([true, true, true, false]);
    expect(r.core).toBe(246_000);
    expect(r.extras).toBe(30_000);
    expect(r.net).toBe(276_000);
    expect(r.reserveShare).toBe(0.1);
    expect(r.reserve).toBeCloseTo(27_600, 6);
    // VAT: 206000 x 1.1 x 12 % + 40000 x 1.1 x 12 % + 30000 x 1.1 x 21 %
    expect(r.vatByClass.low).toBeCloseTo(206_000 * 1.1 * 0.12 + 40_000 * 1.1 * 0.12, 6);
    expect(r.vatByClass.high).toBeCloseTo(30_000 * 1.1 * 0.21, 6);
    expect(r.vat).toBeCloseTo(39_402, 6);
    expect(r.total).toBeCloseTo(343_002, 6);
    expect(r.coreWithVat).toBeCloseTo(206_000 * 1.1 * 1.12 + 40_000 * 1.1 * 1.12, 6);
    expect(r.floorArea).toBe(80);
    expect(r.perM2).toBeCloseTo(r.coreWithVat / 80, 9);
  });

  it("the groups add up to the whole and the VAT classes to the VAT", () => {
    expect(sum(r.groups.filter((g) => g.on).map((g) => g.subtotal))).toBe(r.net);
    expect(sum(Object.values(r.vatByClass))).toBeCloseTo(r.vat, 9);
    expect(r.net + r.reserve + r.vat).toBeCloseTo(r.total, 9);
    for (const g of r.groups) expect(sum(g.lines.map((l) => l.amount)), g.id).toBeCloseTo(g.subtotal, 9);
  });

  it("carries the overhead line in its group, not in its own basis", () => {
    const oh = r.groups[0].lines.at(-1)!;
    expect(oh).toMatchObject({ id: "overhead", overhead: true, unit: "set", quantity: 1, price: 6_000, amount: 6_000, quantityRef: null, waste: null });
    expect(r.groups.flatMap((g) => g.lines).filter((l) => l.overhead)).toHaveLength(1);
  });

  it("keeps the computed values next to the effective ones", () => {
    const a = r.groups[0].lines[0];
    expect(a).toMatchObject({ id: "a", quantity: 100, defaultQuantity: 100, price: 1000, defaultPrice: 1000, amount: 100_000, quantityRef: "footprintArea", quantityEdited: false, priceEdited: false });
    expect(r.groups[1].lines[0].waste).toBe(0.1);
  });

  it("switching an optional group moves the totals by that group only", () => {
    const off = computeBudget(book, q, { ...defaultBudgetSettings(book), groups: { g3: false, g4: false } });
    expect(off.extras).toBe(0);
    expect(off.net).toBe(246_000);
    expect(off.vatByClass.high).toBe(0);
    expect(off.total).toBeCloseTo(246_000 * 1.1 + 246_000 * 1.1 * 0.12, 6);
    expect(off.coreWithVat).toBeCloseTo(r.coreWithVat, 9); // the house price does not know about options
    const on = computeBudget(book, q, { ...defaultBudgetSettings(book), groups: { g3: true, g4: true } });
    expect(on.extras).toBe(37_000);
    expect(on.groups[3].on).toBe(true);
  });

  it("ignores a switch of a group that is not optional", () => {
    const s = computeBudget(book, q, { reserve: 0.1, groups: { g1: false }, overrides: {} });
    expect(s.groups[0].on).toBe(true);
    expect(s.core).toBe(r.core);
  });

  it("applies the reserve at both ends of its range and keeps it in range", () => {
    const none = computeBudget(book, q, { ...defaultBudgetSettings(book), reserve: 0 });
    expect(none.reserve).toBe(0);
    expect(none.total).toBeCloseTo(276_000 + 276_000 * 0 + (206_000 + 40_000) * 0.12 + 30_000 * 0.21, 6);
    const max = computeBudget(book, q, { ...defaultBudgetSettings(book), reserve: 0.15 });
    expect(max.reserve).toBeCloseTo(41_400, 6);
    const over = computeBudget(book, q, { ...defaultBudgetSettings(book), reserve: 0.9 });
    expect(over.reserveShare).toBe(0.15);
    const under = computeBudget(book, q, { ...defaultBudgetSettings(book), reserve: -1 });
    expect(under.reserveShare).toBe(0);
  });

  it("an edit changes its own line and the overhead, nothing else", () => {
    const edited = computeBudget(book, q, { ...defaultBudgetSettings(book), overrides: { a: { quantity: 150 } } });
    const a = edited.groups[0].lines[0];
    expect(a).toMatchObject({ quantity: 150, defaultQuantity: 100, amount: 150_000, quantityEdited: true, priceEdited: false });
    // works 250000 -> overhead round(7500 / 1000) x 1000 = 8000 (JavaScript rounds .5 up)
    expect(edited.works).toBe(250_000);
    expect(edited.groups[0].lines.at(-1)!.price).toBe(8_000);
    for (const [i, g] of edited.groups.entries()) {
      if (i === 0) continue;
      expect(g.subtotal).toBe(r.groups[i].subtotal);
    }
    expect(edited.groups[0].lines[1].amount).toBe(r.groups[0].lines[1].amount);
  });

  it("an edit of a line outside the basis leaves the overhead alone", () => {
    const edited = computeBudget(book, q, { ...defaultBudgetSettings(book), overrides: { c: { price: 900 } } });
    expect(edited.groups[0].lines.at(-1)!.price).toBe(6_000);
    expect(edited.groups[1].subtotal).toBe(72_000);
  });

  it("the overhead itself can be edited, and then stops following the work", () => {
    const edited = computeBudget(book, q, { ...defaultBudgetSettings(book), overrides: { overhead: { price: 20_000 }, a: { quantity: 500 } } });
    const oh = edited.groups[0].lines.at(-1)!;
    expect(oh).toMatchObject({ price: 20_000, defaultPrice: Math.round((0.03 * 600_000) / 1000) * 1000, priceEdited: true });
    expect(edited.groups[0].subtotal).toBe(500_000 + 100_000 + 20_000);
  });

  it("the overhead follows only the groups that are on", () => {
    const withBasisOptional = parsePricebook({
      ...JSON.parse(JSON.stringify(book)),
      groups: [
        ...JSON.parse(JSON.stringify(book.groups)),
        { id: "g5", name: { cs: "Práce navíc", en: "Extra work" }, optional: true, defaultOn: false, vat: "low", siteOverheadBasis: true, lines: [{ id: "f", name: { cs: "Práce", en: "Work" }, unit: "pcs", quantity: { value: 1 }, price: 100_000 }] },
      ],
    });
    const off = computeBudget(withBasisOptional, q);
    expect(off.works).toBe(200_000);
    const on = computeBudget(withBasisOptional, q, { ...defaultBudgetSettings(withBasisOptional), groups: { g3: true, g4: false, g5: true } });
    expect(on.works).toBe(300_000);
    expect(on.groups[0].lines.at(-1)!.price).toBe(9_000);
  });

  it("edits equal to the computed values do not count as edited", () => {
    const same = computeBudget(book, q, { ...defaultBudgetSettings(book), overrides: { a: { quantity: 100, price: 1000 } } });
    expect(same.groups[0].lines[0]).toMatchObject({ quantityEdited: false, priceEdited: false });
    expect(same.total).toBeCloseTo(r.total, 9);
  });

  it("ignores negative and non-finite edits and never returns NaN", () => {
    const bad = computeBudget(book, q, {
      reserve: Number.NaN,
      groups: {},
      overrides: { a: { quantity: -5, price: Number.NaN }, b: { quantity: Number.POSITIVE_INFINITY }, unknown: { price: 1 } },
    } as BudgetSettings);
    expect(bad.total).toBeCloseTo(r.total, 9);
    for (const v of [bad.total, bad.vat, bad.net, bad.reserve, bad.coreWithVat, bad.perM2 ?? 0]) expect(Number.isFinite(v)).toBe(true);
  });

  it("has no price per m2 when there is no heated floor", () => {
    expect(computeBudget(book, { ...q, floorAreaHeated: 0 }).perM2).toBeNull();
  });

  it("works with no overhead in the book", () => {
    const plain = parsePricebook({ ...JSON.parse(JSON.stringify(book)), siteOverhead: null });
    const p = computeBudget(plain, q);
    expect(p.core).toBe(240_000);
    expect(p.groups.flatMap((g) => g.lines).some((l) => l.overhead)).toBe(false);
  });
});

describe("quantity rules and the estimate band", () => {
  it("scales a model quantity, shifts it and never goes negative", () => {
    expect(ruleQuantity({ ref: "footprintArea" }, q)).toBe(100);
    expect(ruleQuantity({ ref: "footprintArea", factor: 0.5, offset: 10 }, q)).toBe(60);
    expect(ruleQuantity({ ref: "footprintArea", offset: -500 }, q)).toBe(0);
    expect(ruleQuantity({ value: 3 }, q)).toBe(3);
  });

  it("multiplies the benchmark per m2 by the heated floor area", () => {
    expect(estimateBand(book, 80)).toEqual({ low: 80_000, high: 160_000 });
    expect(estimateBand(book, 0)).toBeNull();
    expect(estimateBand(parsePricebook({ ...JSON.parse(JSON.stringify(book)), benchmark: undefined }), 80)).toBeNull();
  });
});

describe("sanitizeBudgetSettings", () => {
  it("turns anything into the defaults", () => {
    for (const raw of [undefined, null, 5, "x", [], [1, 2], {}, { reserve: "a", groups: 3, overrides: [] }]) {
      expect(sanitizeBudgetSettings(raw, book), String(JSON.stringify(raw))).toEqual(defaultBudgetSettings(book));
    }
  });

  it("keeps what is valid and drops the rest", () => {
    const s = sanitizeBudgetSettings(
      {
        reserve: 0.07,
        groups: { g3: false, g4: true, g1: false, nope: true, g2: "yes" },
        overrides: { a: { quantity: 3, price: -1 }, b: { quantity: Number.NaN, price: Infinity }, c: {}, nope: { price: 1 }, overhead: { price: 0 }, d: "x" },
      },
      book,
    );
    expect(s).toEqual({ reserve: 0.07, groups: { g3: false, g4: true }, overrides: { a: { quantity: 3 }, overhead: { price: 0 } } });
  });

  it("snaps the reserve to the step and clamps it", () => {
    expect(sanitizeBudgetSettings({ reserve: 0.0834 }, book).reserve).toBe(0.08);
    expect(sanitizeBudgetSettings({ reserve: 7 }, book).reserve).toBe(0.15);
    expect(sanitizeBudgetSettings({ reserve: -7 }, book).reserve).toBe(0);
  });

  it("is idempotent and total on random garbage", () => {
    const rnd = prng(20260607);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const junk = (depth = 0): unknown => {
      const kind = Math.floor(rnd() * 8);
      if (kind === 0) return pick([null, undefined, true, false, "", "abc", NaN, Infinity, -Infinity]);
      if (kind === 1) return (rnd() - 0.4) * pick([1, 100, 1e15]);
      if (kind === 2 && depth < 3) return Array.from({ length: Math.floor(rnd() * 3) }, () => junk(depth + 1));
      const o: Record<string, unknown> = {};
      for (const k of ["reserve", "groups", "overrides", "g1", "g3", "g4", "a", "b", "c", "d", "overhead", "quantity", "price", "x"]) if (rnd() < 0.4) o[k] = depth < 3 ? junk(depth + 1) : 1;
      return o;
    };
    const lineIds = new Set(["a", "b", "c", "d", "e", "overhead"]);
    for (let i = 0; i < 300; i++) {
      const s = sanitizeBudgetSettings(junk(), book);
      expect(sanitizeBudgetSettings(s, book)).toEqual(s);
      expect(s.reserve).toBeGreaterThanOrEqual(0);
      expect(s.reserve).toBeLessThanOrEqual(0.15);
      expect(Object.keys(s.groups).sort()).toEqual(["g3", "g4"]);
      for (const [id, o] of Object.entries(s.overrides)) {
        expect(lineIds.has(id)).toBe(true);
        expect(Object.keys(o).length).toBeGreaterThan(0);
        for (const v of Object.values(o)) expect(Number.isFinite(v) && v >= 0).toBe(true);
      }
      const r = computeBudget(book, q, s);
      expect(Number.isFinite(r.total)).toBe(true);
      expect(r.total).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("toCsv", () => {
  const labels: CsvLabels = {
    group: "Group", item: "Item", quantity: "Quantity", unit: "Unit", unitPrice: "Unit price", amount: "Amount",
    net: "Net", reserve: (p) => `Reserve ${p} %`, vat: "VAT", total: "Total",
  };
  const unitLabel = (u: string) => `u:${u}`;
  const settings: BudgetSettings = { ...defaultBudgetSettings(book), overrides: { c: { quantity: 80.456, price: 512.5 } } };
  const result = computeBudget(book, q, settings);

  for (const locale of ["cs", "en"] as const) {
    const sep = locale === "cs" ? ";" : ",";
    const csv = toCsv(result, book, { locale, labels, unitLabel });
    const rows = readCsv(csv, sep);

    it(`${locale}: starts with a byte-order mark, ends rows with CRLF and has no bare line feed outside quotes`, () => {
      expect(csv.startsWith("﻿")).toBe(true);
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv.replaceAll("\r\n", "").includes("\n")).toBe(false);
    });

    it(`${locale}: has the header, one row per line of the groups that are on, a blank row and the summary`, () => {
      expect(rows[0]).toEqual(["Group", "Item", "Quantity", "Unit", "Unit price", "Amount"]);
      const lines = result.groups.filter((g) => g.on).flatMap((g) => g.lines);
      expect(rows).toHaveLength(1 + lines.length + 1 + 4);
      expect(rows[1 + lines.length]).toEqual([""]);
      expect(rows.slice(-4).map((r) => r[1])).toEqual(["Net", "Reserve 10 %", "VAT", "Total"]);
      expect(rows.every((r, i) => i === 1 + lines.length || r.length === 6)).toBe(true);
    });

    it(`${locale}: leaves out the groups that are off`, () => {
      expect(rows.some((r) => r[1] === (locale === "cs" ? "Volba" : "Option item"))).toBe(false);
      expect(rows.some((r) => r[0] === (locale === "cs" ? "Doplněk" : "Extra"))).toBe(true);
    });

    it(`${locale}: reproduces the totals when read back`, () => {
      const num = (s: string) => Number(s.replace(",", "."));
      const lineRows = rows.slice(1, rows.length - 5);
      const sumOfLines = sum(lineRows.map((r) => num(r[5])));
      expect(Math.abs(sumOfLines - result.net)).toBeLessThanOrEqual(lineRows.length * 0.5 + 1e-9);
      const [net, reserve, vat, total] = rows.slice(-4).map((r) => num(r[5]));
      expect(net).toBe(Math.round(result.net));
      expect(reserve).toBe(Math.round(result.reserve));
      expect(vat).toBe(Math.round(result.vat));
      expect(Math.abs(net + reserve + vat - total)).toBeLessThanOrEqual(1);
      expect(total).toBe(Math.round(result.total));
      // an edited line shows its effective quantity and price
      const floor = rows.find((r) => r[1] === (locale === "cs" ? "Podlaha" : "Floor"))!;
      expect(num(floor[2])).toBe(80.46);
      expect(num(floor[4])).toBe(512.5);
      expect(floor[3]).toBe("u:m2");
    });

    it(`${locale}: quotes cells that hold the separator, a quote or a line break`, () => {
      const name = locale === "cs" ? 'Přípojka, "hlavní"; a další' : 'Connection, "main"; and more';
      expect(rows.some((r) => r[1] === name)).toBe(true);
      expect(csv).toContain(`"${name.replaceAll('"', '""')}"`);
    });
  }

  it("uses the decimal comma and ';' in Czech, the decimal point and ',' in English, and nothing else differs in the numbers", () => {
    const cs = toCsv(result, book, { locale: "cs", labels, unitLabel });
    const en = toCsv(result, book, { locale: "en", labels, unitLabel });
    expect(cs).toContain("80,46;");
    expect(en).toContain("80.46,");
    const digits = (s: string) => s.replace(/[^\d]/g, "");
    const numeric = (rows: string[][]) => rows.slice(1, -5).map((r) => digits(r.slice(2).join("")));
    expect(numeric(readCsv(cs, ";"))).toEqual(numeric(readCsv(en, ",")));
  });

  it("quotes a header label that contains a line break", () => {
    const csv = toCsv(result, book, { locale: "en", labels: { ...labels, item: "Item\nname" }, unitLabel });
    expect(readCsv(csv, ",")[0][1]).toBe("Item\nname");
  });
});

describe("the project's price book against the model", () => {
  const real = defaultPricebook();
  const model = modelQuantities();
  const result = computeBudget(real, model);

  const refs = (g: PriceGroup): QuantityKey[] => g.lines.flatMap((l) => ("ref" in l.quantity ? [l.quantity.ref] : []));
  const groupOf = (ref: QuantityKey) => real.groups.find((g) => refs(g).includes(ref));

  it("prices the house as the other pages show it: groups that are always on, and every option on by default", () => {
    expect(real.groups.filter((g) => !g.optional).length).toBeGreaterThan(0);
    for (const g of real.groups) expect(g.defaultOn, g.id).toBe(true);
    const settings = defaultBudgetSettings(real);
    for (const g of real.groups.filter((x) => x.optional)) expect(settings.groups[g.id], g.id).toBe(true);
    // the PV and the pool are options the visitor can switch off, and both are on for the model's own house
    for (const ref of ["pv.kwp", "pool.count"] as const) {
      expect(groupOf(ref)?.optional, ref).toBe(true);
      expect(result.groups.find((g) => g.id === groupOf(ref)?.id)?.on, ref).toBe(true);
    }
  });

  it("every line with an amount is either a quantity of the model or a lump sum that says so", () => {
    for (const g of result.groups) {
      const def = real.groups.find((x) => x.id === g.id)!;
      for (const l of g.lines) {
        if (!(l.amount > 0) || l.overhead) continue;
        if (l.quantityRef) expect(model[l.quantityRef], `${g.id}/${l.id}`).toBeGreaterThan(0);
        else expect(def.lines.find((x) => x.id === l.id)?.note, `${g.id}/${l.id} is a lump sum without a note`).toBeDefined();
      }
    }
  });

  it("every element the model has beyond the bare shell is priced", () => {
    const priced = new Set(real.groups.flatMap(refs));
    const elements: QuantityKey[] = [
      "pool.count", "pool.waterArea", "pool.perimeter", "pool.volume", "pool.deckArea", "gate.drive.width", "gate.walk.count", "pillar.count",
      "rainTank.count", "fence.street.length", "fence.boundary.length", "site.gravelArea", "site.pavedArea", "driveArea", "pathArea",
      "pavingAreaUncovered", "coveredOutdoorArea", "coveredBeamLength", "postCount", "screenArea", "soffitArea", "ceilingAreaHeated",
      "roofInsulationArea", "unheatedPartitionArea", "linearDrainLength", "blind.count", "blind.area", "door.inside.count",
      "door.toUnheated.count", "heatPump.count", "kitchen.count", "treeCount", "treeUplight.count", "shrubCount", "lightpipe.count",
      "downpipe.count", "earthworkFillVolume", "woodCladdingArea",
    ];
    for (const k of elements) if (model[k] > 0) expect(priced.has(k), k).toBe(true);
    // nothing priced that the plan does not have any more: no line refers to the hedges of the old plot
    expect(priced.has("hedgeLength")).toBe(false);
  });

  it("only uses quantities of its own unit, and all its quantities exist", () => {
    for (const g of real.groups) for (const l of g.lines) if ("ref" in l.quantity) expect(l.unit, `${g.id}/${l.id}`).toBe(QUANTITY_DEFS[l.quantity.ref].unit);
    for (const g of real.groups) for (const l of g.lines) expect(UNIT_KEYS).toContain(l.unit);
  });

  it("has a name in both languages for everything shown", () => {
    for (const g of real.groups) {
      expect(g.name.cs.length).toBeGreaterThan(2);
      expect(g.name.en.length).toBeGreaterThan(2);
      for (const l of g.lines) expect(l.name.cs && l.name.en, l.id).toBeTruthy();
    }
  });

  it("every group has an amount, and the lines are what the model says (no group is empty by accident)", () => {
    for (const g of result.groups) expect(g.subtotal, g.id).toBeGreaterThan(0);
  });

  it("adds up", () => {
    expect(sum(result.groups.filter((g) => g.on).map((g) => g.subtotal))).toBeCloseTo(result.net, 6);
    expect(result.net + result.reserve + result.vat).toBeCloseTo(result.total, 6);
    expect(sum(Object.values(result.vatByClass))).toBeCloseTo(result.vat, 6);
    expect(result.reserveShare).toBe(real.reserve.default);
  });

  it("the house price per m2 is inside the orientation band", () => {
    const band = estimateBand(real, result.floorArea)!;
    expect(result.coreWithVat).toBeGreaterThan(band.low);
    expect(result.coreWithVat).toBeLessThan(band.high);
  });

  it("the house takes the reduced VAT; kitchen furniture, stand-alone outdoor structures and the pool the standard rate", () => {
    expect(real.vat.classes.residential).toBe(0.12);
    expect(real.vat.classes.standard).toBe(0.21);
    for (const g of real.groups.filter((x) => !x.optional)) expect(g.vat, g.id).toBe("residential");
    const standalone = (k: QuantityKey) => /^(fence\.|gate\.|pillar\.|pool\.|site\.)/.test(k) || k === "earthworkFillVolume" || k === "greenArea";
    for (const g of real.groups) {
      if (refs(g).some(standalone)) expect(g.vat, g.id).toBe("standard");
    }
    expect(groupOf("kitchenRunLength")?.vat).toBe("standard");
    expect(groupOf("pv.kwp")?.vat).toBe("residential");
  });

  it("names its lines with the words of the glossary (docs/COPY.md)", () => {
    const cs: RegExp[] = [/lamelov\p{L}* (?:stěny|stěn\b|zástěn)|zástěn/iu, /obvodov\p{L}* zd/iu, /nosn\p{L}* příč/iu, /posuvn\p{L}* stěn|zasklen\p{L}* stěn/iu, /živ\p{L}* plot/iu, /anhydrit/iu];
    const en: RegExp[] = [/\bexterior (?:walls?|blinds?|doors?)\b/i, /\bhip roof/i, /\bslat(?:ted)? screens?\b/i, /\bphotovoltaics\b/i, /\bterraces\b/i, /façade/i, /anhydrite/i, /\bhedge/i];
    const names = [...real.groups.map((g) => g.name), ...real.groups.flatMap((g) => g.lines.map((l) => l.name)), ...(real.siteOverhead ? [real.siteOverhead.name] : [])];
    for (const n of names) {
      for (const re of cs) expect(re.test(n.cs), `${n.cs} ~ ${re.source}`).toBe(false);
      for (const re of en) expect(re.test(n.en), `${n.en} ~ ${re.source}`).toBe(false);
    }
  });

  it("scales with the model: a house twice the footprint costs more in the shell and the same in the kitchen", () => {
    const big: Quantities = { ...model };
    for (const k of ["footprintArea", "extWallLength", "extWallAreaOpaque", "ceilingArea", "roofAreaSloped", "floorAreaHeated"] as const) big[k] = model[k] * 2;
    const b = computeBudget(real, big);
    const sub = (r: typeof b, id: string) => r.groups.find((g) => g.id === id)!.subtotal;
    expect(sub(b, "shell")).toBeGreaterThan(sub(result, "shell") * 1.4);
    expect(sub(b, "kitchen")).toBe(sub(result, "kitchen"));
  });

  it("lists materials with a waste allowance only where it makes sense", () => {
    for (const g of real.groups) for (const l of g.lines) if (l.waste !== undefined) {
      expect(l.waste).toBeLessThan(0.3);
      expect(["m2", "m3", "m"]).toContain(l.unit);
    }
  });
});
