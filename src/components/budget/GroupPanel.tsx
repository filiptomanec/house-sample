"use client";

// One price group: its name and sum, the switch of an optional group, and the table of its lines with editable quantity and
// unit price. On a phone the table becomes a stack of cards (budget.css) and the labels come from `data-label`.
import { useId } from "react";
import { Switch } from "@/components/ui/controls";
import type { BudgetGroup, BudgetLine } from "@/lib/calc/budgetCompute";
import type { PriceGroup, UnitKey } from "@/lib/calc/budgetCore";
import type { LocalizedText } from "@/lib/model/types";
import { nb } from "@/lib/i18n/format";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { CellInput } from "./CellInput";

/** Whole numbers for pieces and sets, one decimal for lengths, areas, volumes and powers. */
const quantityDigits = (unit: UnitKey): number => (unit === "pcs" || unit === "set" ? 0 : 1);
/** Arrow-key step of a quantity, and of a price: about one hundredth of its size. */
const quantityStep = (unit: UnitKey): number => (quantityDigits(unit) === 0 ? 1 : 0.1);
const priceStep = (v: number): number => 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 2);

export function GroupPanel({ group, def, overheadName, onToggle, onEdit }: {
  group: BudgetGroup;
  def: PriceGroup;
  /** Name of the computed site-overhead line (it is not one of the group's own lines), when the group holds it. */
  overheadName?: LocalizedText;
  onToggle: (on: boolean) => void;
  onEdit: (line: BudgetLine, field: "quantity" | "price", value: number | null) => void;
}) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const headId = useId();
  const names = new Map(def.lines.map((l) => [l.id, l]));
  const name = nb(def.name[locale], locale);
  const unit = (u: UnitKey) => t.dyn(`budget.units.${u}`);

  return (
    <section className={`panel budget-group${group.on ? "" : " is-off"}`} aria-labelledby={headId}>
      <header className="bg-head">
        <div className="bg-title">
          <p className="label">{t(group.optional ? "budget.groups.optional" : "budget.groups.required")}</p>
          <h3 id={headId} className="bg-name">{name}</h3>
          {def.note && <p className="note">{nb(def.note[locale], locale)}</p>}
        </div>
        <p className="bg-sum">
          <b className="num">{f.money(group.subtotal)}</b>
          <small>{t("budget.groups.subtotal")}</small>
        </p>
        {group.optional && (
          <div className="bg-switch">
            <Switch label={<><span className="sr-only">{name}: </span>{t("budget.groups.include")}</>} checked={group.on} onChange={onToggle} />
          </div>
        )}
      </header>

      {group.on ? (
        <div className="table-wrap">
          <table className="data budget-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">{t("budget.table.item")}</th>
                <th scope="col" role="columnheader" className="n">{t("budget.table.quantity")}</th>
                <th scope="col" role="columnheader" className="n">{t("budget.table.price")}</th>
                <th scope="col" role="columnheader" className="n">{t("budget.table.amount")}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {group.lines.map((l) => {
                const d = names.get(l.id);
                const item = d?.name[locale] ?? (l.overhead ? overheadName?.[locale] : undefined) ?? def.name[locale];
                const cellName = (key: "budget.table.quantityLabel" | "budget.table.priceLabel", edited: boolean) =>
                  t(key, { item }) + (edited ? `, ${t("budget.table.edited")}` : "");
                return (
                  <tr key={l.id} role="row">
                    <td className="name" role="cell">
                      {nb(item, locale)}
                      {d?.note && <span className="line-note">{nb(d.note[locale], locale)}</span>}
                    </td>
                    <td className="n q" role="cell" data-label={t("budget.table.quantity")}>
                      <CellInput value={l.quantity} edited={l.quantityEdited} digits={quantityDigits(l.unit)} step={quantityStep(l.unit)}
                        label={cellName("budget.table.quantityLabel", l.quantityEdited)}
                        resetLabel={t("budget.table.reset", { value: f.num(l.defaultQuantity, 0, quantityDigits(l.unit)), item })}
                        onCommit={(v) => onEdit(l, "quantity", v)} onReset={() => onEdit(l, "quantity", null)} />
                      <span className="unit">{unit(l.unit)}</span>
                    </td>
                    <td className="n p" role="cell" data-label={t("budget.table.priceShort")}>
                      <CellInput value={l.price} edited={l.priceEdited} digits={0} step={priceStep(l.defaultPrice)}
                        label={cellName("budget.table.priceLabel", l.priceEdited)}
                        resetLabel={t("budget.table.reset", { value: f.num(l.defaultPrice, 0, 0), item })}
                        onCommit={(v) => onEdit(l, "price", v)} onReset={() => onEdit(l, "price", null)} />
                      <span className="unit">{t("budget.currency")}/{unit(l.unit)}</span>
                    </td>
                    <td className="n tot" role="cell" data-label={t("budget.table.amount")}>{f.money(l.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small bg-off">{t("budget.groups.off", { amount: f.money(group.subtotal) })}</p>
      )}
    </section>
  );
}
