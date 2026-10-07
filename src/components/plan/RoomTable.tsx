"use client";
import { useFormat, useT } from "@/lib/i18n/client";
import type { PlanView } from "@/lib/plan/view";

/** Table of the rooms: number, name, net area, floor, window area and the total. Rows select the room in the plan. */
export function RoomTable({ view, current, onPick }: { view: PlanView; current: string | null; onPick: (id: string) => void }) {
  const t = useT(), f = useFormat(), { totals } = view;
  return (
    <section className="section-sm pl-section" aria-labelledby="plan-rooms">
      <h2 className="h2" id="plan-rooms">{t("plan.table.title")}</h2>
      <div className="table-wrap">
        <table className="data room-table">
          <thead>
            <tr>
              <th scope="col">{t("plan.table.number")}</th><th scope="col">{t("plan.table.name")}</th>
              <th scope="col" className="n">{t("plan.table.area")}</th><th scope="col">{t("plan.table.floor")}</th>
              <th scope="col" className="n">{t("plan.table.windows")} <span className="u">m²</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rooms.map((r) => (
              <tr key={r.id} aria-current={r.id === current ? "true" : undefined} onClick={() => onPick(r.id)}>
                <td className="mono accent">{r.number}</td>
                <td><button type="button" className="row-btn">{r.name}</button></td>
                <td className="n">{f.num(r.area, 2)}</td>
                <td>{r.floorName ?? "–"}</td>
                <td className="n">{r.glazing > 0 ? f.num(r.glazing, 1) : "–"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td /><td>{t("plan.table.total")}</td><td className="n">{f.num(totals.floorArea, 1)}</td><td /><td className="n">{f.num(totals.glazing, 1)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p className="note pl-note">{t("plan.table.note", { footprint: f.area(totals.footprint, 1), height: f.length(totals.clearHeight, 2), doors: totals.interiorDoors })}</p>
    </section>
  );
}
