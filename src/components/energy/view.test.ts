// The figures of the Energy page are the calculation's own numbers: every amount on the page parses back to the calc output
// rounded as stated (three significant digits for money estimates, whole crowns in the bill), money is written one way per
// language, the bill adds up and the heat table accounts for every envelope row exactly once.
import { describe, expect, it } from "vitest";
import { computeEnergy, defaultEnergyContext, defaultInputs, type EnergyResult } from "@/lib/calc/energy";
import { VALUE_SLOT, getFormatter, parseNum, roundSig } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { billRows, electricityRows, heatGroups, keyFigures, moneyAffixes, moneyFigures, paybackFigure, statAffixes } from "./view";

const ctx = defaultEnergyContext();
const base = computeEnergy(defaultInputs(ctx), ctx);
const LOCALES = ["cs", "en"] as const;
const n = (text: string, locale: "cs" | "en") => parseNum(text, locale)!;

describe("statAffixes", () => {
  it("tells a prefix, an attached suffix and a spaced unit apart", () => {
    expect(statAffixes(`${VALUE_SLOT} mil. Kč`)).toEqual({ unit: "mil. Kč" });
    expect(statAffixes(`CZK ${VALUE_SLOT}M`)).toEqual({ prefix: "CZK", suffix: "M" });
    expect(statAffixes(`CZK\u{a0}${VALUE_SLOT}/m²`)).toEqual({ prefix: "CZK", suffix: "/m²" });
    expect(statAffixes(VALUE_SLOT)).toEqual({});
    expect(() => statAffixes("no slot")).toThrow();
  });
});

