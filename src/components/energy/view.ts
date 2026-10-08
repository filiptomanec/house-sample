// What the Energy page shows, as plain data: the figures of the two stat rows, the bill split, the heat-loss table grouped by
// kind, the electricity rows. Pure functions of the calculation result, the translator and the formatter, so the unit tests can
// check that every figure on the page is the calculation's own number (rounded as stated) and that nothing is typed here.

import type { EnergyResult, EnvelopeKind, PaybackPart, PaybackStatus } from "@/lib/calc/energy";
import { EN_DASH, NBSP, VALUE_SLOT, roundSig, type Formatter } from "@/lib/i18n/format";
import type { T } from "@/lib/i18n/messages";
import { pluralCategory } from "@/lib/i18n/plural";

// ------------------------------------------------------------------------------------------------ figures

/** One figure of a stat row (the props of `Stat`). */
export interface StatModel {
  key: string;
  value: string;
  unit?: string;
  prefix?: string;
  suffix?: string;
  label: string;
  accent?: boolean;
}

/**
 * Prefix, attached suffix or spaced unit around the value slot of a filled template: "{value} mil. Kč" gives the unit
 * "mil. Kč", "CZK {value}M" the prefix "CZK" and the suffix "M". The order of currency and amount stays a rule of the
 * dictionary (or of format.ts for plain money); the stat only styles the parts apart from the number.
 */
export function statAffixes(filled: string): Pick<StatModel, "prefix" | "suffix" | "unit"> {
  const i = filled.indexOf(VALUE_SLOT);
  if (i < 0) throw new Error(`statAffixes(): no value slot in "${filled}"`);
  const space = /[\s\u{a0}\u{202f}]/u;
  const trim = (s: string) => s.replace(/^[\s\u{a0}\u{202f}]+|[\s\u{a0}\u{202f}]+$/gu, "");
  const before = trim(filled.slice(0, i)), after = filled.slice(i + VALUE_SLOT.length);
  const out: Pick<StatModel, "prefix" | "suffix" | "unit"> = {};
  if (before) out.prefix = before;
  if (trim(after)) {
    if (space.test(after[0])) out.unit = trim(after);
    else out.suffix = trim(after);
  }
  return out;
}

/** The affixes of an amount of money in the current language, taken from format.ts itself ("1 234 Kč" / "CZK 1,234"). */
export function moneyAffixes(f: Formatter): Pick<StatModel, "prefix" | "suffix" | "unit"> {
  return statAffixes(f.money(1).replace("1", VALUE_SLOT));
}

/** An estimate of money for a stat: the amount rounded to three significant digits, the currency placed as format.ts places it. */
export function moneyEstimate(f: Formatter, v: number): Pick<StatModel, "value" | "prefix" | "suffix" | "unit"> {
  return { value: f.estimate(v), ...moneyAffixes(f) };
}

/** Running-text money estimate: "36 700 Kč" / "CZK 36,700". */
export const moneyText = (f: Formatter, v: number): string => f.money(roundSig(v));

/** A duration in years, one decimal, with the unit word that agrees with the number: "5 let", "16,3 roku", "1 year". */
export function years(t: T, f: Formatter, y: number): { value: string; unit: string } {
  const rounded = Math.round(y * 10) / 10;
  const word = { one: t("energy.units.yearOne"), few: t("energy.units.yearFew"), other: t("energy.units.yearMany") }[pluralCategory(t.locale, rounded)];
  return { value: f.num(rounded, 0, 1), unit: Number.isInteger(rounded) ? word : t("energy.units.yearFraction") };
}
const yearsText = (t: T, f: Formatter, y: number): string => {
  const v = years(t, f, y);
  return `${v.value}${NBSP}${v.unit}`;
};

/** kWp of a PV system: one decimal everywhere on the site (Home shows the same "15,5 kWp"). */
export const kwpText = (t: T, f: Formatter, kwp: number): string => f.unit(kwp, t("energy.units.kwp"), 1);

/** The four headline figures: design heat load, heat demand, electricity, PV yield (the one figure in mint). */
export function keyFigures(r: EnergyResult, t: T, f: Formatter): StatModel[] {
  const { designLoad, totals } = r;
  const specific = f.unit(totals.specificHeatNeed, t("energy.units.kwh"));
  const heatLabel = t.has("energy.figures.heatGross")
    ? t.dyn("energy.figures.heatGross", { specific, gross: f.unit(totals.specificHeatNeedGross, t("energy.units.kwh"), 0, 1) })
    : t("energy.figures.heat", { specific });
  return [
    { key: "load", value: f.num(designLoad.totalW / 1000, 1), unit: t("energy.units.kw"), label: t("energy.figures.designLoad", { temp: f.unit(designLoad.outdoorC, "°C") }) },
    { key: "heat", value: f.num(totals.heatNeedKwh / 1000, 1), unit: t("energy.units.mwh"), label: heatLabel },
    { key: "electricity", value: f.num(totals.elTotalKwh / 1000, 1), unit: t("energy.units.mwh"), label: t("energy.figures.electricity") },
    { key: "pv", value: f.num(totals.pvKwh / 1000, 1), unit: t("energy.units.mwh"), label: t("energy.figures.pv", { kwp: kwpText(t, f, totals.kwp) }), accent: true },
  ];
}

