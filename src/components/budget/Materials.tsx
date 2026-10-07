"use client";

// "How much material": three cards of the construction layers (volumes and areas from the model) and of the materials the
// budget orders with an allowance for offcuts.
import { Fragment, useMemo } from "react";
import type { BudgetResult } from "@/lib/calc/budgetCompute";
import { materialTakeoff, type Pricebook, type Quantities } from "@/lib/calc/budgetCore";
import { NBSP, nb } from "@/lib/i18n/format";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { house } from "@/lib/model/instance";
import { materialCards, type CardKey } from "./materialCards";

const CARDS: readonly CardKey[] = ["masonry", "insulation", "finishes"];

export function Materials({ quantities, result, book }: { quantities: Quantities; result: BudgetResult; book: Pricebook }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const rows = useMemo(() => materialTakeoff(house, quantities), [quantities]);
  const cards = useMemo(() => materialCards(rows, result, book), [rows, result, book]);
  return (
    <section className="section-sm budget-materials" aria-labelledby="budget-materials-h">
      <h2 id="budget-materials-h" className="h2">{t("budget.materials.heading")}</h2>
      <p className="small">{t("budget.materials.lede")}</p>
      <div className="budget-cards">
        {CARDS.map((key) => (
          <div className="panel panel-pad" key={key}>
            <h3 className="label">{t(`budget.materials.${key}`)}</h3>
            <dl className="kv">
              {cards[key].map((item) => (
                <Fragment key={item.key}>
                  <dt>
                    {nb(item.name[locale], locale)}
                    {item.waste !== null && <small className="waste"> {t("budget.materials.waste", { percent: f.percent(item.waste * 100) })}</small>}
                  </dt>
                  <dd>{f.num(item.value, 0, item.value < 10 ? 1 : 0)}{NBSP}{t.dyn(`budget.units.${item.unit}`)}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
