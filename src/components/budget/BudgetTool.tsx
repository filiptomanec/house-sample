"use client";

// The Budget page: headline numbers, the reserve and breakdown, the price groups with editable lines, the material cards.
import type { Quantities } from "@/lib/calc/budgetCore";
import { useT } from "@/lib/i18n/client";
import { GroupPanel } from "./GroupPanel";
import { Materials } from "./Materials";
import { Method } from "./Method";
import { SidePanel } from "./SidePanel";
import { Summary } from "./Summary";
import { useBudget } from "./useBudget";

/** `base`: quantities of the model (see `deriveQuantities`), computed by the page on the server. */
export default function BudgetTool({ base }: { base: Quantities }) {
  const t = useT();
  const { book, quantities, settings, result, pvFromEnergy, isDefault, setReserve, toggleGroup, edit, reset } = useBudget(base);
  const defs = new Map(book.groups.map((g) => [g.id, g]));
  return (
    <div className="shell budget">
      <Summary result={result} book={book} />
      <div className="budget-grid">
        <SidePanel result={result} book={book} reserve={settings.reserve} isDefault={isDefault} pvFromEnergy={pvFromEnergy} onReserve={setReserve} onReset={reset} />
        <section className="budget-groups" aria-labelledby="budget-groups-h">
          <h2 id="budget-groups-h" className="sr-only">{t("budget.groups.heading")}</h2>
          {result.groups.map((g) => {
            const def = defs.get(g.id);
            return def ? <GroupPanel key={g.id} group={g} def={def} onToggle={(on) => toggleGroup(g.id, on)} onEdit={edit} /> : null;
          })}
        </section>
      </div>
      <Materials quantities={quantities} result={result} book={book} />
      <Method book={book} />
    </div>
  );
}
