"use client";
import type { CSSProperties } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { accent } from "@/lib/i18n/rich";
import type { PlanView } from "@/lib/plan/view";

/** The note under the table with the built-up area (requested in the WP13 handoff: {builtUp}, {height}, {doors}). */
const NOTE_BUILT_UP = "plan.table.noteBuiltUp";

/**
 * Table of the rooms: display number, name, floor, window area, net area with a bar (relative to the largest room) and three
 * totals from the shared metrics: the floor area without the garage ("užitná plocha"), the garage, and all rooms. Rows select
 * the room in the plan. The note names the built-up area of `metrics.builtUpArea` (as the Plot page does).
 */
export function RoomTable({ view, current, onPick }: { view: PlanView; current: string | null; onPick: (id: string) => void }) {
  const t = useT(), f = useFormat(), { totals } = view;
  const unit = <span className="u">{t("plan.table.areaUnit")}</span>;
  // the built-up area (the same metric as on the Plot page) once its sentence exists; until then the footprint, which the
  // current sentence describes ("including the external walls")
  const rest = { height: f.length(totals.clearHeight, 2), doors: t("common.count.doors", { count: totals.interiorDoors }) };
  const note = t.has(NOTE_BUILT_UP)
    ? t.dyn(NOTE_BUILT_UP, { builtUp: f.area(totals.builtUpArea, 1), ...rest })
    : t("plan.table.noteCount", { footprint: f.area(totals.footprint, 1), ...rest });
  const share = (a: number) => ({ "--v": `${totals.largestRoom > 0 ? Math.round((a / totals.largestRoom) * 1000) / 10 : 0}%` }) as CSSProperties;
  return (
    <section className="pl-section pl-rooms" aria-labelledby="plan-rooms">
      <h2 className="h2" id="plan-rooms">{accent(t("plan.table.title"))}</h2>
      <div className="table-wrap">
        <table className="data room-table">
          <thead>
            <tr>
              <th scope="col" className="c-no">{t("plan.table.number")}</th>
              <th scope="col">{t("plan.table.name")}</th>
              <th scope="col" className="c-floor">{t("plan.table.floor")}</th>
              <th scope="col" className="n c-win">{t("plan.table.windows")} {unit}</th>
              <th scope="col" className="n">{unit}</th>
              <th scope="col" className="c-bar" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {view.rooms.map((r) => (
              <tr key={r.id} aria-current={r.id === current ? "true" : undefined} onClick={() => onPick(r.id)}>
                <td className="mono tint c-no">{r.number}</td>
                <td><button type="button" className="row-btn">{r.name}</button></td>
                <td className="c-floor">{r.floorName ?? "–"}</td>
                <td className="n c-win">{r.glazing > 0 ? f.num(r.glazing, 1) : "–"}</td>
                <td className="n">{f.num(r.area, 2)}</td>
                <td className="c-bar" aria-hidden="true"><span className="pl-share" style={share(r.area)} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="pl-total-main">
              <td className="c-no" /><td>{t("plan.table.totalHeated")}</td><td className="c-floor" /><td className="c-win" />
              <td className="n">{f.num(totals.heatedArea, 2)}</td><td className="c-bar" />
            </tr>
            {totals.garageArea > 0 && (
              <tr>
                <td className="c-no" /><td>{t("plan.table.garage")}</td><td className="c-floor" /><td className="c-win" />
                <td className="n">{f.num(totals.garageArea, 2)}</td><td className="c-bar" />
              </tr>
            )}
            <tr className="pl-total-all">
              <td className="c-no" /><td>{t("plan.table.total")}</td><td className="c-floor" />
              <td className="n c-win">{f.num(totals.glazing, 1)}</td>
              <td className="n">{f.num(totals.floorArea, 2)}</td><td className="c-bar" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note pl-note">{note}</p>
    </section>
  );
}