/** The battery's part of the payback label: years, "never pays back", or years beyond its life. */
function batteryPart(t: T, f: Formatter, b: PaybackPart): string {
  if (b.paybackYears === null || b.status === "never") return t("energy.money.batteryNever");
  if (b.status === "beyondLife") {
    return t.has("energy.money.batteryBeyondLifeYears")
      ? t.dyn("energy.money.batteryBeyondLifeYears", { years: yearsText(t, f, b.paybackYears), life: t("common.count.years", { count: b.lifeYears }) })
      : t("energy.money.batteryBeyondLife");
  }
  return yearsText(t, f, b.paybackYears);
}

/** Value and label of the payback figure for every status of the calculation. */
export function paybackFigure(r: EnergyResult, t: T, f: Formatter): Pick<StatModel, "value" | "unit" | "label"> {
  const e = r.economics;
  const withBattery = r.layout.kwp > 0 && e.battery.investment > 0;
  const status: PaybackStatus = e.status;
  if ((status === "ok" || status === "beyondLife") && e.paybackYears !== null) {
    const main = years(t, f, e.paybackYears);
    if (status === "beyondLife") return { ...main, label: t("energy.money.beyondLife", { life: t("common.count.years", { count: e.lifeYears }) }) };
    const label = withBattery
      ? t("energy.money.paybackSplit", { pv: e.pvOnly.paybackYears === null ? t("energy.money.batteryNever") : yearsText(t, f, e.pvOnly.paybackYears), battery: batteryPart(t, f, e.battery) })
      : t("energy.money.payback");
    return { ...main, label };
  }
  if (status === "never") return { value: EN_DASH, label: t("energy.money.never") };
  return { value: EN_DASH, label: t(e.investmentGross > 0 ? "energy.money.subsidyCovers" : "energy.money.none") };
}

/** The money row: saving, the net bill with panels, the investment, the payback. Amounts are estimates (three significant digits). */
export function moneyFigures(r: EnergyResult, t: T, f: Formatter): StatModel[] {
  const { economics: e, inputs, layout } = r;
  const withBattery = layout.kwp > 0 && e.battery.investment > 0;
  const subsidised = inputs.subsidy > 0;
  const investmentLabel = withBattery
    ? t(subsidised ? "energy.money.investmentBatterySubsidy" : "energy.money.investmentBattery")
    : t(subsidised ? "energy.money.investmentSubsidy" : "energy.money.investment");
  const without = moneyText(f, e.costWithoutPv);
  const costLabel = layout.kwp <= 0
    ? t("energy.money.costNoPv")
    : t(e.costWithPv < 0 ? "energy.money.costNegative" : "energy.money.cost", { without });
  return [
    { key: "savings", ...moneyEstimate(f, e.savings), label: t("energy.money.savings") },
    { key: "bill", ...moneyEstimate(f, e.costWithPv), label: costLabel },
    { key: "investment", ...moneyEstimate(f, e.investment), label: investmentLabel },
    { key: "payback", ...paybackFigure(r, t, f) },
  ];
}

// ------------------------------------------------------------------------------------------------ the bill

export interface BillRow {
  key: "buy" | "fixed" | "exportIncome" | "net";
  label: string;
  /** Whole crowns, signed as it adds up: the export income is negative. */
  amount: number;
  /** The amount without its sign (the sign is the row's operator); the total is written as its absolute value too. */
  text: string;
}

/**
 * The yearly bill with panels split into its parts, in whole crowns. The total is the sum of the rounded parts, so the column
 * adds up exactly; the label of the total says "income" when the surplus earns more than the purchases and charges cost.
 */
export function billRows(r: EnergyResult, t: T, f: Formatter): BillRow[] {
  const b = r.economics.bill;
  const buy = Math.round(b.buy), fixed = Math.round(b.fixed), income = -Math.round(b.exportIncome);
  const net = buy + fixed + income;
  const rows: BillRow[] = [
    { key: "buy", label: t("energy.bill.buy"), amount: buy, text: f.money(buy) },
    { key: "fixed", label: t("energy.bill.fixed"), amount: fixed, text: f.money(fixed) },
  ];
  // the minus is drawn in the operator column of the bill, so the amount itself is written without a sign
  if (income !== 0) rows.push({ key: "exportIncome", label: t("energy.bill.exportIncome"), amount: income, text: f.money(-income) });
  rows.push({ key: "net", label: t(net < 0 ? "energy.bill.netNegative" : "energy.bill.net"), amount: net, text: f.money(Math.abs(net)) });
  return rows;
}

