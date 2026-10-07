// The page's pure helpers: what is stored in the browser, how an edit is applied, the material cards and the estimate band scale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBudget, defaultBudgetSettings, defaultPricebook, materialTakeoff, type BudgetSettings } from "@/lib/calc/budget";
import { STORAGE_KEYS } from "@/lib/calc/storageKeys";
import { house, modelQuantities } from "@/lib/calc/__tests__/budgetFixtures";
import { bandScale } from "./bandScale";
import { cardOf, materialCards, SHEET_MAX_THICKNESS } from "./materialCards";
import { budgetFingerprint, isDefaultSettings, loadBudgetSettings, saveBudgetSettings, withOverride } from "./store";

const book = defaultPricebook();
const q = modelQuantities();
const fp = budgetFingerprint(q);

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("storage of the settings", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
  });
  afterEach(() => vi.unstubAllGlobals());

  const edited = (): BudgetSettings => ({ ...defaultBudgetSettings(book), reserve: 0.05, overrides: { "foundation-slab": { price: 3500 } }, groups: { ...defaultBudgetSettings(book).groups, pv: true } });

  it("round-trips the settings under the budget key", () => {
    saveBudgetSettings(edited(), book, fp);
    expect(store.data.has(STORAGE_KEYS.budget)).toBe(true);
    expect(loadBudgetSettings(book, fp)).toEqual(edited());
  });

  it("drops edits made for another model", () => {
    saveBudgetSettings(edited(), book, fp);
    expect(loadBudgetSettings(book, budgetFingerprint({ ...q, "window.area": q["window.area"] + 1 }))).toBeNull();
  });

  it("does not keep the book's own choice", () => {
    saveBudgetSettings(edited(), book, fp);
    saveBudgetSettings(defaultBudgetSettings(book), book, fp);
    expect(store.data.has(STORAGE_KEYS.budget)).toBe(false);
    expect(isDefaultSettings(defaultBudgetSettings(book), book)).toBe(true);
    expect(isDefaultSettings(edited(), book)).toBe(false);
  });

  it("repairs what it reads: unknown ids and bad numbers do not get through", () => {
    store.setItem(STORAGE_KEYS.budget, JSON.stringify({ v: 1, fp, data: { reserve: 99, groups: { pv: true, nope: true }, overrides: { "foundation-slab": { price: -5, quantity: 12 }, nope: { price: 1 } } } }));
    const s = loadBudgetSettings(book, fp)!;
    expect(s.reserve).toBe(book.reserve.max);
    expect(Object.keys(s.groups)).not.toContain("nope");
    expect(s.groups.pv).toBe(true);
    expect(s.overrides).toEqual({ "foundation-slab": { quantity: 12 } });
  });

  it("survives broken JSON and unavailable storage", () => {
    store.setItem(STORAGE_KEYS.budget, "{not json");
    expect(loadBudgetSettings(book, fp)).toBeNull();
    vi.stubGlobal("window", { get localStorage(): never { throw new Error("blocked"); } });
    expect(loadBudgetSettings(book, fp)).toBeNull();
    expect(() => saveBudgetSettings(edited(), book, fp)).not.toThrow();
  });

  it("the fingerprint follows the quantities of the model, not float noise", () => {
    expect(budgetFingerprint({ ...q, "pv.kwp": 99 })).not.toBe(fp); // the model's own PV is part of the model
    expect(budgetFingerprint({ ...q })).toBe(fp);
    expect(budgetFingerprint({ ...q, extWallLength: q.extWallLength + 0.001 })).toBe(fp); // float noise is not a change
    expect(budgetFingerprint({ ...q, extWallLength: q.extWallLength + 0.1 })).not.toBe(fp);
  });
});

describe("withOverride", () => {
  const s = defaultBudgetSettings(book);

  it("stores an edit, replaces it and removes it when it equals the computed value or is null", () => {
    const a = withOverride(s, "foundation-slab", "price", 4000, 3200);
    expect(a.overrides).toEqual({ "foundation-slab": { price: 4000 } });
    const b = withOverride(a, "foundation-slab", "quantity", 10, 253);
    expect(b.overrides["foundation-slab"]).toEqual({ price: 4000, quantity: 10 });
    const c = withOverride(b, "foundation-slab", "price", 3200, 3200);
    expect(c.overrides["foundation-slab"]).toEqual({ quantity: 10 });
    const d = withOverride(c, "foundation-slab", "quantity", null, 253);
    expect(d.overrides).toEqual({});
    expect(s.overrides).toEqual({});
  });

  it("ignores negative and non-finite values", () => {
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(withOverride(s, "foundation-slab", "price", v, 3200)).toBe(s);
  });

  it("moves the total by the edit and the reset puts it back", () => {
    const base = computeBudget(book, q, s);
    const slab = base.groups[0].lines.find((l) => l.id === "foundation-slab")!;
    const up = computeBudget(book, q, withOverride(s, slab.id, "price", slab.price + 100, slab.defaultPrice));
    expect(up.groups[0].lines.find((l) => l.id === slab.id)!.priceEdited).toBe(true);
    expect(up.core - base.core).toBeGreaterThan(slab.quantity * 100 - 1);
    const back = computeBudget(book, q, withOverride(withOverride(s, slab.id, "price", slab.price + 100, slab.defaultPrice), slab.id, "price", null, slab.defaultPrice));
    expect(back.total).toBe(base.total);
  });
});