for (const locale of LOCALES) {
  const t = getT(locale);
  const f = getFormatter(locale);

  describe(`energy figures (${locale})`, () => {
    it("shows the calculation's heat load, heat demand, electricity and PV yield, with PV as the one mint figure", () => {
      const figs = keyFigures(base, t, f);
      expect(figs.map((s) => n(s.value, locale))).toEqual([
        Math.round(base.designLoad.totalW / 100) / 10,
        Math.round(base.totals.heatNeedKwh / 100) / 10,
        Math.round(base.totals.elTotalKwh / 100) / 10,
        Math.round(base.totals.pvKwh / 100) / 10,
      ]);
      expect(figs.filter((s) => s.accent).map((s) => s.key)).toEqual(["pv"]);
      // one kWp format on the site: one decimal (Home shows the same)
      expect(figs[3].label).toContain(f.unit(base.totals.kwp, t("energy.units.kwp"), 1));
      for (const s of figs) expect(s.label.startsWith("energy.")).toBe(false);
    });

    it("rounds the money figures to three significant digits of the calculation's values and writes money one way", () => {
      const figs = moneyFigures(base, t, f);
      const [savings, bill, investment] = figs;
      expect(n(savings.value, locale)).toBe(roundSig(base.economics.savings));
      expect(n(bill.value, locale)).toBe(roundSig(base.economics.costWithPv));
      expect(n(investment.value, locale)).toBe(roundSig(base.economics.investment));
      const affixes = moneyAffixes(f);
      for (const s of [savings, bill, investment]) expect({ prefix: s.prefix, suffix: s.suffix, unit: s.unit }).toEqual({ prefix: affixes.prefix, suffix: affixes.suffix, unit: affixes.unit });
      // the order of currency and amount is the same as in every table of the site (format.ts)
      const sample = f.money(1234);
      if (affixes.prefix) expect(sample.startsWith(affixes.prefix)).toBe(true);
      if (affixes.unit) expect(sample.endsWith(affixes.unit)).toBe(true);
    });

    it("splits the bill into parts that add up to the net bill of the calculation", () => {
      const rows = billRows(base, t, f);
      const net = rows.find((r) => r.key === "net")!;
      const parts = rows.filter((r) => r.key !== "net");
      expect(parts.reduce((s, r) => s + r.amount, 0)).toBe(net.amount);
      expect(Math.abs(net.amount - base.economics.bill.net)).toBeLessThanOrEqual(1.5);
      const income = rows.find((r) => r.key === "exportIncome")!;
      expect(income.amount).toBeLessThan(0);
      expect(n(income.text.replace(/[^\d\s\u{a0},.]/gu, "").trim(), locale)).toBe(Math.round(base.economics.bill.exportIncome)); // no sign in the text
      expect(net.label).toBe(t(net.amount < 0 ? "energy.bill.netNegative" : "energy.bill.net"));
    });

    it("names every payback status", () => {
      const variant = (e: Partial<EnergyResult["economics"]>): EnergyResult => ({ ...base, economics: { ...base.economics, ...e } });
      const ok = paybackFigure(base, t, f);
      expect(n(ok.value, locale)).toBeCloseTo(base.economics.paybackYears!, 1);
      const beyond = paybackFigure(variant({ status: "beyondLife", paybackYears: 31.2 }), t, f);
      expect(n(beyond.value, locale)).toBe(31.2);
      expect(beyond.label).toBe(t("energy.money.beyondLife", { life: t("common.count.years", { count: base.economics.lifeYears }) }));
      expect(paybackFigure(variant({ status: "never", paybackYears: null }), t, f)).toMatchObject({ label: t("energy.money.never") });
      expect(paybackFigure(variant({ status: "none", paybackYears: null, investmentGross: 0 }), t, f)).toMatchObject({ label: t("energy.money.none") });
      expect(paybackFigure(variant({ status: "none", paybackYears: null, investmentGross: 1000 }), t, f)).toMatchObject({ label: t("energy.money.subsidyCovers") });
    });

    it("groups the envelope by kind, sorted by loss, and accounts for every row once", () => {
      const { groups, total } = heatGroups(base, t, "ventilation");
      expect(total).toBeCloseTo(base.envelope.hTransmission + base.ventilation.hV, 9);
      expect(groups.reduce((s, g) => s + g.h, 0)).toBeCloseTo(total, 9);
      expect(groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1, 9);
      for (let i = 1; i < groups.length; i++) expect(groups[i - 1].h).toBeGreaterThanOrEqual(groups[i].h);
      expect(groups.filter((g) => g.largest)).toEqual([groups[0]]);
      // one row per kind, the directions inside
      const kinds = new Set(base.envelope.rows.map((r) => r.kind));
      expect(groups.filter((g) => g.kind !== "ventilation").map((g) => g.kind).sort()).toEqual([...kinds].sort());
      for (const g of groups) {
        if (g.parts.length) {
          expect(g.parts.reduce((s, p) => s + p.h, 0)).toBeCloseTo(g.h, 9);
          expect(g.parts.reduce((s, p) => s + (p.area ?? 0), 0)).toBeCloseTo(g.area!, 9);
        }
        expect(g.label.startsWith("energy.")).toBe(false);
      }
      const rowsSeen = groups.flatMap((g) => (g.parts.length ? g.parts.map((p) => p.key) : g.kind === "ventilation" ? [] : base.envelope.rows.filter((r) => r.kind === g.kind).map((r) => r.key)));
      expect(rowsSeen.sort()).toEqual(base.envelope.rows.map((r) => r.key).sort());
    });

    it("lists electricity by purpose, the pool on its own row, the shares adding up to the whole", () => {
      const rows = electricityRows(base, t, f);
      expect(rows.reduce((s, r) => s + r.kwh, 0)).toBeCloseTo(base.totals.elTotalKwh, 6);
      expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
      expect(rows.some((r) => r.key === "pool")).toBe(base.totals.elPoolKwh > 0);
      expect(rows.every((r) => r.kwh > 0)).toBe(true);
    });
  });
}

describe("energy figures follow the inputs", () => {
  it("drops the pool row when the pool is switched off", () => {
    const off = computeEnergy({ ...defaultInputs(ctx), pool: false }, ctx);
    expect(electricityRows(off, getT("cs"), getFormatter("cs")).some((r) => r.key === "pool")).toBe(false);
  });
  it("has no bill split of export income without panels", () => {
    const none = computeEnergy({ ...defaultInputs(ctx), pv: { ...defaultInputs(ctx).pv, panelCount: 0 } }, ctx);
    expect(billRows(none, getT("en"), getFormatter("en")).some((r) => r.key === "exportIncome")).toBe(false);
  });
});
