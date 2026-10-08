"use client";

// The two rows of big numbers (heat and electricity; money) and the notes that explain odd situations. Both rows are live
// regions: a screen reader announces the new numbers after a change, politely and without interrupting.

import { Stat } from "@/components/ui/controls";
import type { EnergyResult } from "@/lib/calc/energy";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { NBSP } from "@/lib/i18n/format";
import { pluralCategory } from "@/lib/i18n/plural";

export function KeyFigures({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const { designLoad, totals } = result;
  return (
    <section className="stats-4 energy-figures" aria-label={t("energy.figures.label")} aria-live="polite">
      <Stat value={f.num(designLoad.totalW / 1000, 1)} unit={t("energy.units.kw")} label={t("energy.figures.designLoad", { temp: f.unit(designLoad.outdoorC, "°C") })} />
      <Stat value={f.num(totals.heatNeedKwh / 1000, 1)} unit={t("energy.units.mwh")} label={t("energy.figures.heat", { specific: f.unit(totals.specificHeatNeed, t("energy.units.kwh")) })} />
      <Stat value={f.num(totals.elTotalKwh / 1000, 1)} unit={t("energy.units.mwh")} label={t("energy.figures.electricity")} />
      <Stat accent value={f.num(totals.pvKwh / 1000, 1)} unit={t("energy.units.mwh")} label={t("energy.figures.pv", { kwp: f.unit(totals.kwp, t("energy.units.kwp"), 2) })} />
    </section>
  );
}

/** A duration in years with the unit word that agrees with the number: "5 let", "14,4 roku", "1 year". */
function useYears() {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  return (years: number): { value: string; unit: string } => {
    const rounded = Math.round(years * 10) / 10;
    const word = { one: t("energy.units.yearOne"), few: t("energy.units.yearFew"), other: t("energy.units.yearMany") }[pluralCategory(locale, rounded)];
    return { value: f.num(rounded, 0, 1), unit: Number.isInteger(rounded) ? word : t("energy.units.yearFraction") };
  };
}

export function MoneyFigures({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const years = useYears();
  const { economics: e, inputs, layout } = result;
  const currency = t("energy.units.currency");
  const withBattery = layout.kwp > 0 && e.battery.investment > 0;
  const subsidised = inputs.subsidy > 0;

  const investmentLabel = withBattery
    ? t(subsidised ? "energy.money.investmentBatterySubsidy" : "energy.money.investmentBattery")
    : t(subsidised ? "energy.money.investmentSubsidy" : "energy.money.investment");

  let payback: string | null = null;
  let paybackUnit: string | undefined;
  let paybackLabel = t("energy.money.payback");
  if (e.status === "ok" && e.paybackYears !== null) {
    const main = years(e.paybackYears);
    payback = main.value;
    paybackUnit = main.unit;
    if (withBattery) {
      const text = (v: number | null) => {
        if (v === null) return t("energy.money.batteryNever");
        const y = years(v);
        return `${y.value}${NBSP}${y.unit}`;
      };
      paybackLabel = t("energy.money.paybackSplit", { pv: text(e.pvOnly.paybackYears), battery: text(e.battery.paybackYears) });
    }
  } else if (e.status === "never") {
    paybackLabel = t("energy.money.never");
  } else if (e.investmentGross > 0) {
    paybackLabel = t("energy.money.subsidyCovers");
  } else {
    paybackLabel = t("energy.money.none");
  }

  const costLabel = layout.kwp <= 0
    ? t("energy.money.costNoPv")
    : t(e.costWithPv < 0 ? "energy.money.costNegative" : "energy.money.cost", { without: f.unit(e.costWithoutPv, currency) });

  return (
    <section className="stats-4 energy-money" aria-label={t("energy.money.label")} aria-live="polite">
      <Stat accent value={f.num(e.savings)} unit={currency} label={t("energy.money.savings")} />
      <Stat value={f.num(e.costWithPv)} unit={currency} label={costLabel} />
      <Stat value={f.num(e.investment)} unit={currency} label={investmentLabel} />
      <Stat value={payback ?? "–"} unit={paybackUnit} label={paybackLabel} />
    </section>
  );
}

/** Notes for the situations the calculation flags (climate data off, panels do not fit, heat pump too small ...). */
export function Warnings({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const text = (key: EnergyResult["warnings"][number]["key"], value?: number): string => {
    switch (key) {
      case "panelsClamped": return t("energy.warning.panelsClamped", { count: f.int(value ?? 0) });
      case "heatPumpUndersized": return t("energy.warning.heatPumpUndersized", { share: f.percent((value ?? 0) * 100) });
      case "climateMismatch": return t("energy.warning.climateMismatch");
      case "noPlanesEnabled": return t("energy.warning.noPlanesEnabled");
      case "batteryWithoutPv": return t("energy.warning.batteryWithoutPv");
      case "inputsClamped": return t("energy.warning.inputsClamped");
    }
  };
  // the live region is always in the page (empty when there is nothing to say), so a note that appears later is announced
  return (
    <div className="energy-notes" aria-live="polite">
      {result.warnings.length > 0 && (
        <ul className="energy-warnings">
          {result.warnings.map((w) => <li key={w.key}>{text(w.key, w.value)}</li>)}
        </ul>
      )}
    </div>
  );
}
