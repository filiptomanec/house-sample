"use client";

// The side rail: the contingency slider, the breakdown from the house to the total (the total is the rail's hero figure), the
// CSV download and the reset. Short on purpose: the notes about prices and the method live in the page's MethodNote. When the
// rail is taller than the window it scrolls on its own and fades its lower edge (useRailMask).

import { Fragment, useRef } from "react";
import { Slider } from "@/components/ui/controls";
import { toCsv, type BudgetResult } from "@/lib/calc/budgetCompute";
import type { Pricebook, UnitKey } from "@/lib/calc/budgetCore";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { useRailMask } from "@/components/energy/disclosure";
import { downloadText } from "./download";

export function SidePanel({ result, book, reserve, isDefault, pvFromEnergy, onReserve, onReset }: {
  result: BudgetResult;
  book: Pricebook;
  reserve: number;
  isDefault: boolean;
  pvFromEnergy: boolean;
  onReserve: (share: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const rail = useRef<HTMLElement>(null);
  useRailMask(rail);
  const { min, max, step } = book.reserve;

  const overheadLine = result.groups.flatMap((g) => g.lines).find((l) => l.overhead);
  const vatRows = Object.entries(result.vatByClass).filter(([, v]) => v > 0);
  const vatLabel = (cls: string) => {
    const rate = f.percent(book.vat.classes[cls] * 100);
    // the default class is "the rest"; another class names the groups it applies to
    if (cls === book.vat.default) return t("budget.side.vat", { rate });
    const groups = book.groups.filter((g) => g.vat === cls && result.groups.find((x) => x.id === g.id)?.on).map((g) => g.name[locale].toLocaleLowerCase(locale));
    return groups.length ? t("budget.side.vatFor", { rate, groups: f.list(groups) }) : t("budget.side.vat", { rate });
  };

  const exportCsv = () => {
    const text = toCsv(result, book, {
      locale,
      unitLabel: (u: UnitKey) => t.dyn(`budget.units.${u}`),
      labels: {
        group: t("budget.csv.group"), item: t("budget.csv.item"), quantity: t("budget.csv.quantity"), unit: t("budget.csv.unit"),
        unitPrice: t("budget.csv.unitPrice"), amount: t("budget.csv.amount"), net: t("budget.csv.net"),
        reserve: (percent) => t("budget.csv.reserve", { percent: f.percent(percent, Number.isInteger(percent) ? 0 : 1) }), vat: t("budget.csv.vat"), total: t("budget.csv.total"),
      },
    });
    downloadText(text, t("budget.csv.file"), "text/csv;charset=utf-8");
  };

  return (
    <aside className="panel panel-pad budget-side" id="budget-side" aria-labelledby="budget-side-h" ref={rail}>
      <h2 id="budget-side-h" className="label">{t("budget.side.heading")}</h2>
      <Slider label={t("budget.side.reserve")} value={Math.round(reserve * 100)} min={Math.round(min * 100)} max={Math.round(max * 100)}
        step={Math.max(1, Math.round(step * 100))} format={(v) => f.percent(v)} hint={t("budget.side.reserveHint")} onChange={(v) => onReserve(v / 100)} />

      <dl className="kv budget-kv">
        <dt>{t("budget.side.house")}</dt>
        <dd>{f.money(result.core)}</dd>
        {overheadLine && book.siteOverhead && (
          <>
            <dt className="sub">{t("budget.side.overhead", { percent: f.percent(book.siteOverhead.share * 100, 1) })}</dt>
            <dd className="sub">{f.money(overheadLine.amount)}</dd>
          </>
        )}
        <dt>{t("budget.side.extras")}</dt>
        <dd>{f.money(result.extras)}</dd>
        <dt>{t("budget.side.reserveRow", { percent: f.percent(result.reserveShare * 100) })}</dt>
        <dd>{f.money(result.reserve)}</dd>
        {vatRows.map(([cls, v]) => (
          <Fragment key={cls}>
            <dt>{vatLabel(cls)}</dt>
            <dd>{f.money(v)}</dd>
          </Fragment>
        ))}
        <dt className="sum">{t("budget.side.total")}</dt>
        <dd className="sum"><output>{f.money(result.total)}</output></dd>
      </dl>

      <div className="budget-actions">
        <button type="button" className="btn" onClick={exportCsv}>{t("budget.side.csv")}</button>
        <button type="button" className="btn ghost sm" onClick={onReset} disabled={isDefault}>{t("budget.side.reset")}</button>
      </div>
      {pvFromEnergy && <p className="note">{t("budget.pv")}</p>}
    </aside>
  );
}