describe("materialCards", () => {
  const rows = materialTakeoff(house, q);
  const result = computeBudget(book, q);
  const cards = materialCards(rows, result, book);

  it("puts structure into masonry and concrete, insulation and the whole roof into the second card", () => {
    expect(cardOf({ assembly: "exteriorWall", role: "structure" })).toBe("masonry");
    expect(cardOf({ assembly: "exteriorWall", role: "insulation" })).toBe("insulation");
    expect(cardOf({ assembly: "roof", role: "structure" })).toBe("insulation");
    expect(cardOf({ assembly: "roof", role: "air" })).toBeNull();
    expect(cardOf({ assembly: "groundFloor", role: "screed" })).toBe("finishes");
    expect(cardOf({ assembly: "bearingWall", role: "finish" })).toBeNull();
    expect(cards.masonry.length).toBeGreaterThan(3);
    expect(cards.insulation.length).toBeGreaterThan(3);
  });

  it("lists a body by volume and a sheet by area, with the volume the model says", () => {
    for (const item of [...cards.masonry, ...cards.insulation]) {
      const [assembly, layerId] = item.key.split("/");
      const row = rows.find((r) => r.assembly === assembly && r.layerId === layerId)!;
      if (row.thickness < SHEET_MAX_THICKNESS) expect([item.unit, item.value]).toEqual(["m2", row.area]);
      else expect([item.unit, item.value]).toEqual(["m3", row.volume]);
    }
    const eps = cards.insulation.find((i) => i.key === "exteriorWall/eps")!;
    expect(eps.unit).toBe("m3");
    expect(eps.value).toBeCloseTo(0.1 * q.extWallAreaOpaque, 9);
  });

  it("adds the allowance for offcuts to the floors and tiles and nothing to the others", () => {
    const oak = cards.finishes.find((i) => i.key === "floor-oak")!;
    expect(oak.waste).toBeGreaterThan(0);
    expect(oak.value).toBeCloseTo(q["floorArea.oak"] * (1 + oak.waste!), 9);
    const tiles = cards.finishes.find((i) => i.key === "wall-tiles")!;
    expect(tiles.value).toBeCloseTo(q.wetWallArea * 0.8 * (1 + tiles.waste!), 9);
    expect(cards.finishes.find((i) => i.key === "wall-plaster")!.waste).toBeNull();
    expect(cards.finishes.some((i) => i.key === "floor-stone")).toBe(q["floorArea.stone"] > 0);
  });

  it("follows the edits of the visitor", () => {
    const edited = computeBudget(book, q, withOverride(defaultBudgetSettings(book), "floor-oak", "quantity", 100, q["floorArea.oak"]));
    expect(materialCards(rows, edited, book).finishes.find((i) => i.key === "floor-oak")!.value).toBeCloseTo(100 * 1.07, 9);
  });

  it("leaves out switched-off groups", () => {
    const off = computeBudget(book, q, { ...defaultBudgetSettings(book), groups: { terrace: false } });
    expect(off.groups.find((g) => g.id === "terrace")!.on).toBe(false);
    expect(Object.values(materialCards(rows, off, book)).flat().every((i) => i.value > 0)).toBe(true);
  });
});

describe("bandScale", () => {
  it("covers the band and the value with round ticks in millions", () => {
    const s = bandScale(9.1e6, 12.5e6, 10.7e6);
    expect(s.min).toBeLessThanOrEqual(9.1e6);
    expect(s.max).toBeGreaterThanOrEqual(12.5e6);
    expect(s.ticks.every((t) => t % 1e6 === 0 && t >= s.min && t <= s.max)).toBe(true);
    expect(s.ticks.length).toBeGreaterThanOrEqual(3);
    expect(s.ticks.length).toBeLessThanOrEqual(8);
    expect(s.at(s.min)).toBe(0);
    expect(s.at(s.max)).toBe(1);
    expect(s.at(10.7e6)).toBeGreaterThan(s.at(9.1e6));
    expect(s.at(12.5e6)).toBeGreaterThan(s.at(10.7e6));
  });

  it("widens the scale for a value outside the band and keeps the position inside 0..1", () => {
    const low = bandScale(9e6, 12e6, 4e6);
    expect(low.min).toBeLessThanOrEqual(4e6);
    const high = bandScale(9e6, 12e6, 30e6);
    expect(high.max).toBeGreaterThanOrEqual(30e6);
    for (const s of [low, high]) {
      for (const v of [-1, 0, 5e6, 50e6, 1e9]) {
        expect(s.at(v)).toBeGreaterThanOrEqual(0);
        expect(s.at(v)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("classifies the value against the band", () => {
    expect(bandScale(9e6, 12e6, 8e6).where).toBe("below");
    expect(bandScale(9e6, 12e6, 10e6).where).toBe("within");
    expect(bandScale(9e6, 12e6, 13e6).where).toBe("above");
    expect(bandScale(9e6, 12e6, 9e6).where).toBe("within");
  });
});