// ------------------------------------------------------------------------------------------------ heat-loss table

export interface HeatLine {
  key: string;
  label: string;
  /** m2 and the area-weighted U, W/(m2 K); null for the ventilation row. */
  area: number | null;
  u: number | null;
  /** W/K and its share of the total heat transfer (transmission + ventilation), 0..1. */
  h: number;
  share: number;
}

export interface HeatGroup extends HeatLine {
  kind: EnvelopeKind | "ventilation";
  /** The rows by direction (walls, windows ...); empty when the kind has one row only. */
  parts: HeatLine[];
  /** The largest loss of the house (drawn in mint). */
  largest: boolean;
}

/**
 * The envelope rows grouped by kind (walls, windows, sliding walls, doors, ceiling or roof, floor, walls to unheated rooms,
 * thermal bridges) plus ventilation, sorted by loss, largest first. A kind with rows in several directions keeps them as `parts`.
 * Labels come from `energy.envelope.<kind>` and `energy.dir.<dir>`; nothing here knows a row by its id.
 */
export function heatGroups(r: EnergyResult, t: T, ventilationLabel: string): { groups: HeatGroup[]; total: number } {
  const total = r.envelope.hTransmission + r.ventilation.hV;
  const share = (h: number) => (total > 0 ? h / total : 0);
  const byKind = new Map<EnvelopeKind, EnergyResult["envelope"]["rows"]>();
  for (const row of r.envelope.rows) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  const groups: HeatGroup[] = [...byKind.entries()].map(([kind, rows]) => {
    const area = rows.reduce((s, x) => s + x.area, 0);
    const au = rows.reduce((s, x) => s + x.area * x.u, 0);
    const h = rows.reduce((s, x) => s + x.h, 0);
    const parts = rows.length > 1
      ? rows.map((x) => ({ key: x.key, label: x.dir ? t.dyn(`energy.dir.${x.dir}`) : t.dyn(`energy.envelope.${x.kind}`), area: x.area, u: x.u, h: x.h, share: share(x.h) })).sort((a, b) => b.h - a.h)
      : [];
    return { key: kind, kind, label: t.dyn(`energy.envelope.${kind}`), area, u: area > 0 ? au / area : 0, h, share: share(h), parts, largest: false };
  });
  if (r.ventilation.hV > 0) groups.push({ key: "ventilation", kind: "ventilation", label: ventilationLabel, area: null, u: null, h: r.ventilation.hV, share: share(r.ventilation.hV), parts: [], largest: false });
  groups.sort((a, b) => b.h - a.h);
  if (groups.length > 0 && groups[0].h > 0) groups[0].largest = true;
  return { groups, total };
}

// ------------------------------------------------------------------------------------------------ electricity by purpose

export interface ElectricityRow {
  /** Series key: the class `s-<key>` colours its bar like the monthly chart. */
  key: "heat" | "dhw" | "household" | "vent" | "pool" | "ev";
  label: string;
  kwh: number;
  share: number;
}

/** Electricity a year by purpose, in the order of the monthly chart's stack; rows without consumption are left out. */
export function electricityRows(r: EnergyResult, t: T, f: Formatter): ElectricityRow[] {
  const { totals } = r;
  const kwh = t("energy.units.kwh");
  const rows: Omit<ElectricityRow, "share">[] = [
    { key: "household", label: t("energy.tables.elHousehold"), kwh: totals.elApplianceKwh },
    { key: "vent", label: t("energy.tables.elVent"), kwh: totals.elVentKwh },
    { key: "heat", label: t("energy.tables.elHeat", { heat: f.unit(totals.heatNeedKwh, kwh) }), kwh: totals.elHeatKwh },
    { key: "dhw", label: t("energy.tables.elDhw", { heat: f.unit(totals.dhwHeatKwh, kwh) }), kwh: totals.elDhwKwh },
    { key: "pool", label: t("energy.tables.elPool"), kwh: totals.elPoolKwh },
    { key: "ev", label: t("energy.tables.elEv"), kwh: totals.elEvKwh },
  ];
  return rows.filter((x) => x.kwh > 0).map((x) => ({ ...x, share: totals.elTotalKwh > 0 ? x.kwh / totals.elTotalKwh : 0 }));
}
