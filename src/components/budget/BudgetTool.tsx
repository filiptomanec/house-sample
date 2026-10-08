"use client";

// The instrument of the Budget page: the headline figures with the band, the price groups beside the contingency and totals
// rail, and the material cards. Up to 1180 px the rail follows the groups (a receipt reads top to bottom) and a phone gets a
// docked total. The groups are disclosures: the first is open in the server HTML, the others open on wider screens after mount
// (a phone keeps them closed, which keeps the page short). The method note and the next page are server parts of the page.

import { useRef } from "react";
import type { Quantities } from "@/lib/calc/budgetCore";
import { useT } from "@/lib/i18n/client";
import { MQ } from "@/styles/breakpoints";
import { useOpenWhenWide } from "@/components/energy/disclosure";
import { GroupPanel } from "./GroupPanel";
import { Materials } from "./Materials";
import { SidePanel } from "./SidePanel";
import { Summary } from "./Summary";
import { TotalDock } from "./TotalDock";
import { useBudget } from "./useBudget";

const STATS_ID = "budget-summary";
const SIDE_ID = "budget-side";

/** `base`: quantities of the model (see `deriveQuantities`), computed by the page on the server. */
export default function BudgetTool({ base }: { base: Quantities }) {
  const t = useT();
  const { book, quantities, settings, result, pvFromEnergy, isDefault, setReserve, toggleGroup, edit, reset } = useBudget(base);
  const groupsRef = useRef<HTMLElement>(null);
  useOpenWhenWide(groupsRef, MQ.minSm);
  const defs = new Map(book.groups.map((g) => [g.id, g]));
  return (
    <div className="shell budget">
      <div id={STATS_ID}>
        <Summary result={result} book={book} />
      </div>
      <div className="budget-grid">
        <SidePanel result={result} book={book} reserve={settings.reserve} isDefault={isDefault} pvFromEnergy={pvFromEnergy} onReserve={setReserve} onReset={reset} />
        <section className="budget-groups" aria-labelledby="budget-groups-h" ref={groupsRef}>
          <h2 id="budget-groups-h" className="sr-only">{t("budget.groups.heading")}</h2>
          {result.groups.map((g, i) => {
            const def = defs.get(g.id);
            return def ? (
              <GroupPanel key={g.id} group={g} def={def} open={i === 0} overheadName={book.siteOverhead?.groupId === g.id ? book.siteOverhead.name : undefined}
                onToggle={(on) => toggleGroup(g.id, on)} onEdit={edit} />
            ) : null;
          })}
        </section>
      </div>
      <Materials quantities={quantities} result={result} book={book} />
      <TotalDock total={result.total} statsId={STATS_ID} sideId={SIDE_ID} />
    </div>
  );
}
