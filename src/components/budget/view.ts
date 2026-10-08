// What the Budget page shows, as plain data: the headline figures, the band, the split of a group's lines into the ones the
// model uses and the unused ones. Pure, so the unit tests can check that the figures are the calculation's own numbers rounded
// as the method says (three significant digits) and that the order of currency and amount comes from the dictionary.

import type { BudgetGroup, BudgetLine, BudgetResult } from "@/lib/calc/budgetCompute";
import type { UnitKey } from "@/lib/calc/budgetCore";
import { VALUE_SLOT, type Formatter } from "@/lib/i18n/format";
import type { T } from "@/lib/i18n/messages";
import { statAffixes, type StatModel } from "@/components/energy/view";

export const MILLION = 1e6;

/** Millions as an estimate in running text: "15,2 mil. Kč" / "CZK 15.2M" (budget.money.million). */
export const millionText = (t: T, f: Formatter, v: number): string => t("budget.money.million", { value: f.estimate(v / MILLION) });

/** A stat in millions: the estimate and the affixes of budget.money.million. */
export function millionStat(t: T, f: Formatter, v: number): Pick<StatModel, "value" | "prefix" | "suffix" | "unit"> {
  return { value: f.estimate(v / MILLION), ...statAffixes(t("budget.money.million", { value: VALUE_SLOT })) };
}

/** The three headline figures: the total (the one figure in mint), the house alone, the house per m² of floor area. */
export function summaryFigures(r: BudgetResult, t: T, f: Formatter): StatModel[] {
  const perM2 = r.perM2 === null
    ? { value: f.num(Number.NaN) }
    : { value: f.estimate(r.perM2), ...statAffixes(t("budget.money.perM2", { value: VALUE_SLOT })) };
  return [
    { key: "total", ...millionStat(t, f, r.total), label: t("budget.summary.total"), accent: true },
    { key: "house", ...millionStat(t, f, r.coreWithVat), label: t("budget.summary.house") },
    { key: "perM2", ...perM2, label: t("budget.summary.perM2", { area: f.area(r.floorArea) }) },
  ];
}

/** A line the model does not use: a zero model quantity that the visitor has not set (it is listed apart, still editable). */
export const isUnused = (l: BudgetLine): boolean => l.defaultQuantity <= 0 && !l.quantityEdited && !l.overhead;

/**
 * The lines of a group in two lists: the ones the model uses, and the unused ones (collected at the end of the group). A line
 * the visitor is editing (`keep`) stays in the list it was in, so typing a quantity does not move the field away mid-word.
 */
export function splitLines(group: BudgetGroup, keep: { id: string; unused: boolean } | null): { used: BudgetLine[]; unused: BudgetLine[] } {
  const used: BudgetLine[] = [], unused: BudgetLine[] = [];
  for (const l of group.lines) {
    const out = keep && keep.id === l.id ? keep.unused : isUnused(l);
    (out ? unused : used).push(l);
  }
  return { used, unused };
}

/** Whole numbers for pieces and sets, one decimal for lengths, areas, volumes and powers. */
export const quantityDigits = (unit: UnitKey): number => (unit === "pcs" || unit === "set" ? 0 : 1);
