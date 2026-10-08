// "How it is calculated" of the Budget page: quantities, prices, the site overhead, VAT, the rounding of the estimates and what
// the budget leaves out, with the numbers of the price book. A server component: the page renders it inside the shared
// MethodNote, so the side rail stays short and no client code is shipped for it.

import type { Pricebook } from "@/lib/calc/budgetCore";
import type { Formatter } from "@/lib/i18n/format";
import type { T } from "@/lib/i18n/messages";

export function BudgetMethod({ book, t, f }: { book: Pricebook; t: T; f: Formatter }) {
  const oh = book.siteOverhead;
  const rates = Object.values(book.vat.classes).sort((a, b) => a - b).map((r) => f.percent(r * 100));
  return (
    <>
      <p>{t("budget.method.quantities")}</p>
      <p>{t("budget.method.prices")}</p>
      {oh && <p>{t("budget.method.overhead", { percent: f.percent(oh.share * 100, 1), round: f.money(oh.roundTo) })}</p>}
      <p>{t("budget.method.vat", { rates: f.list(rates) })}</p>
      <p>{t("budget.method.estimate")}</p>
      <p className="note">{t("budget.note", { year: String(book.meta.priceYear) })}</p>
      {book.meta.status === "starter" && <p className="note">{t("budget.starter")}</p>}
    </>
  );
}
