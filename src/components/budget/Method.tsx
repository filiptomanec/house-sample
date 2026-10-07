"use client";

// A folded explanation of what the budget does, with the numbers of the price book (overhead share, VAT rates).
import type { Pricebook } from "@/lib/calc/budgetCore";
import { useFormat, useT } from "@/lib/i18n/client";

export function Method({ book }: { book: Pricebook }) {
  const t = useT();
  const f = useFormat();
  const oh = book.siteOverhead;
  const rates = Object.values(book.vat.classes).sort((a, b) => a - b).map((r) => f.percent(r * 100));
  return (
    <details className="grp budget-method">
      <summary><span>{t("budget.method.heading")}</span></summary>
      <div className="stack">
        <p className="small">{t("budget.method.quantities")}</p>
        <p className="small">{t("budget.method.prices")}</p>
        {oh && <p className="small">{t("budget.method.overhead", { percent: f.percent(oh.share * 100, 1), round: f.money(oh.roundTo) })}</p>}
        <p className="small">{t("budget.method.vat", { rates: f.list(rates) })}</p>
      </div>
    </details>
  );
}
