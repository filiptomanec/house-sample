"use client";

// The figure rows (heat and electricity; money with the bill split) and the notes that explain odd situations. The rows are
// live regions: a screen reader announces the new numbers after a change, politely and without interrupting. What the figures
// say is built in view.ts (tested); this file only lays them out.

import { Stat } from "@/components/ui/controls";
import type { EnergyResult } from "@/lib/calc/energy";
import { useFormat, useT } from "@/lib/i18n/client";
import { billRows, keyFigures, moneyFigures, type StatModel } from "./view";

const StatOf = ({ s }: { s: StatModel }) => <Stat value={s.value} unit={s.unit} prefix={s.prefix} suffix={s.suffix} label={s.label} accent={s.accent} />;

export function KeyFigures({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  return (
    <section className="stats-4 energy-figures" aria-label={t("energy.figures.label")} aria-live="polite">
      {keyFigures(result, t, f).map((s) => <StatOf key={s.key} s={s} />)}
    </section>
  );
}

/** Money: four figures and, beside them, the yearly bill with panels split into purchases, fixed charges and export income. */
export function MoneyFigures({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const rows = billRows(result, t, f);
  return (
    <section className="panel energy-money-card" aria-labelledby="money-title">
      <h2 className="sr-only" id="money-title">{t("energy.money.label")}</h2>
      <div className="energy-money" aria-live="polite">
        {moneyFigures(result, t, f).map((s) => <StatOf key={s.key} s={s} />)}
      </div>
      {result.layout.kwp > 0 && (
        <div className="bill">
          <h3 className="label">{t("energy.bill.title")}</h3>
          <dl className="bill-rows">
            {rows.map((r) => (
              <div key={r.key} className={`bill-row bill-${r.key}`} data-sign={r.key === "net" ? undefined : r.amount < 0 ? "minus" : "plus"}>
                <dt>{r.label}</dt>
                <dd className="num">{r.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
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
