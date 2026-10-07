// The three "how much material" cards, built from the model's own constructions (material take-off) and from the budget lines
// that carry an allowance for offcuts. Pure; no text of its own (names come from the model and the price book).
import type { LocalizedText } from "@/lib/model/types";
import type { BudgetResult } from "@/lib/calc/budgetCompute";
import type { MaterialRow, Pricebook, UnitKey } from "@/lib/calc/budgetCore";

export type CardKey = "masonry" | "insulation" | "finishes";

export interface MaterialItem {
  key: string;
  name: LocalizedText;
  value: number;
  unit: UnitKey;
  /** Allowance for offcuts that is already in `value`, or null. */
  waste: number | null;
}

export type MaterialCards = Record<CardKey, MaterialItem[]>;

/** A layer thinner than this is a sheet, listed by area; a thicker one is a body, listed by volume (m). */
export const SHEET_MAX_THICKNESS = 0.03;

/** The card of a layer: by the assembly (the whole roof is one card) and by the role of the layer; null = not listed. */
export function cardOf(row: Pick<MaterialRow, "assembly" | "role">): CardKey | null {
  if (row.assembly === "roof") return row.role === "air" || row.role === "finish" ? null : "insulation";
  switch (row.role) {
    case "structure":
      return "masonry";
    case "insulation":
    case "membrane":
    case "cladding":
      return "insulation";
    case "screed":
      return "finishes";
    default:
      return null; // finishes of walls and floors are listed from the budget lines, which know their offcuts
  }
}

/** Rows of the take-off and the material lines of the budget (those with a `waste` in the price book) arranged into cards. */
export function materialCards(rows: readonly MaterialRow[], result: BudgetResult, book: Pricebook): MaterialCards {
  const cards: MaterialCards = { masonry: [], insulation: [], finishes: [] };
  for (const r of rows) {
    const card = cardOf(r);
    if (!card || !(r.volume > 0)) continue;
    const sheet = r.thickness < SHEET_MAX_THICKNESS;
    cards[card].push({ key: `${r.assembly}/${r.layerId}`, name: r.name, value: sheet ? r.area : r.volume, unit: sheet ? "m2" : "m3", waste: null });
  }
  const lines = new Map(book.groups.flatMap((g) => g.lines.map((l) => [l.id, l] as const)));
  for (const g of result.groups) {
    if (!g.on) continue;
    for (const l of g.lines) {
      const def = lines.get(l.id);
      if (l.waste === null || !def || !(l.quantity > 0)) continue;
      cards.finishes.push({ key: l.id, name: def.name, value: l.quantity * (1 + l.waste), unit: l.unit, waste: l.waste > 0 ? l.waste : null });
    }
  }
  return cards;
}
