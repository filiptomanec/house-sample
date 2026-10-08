"use client";

// One price group as a disclosure: the summary holds the kind ("always included" / optional), the name and the sum; inside are
// the switch of an optional group (aligned under the sum), the table of the lines the model uses and, closed at the end, the
// lines the model does not use (still editable: entering a quantity moves a line up once the field is left).
//
// Desktop: a table with the two editable numbers on every line. Phones (budget.css): every line takes two rows, the name with the
// amount and a tappable "405 m² × 130 Kč/m²"; the two fields appear inline only for the line being edited.

import { useId, useState, type FocusEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Switch } from "@/components/ui/controls";
import type { BudgetGroup, BudgetLine } from "@/lib/calc/budgetCompute";
import type { PriceGroup, UnitKey } from "@/lib/calc/budgetCore";
import type { LocalizedText } from "@/lib/model/types";
import { NBSP, nb } from "@/lib/i18n/format";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { CellInput } from "./CellInput";
import { isUnused, quantityDigits, splitLines } from "./view";

/** Arrow-key step of a quantity, and of a price: about one hundredth of its size. */
const quantityStep = (unit: UnitKey): number => (quantityDigits(unit) === 0 ? 1 : 0.1);
const priceStep = (v: number): number => 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 2);

type Edit = (line: BudgetLine, field: "quantity" | "price", value: number | null) => void;

function LinesTable({ lines, names, overheadName, groupName, editing, onEditing, onEdit, idBase }: {
  lines: readonly BudgetLine[];
  names: ReadonlyMap<string, PriceGroup["lines"][number]>;
  overheadName?: LocalizedText;
  groupName: string;
  editing: string | null;
  onEditing: (line: BudgetLine | null) => void;
  onEdit: Edit;
  idBase: string;
}) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const unit = (u: UnitKey) => t.dyn(`budget.units.${u}`);
  const leave = (e: FocusEvent<HTMLTableRowElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onEditing(null);
  };
  return (
    <div className="table-wrap">
      <table className="data budget-table">
        <thead>
          <tr>
            <th scope="col">{t("budget.table.item")}</th>
            <th scope="col" className="n">{t("budget.table.quantity")}</th>
            <th scope="col" className="n">{t("budget.table.price")}</th>
            <th scope="col" className="n">{t("budget.table.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const d = names.get(l.id);
            const item = d?.name[locale] ?? (l.overhead ? overheadName?.[locale] : undefined) ?? groupName;
            const cellName = (key: "budget.table.quantityLabel" | "budget.table.priceLabel", edited: boolean) =>
              t(key, { item }) + (edited ? `, ${t("budget.table.edited")}` : "");
            const digits = quantityDigits(l.unit);
            const nameId = `${idBase}-${l.id}`;
            const isEditing = editing === l.id;
            const open = (e: MouseEvent<HTMLButtonElement>) => {
              const row = e.currentTarget.closest("tr");
              flushSync(() => onEditing(l));
              row?.querySelector<HTMLInputElement>("input.cell-in")?.focus();
            };
            return (
              <tr key={l.id} data-editing={isEditing ? "" : undefined} onFocus={(e) => { if ((e.target as HTMLElement).matches("input")) onEditing(l); }} onBlur={leave}>
                <td className="name" id={nameId}>
                  {nb(item, locale)}
                  {d?.note && <span className="line-note">{nb(d.note[locale], locale)}</span>}
                  <button type="button" className="qp" aria-expanded={isEditing} aria-describedby={nameId} onClick={open}
                    data-edited={l.quantityEdited || l.priceEdited ? "" : undefined}>
                    <span className="num">{f.num(l.quantity, 0, digits)}{NBSP}{unit(l.unit)}</span>
                    <span className="x" aria-hidden>×</span>
                    <span className="num">{f.money(l.price)}/{unit(l.unit)}</span>
                  </button>
                </td>
                <td className="n q">
                  <CellInput value={l.quantity} edited={l.quantityEdited} digits={digits} step={quantityStep(l.unit)}
                    label={cellName("budget.table.quantityLabel", l.quantityEdited)}
                    resetLabel={t("budget.table.reset", { value: f.num(l.defaultQuantity, 0, digits), item })}
                    onCommit={(v) => onEdit(l, "quantity", v)} onReset={() => onEdit(l, "quantity", null)} />
                  <span className="unit">{unit(l.unit)}</span>
                </td>
                <td className="n p">
                  <CellInput value={l.price} edited={l.priceEdited} digits={0} step={priceStep(l.defaultPrice)}
                    label={cellName("budget.table.priceLabel", l.priceEdited)}
                    resetLabel={t("budget.table.reset", { value: f.num(l.defaultPrice, 0, 0), item })}
                    onCommit={(v) => onEdit(l, "price", v)} onReset={() => onEdit(l, "price", null)} />
                  <span className="unit">{t("budget.currency")}/{unit(l.unit)}</span>
                </td>
                <td className="n tot">{f.money(l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function GroupPanel({ group, def, overheadName, open, onToggle, onEdit }: {
  group: BudgetGroup;
  def: PriceGroup;
  /** Name of the computed site-overhead line (it is not one of the group's own lines), when the group holds it. */
  overheadName?: LocalizedText;
  /** Open in the server HTML (the first group); the others open on wide screens after mount (BudgetTool). */
  open?: boolean;
  onToggle: (on: boolean) => void;
  onEdit: Edit;
}) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const headId = useId();
  const idBase = useId();
  const [editing, setEditing] = useState<{ id: string; unused: boolean } | null>(null);
  const names = new Map(def.lines.map((l) => [l.id, l]));
  const name = nb(def.name[locale], locale);
  const { used, unused } = splitLines(group, editing);
  const onEditing = (l: BudgetLine | null) => setEditing((cur) => (l === null ? null : cur?.id === l.id ? cur : { id: l.id, unused: isUnused(l) }));
  const tableProps = { names, overheadName, groupName: def.name[locale], editing: editing?.id ?? null, onEditing, onEdit, idBase };

  return (
    <section className={`panel budget-group${group.on ? "" : " is-off"}`} aria-labelledby={headId}>
      <details className="bg-details" open={open || undefined} data-wide-open={open ? undefined : ""}>
        {/* a summary holds phrasing content and one heading, so the parts are its direct children (placed by a CSS grid) */}
        <summary className="bg-head">
          <span className="label bg-kind">{t(group.optional ? "budget.groups.optional" : "budget.groups.required")}</span>
          <h3 id={headId} className="bg-name">{name}</h3>
          <span className="bg-sum">
            <b className="num">{f.money(group.subtotal)}</b>
            <small>{t("budget.groups.subtotal")}</small>
          </span>
          <i className="bg-chev" aria-hidden />
        </summary>
        <div className="bg-body">
          {(group.optional || def.note) && (
            <div className="bg-meta">
              {def.note ? <p className="note">{nb(def.note[locale], locale)}</p> : <span />}
              {group.optional && (
                <div className="bg-switch">
                  <Switch label={<><span className="sr-only">{name}: </span>{t("budget.groups.include")}</>} checked={group.on} onChange={onToggle} />
                </div>
              )}
            </div>
          )}
          {group.on ? (
            <>
              {used.length > 0 && <LinesTable lines={used} {...tableProps} />}
              {unused.length > 0 && (
                <details className="bg-unused">
                  <summary>
                    <span>{t("budget.groups.unused")}</span>
                    <span className="bg-count num">{f.int(unused.length)}</span>
                  </summary>
                  <p className="note">{t("budget.groups.unusedHint")}</p>
                  <LinesTable lines={unused} {...tableProps} />
                </details>
              )}
            </>
          ) : (
            <p className="small bg-off">{t("budget.groups.off", { amount: f.money(group.subtotal) })}</p>
          )}
        </div>
      </details>
    </section>
  );
}
