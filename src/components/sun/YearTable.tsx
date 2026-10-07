"use client";
// Hours of direct sun on the 21st of every month: the terrace as set and open, and every habitable room with a window.
// Months arrive one by one from the analysis; the cells wait with an ellipsis.
import { memo } from "react";
import { monthNames } from "@/lib/calendar";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import type { SunDayResult } from "@/lib/three";
import { YEAR_TABLE_DAY, type AreaRow, type RoomRow } from "./model";

export interface YearTableProps {
  year: readonly (SunDayResult | null)[];
  /** Length of the day on the table's day of every month, hours. */
  dayLengths: readonly number[];
  primary: AreaRow | null;
  rooms: readonly RoomRow[];
  hasMovable: boolean;
  pending: boolean;
  shadingText: string;
}

function YearTableView({ year, dayLengths, primary, rooms, hasMovable, pending, shadingText }: YearTableProps) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const months = monthNames(locale, "long");
  const cell = (r: SunDayResult | null, hours: number | undefined) => (r && hours !== undefined ? f.num(hours, 1, 1) : r ? f.num(0, 1, 1) : t("sun.year.pending"));
  return (
    <section className="panel panel-pad sun-year" aria-labelledby="sun-year-title" data-pending={pending || undefined}>
      <h2 className="h3" id="sun-year-title">{t("sun.year.title")}</h2>
      <p className="small">{t("sun.year.intro", { day: YEAR_TABLE_DAY })} {shadingText}</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="sun-year-title">
        <table className="data sun-year-table">
          <thead>
            <tr>
              <th scope="col">{t("sun.year.month")}</th>
              <th scope="col" className="n">{t("sun.year.dayLength")}</th>
              {primary && <th scope="col" className="n">{hasMovable ? t("sun.results.withShading", { name: primary.label[locale] }) : primary.label[locale]}</th>}
              {primary && hasMovable && <th scope="col" className="n">{t("sun.results.withoutShading", { name: primary.label[locale] })}</th>}
              {rooms.map((r) => <th key={r.id} scope="col" className="n">{r.label[locale]}</th>)}
            </tr>
          </thead>
          <tbody>
            {months.map((name, m) => {
              const r = year[m] ?? null;
              return (
                <tr key={m}>
                  <th scope="row">{name}</th>
                  <td className="n">{f.num(dayLengths[m] ?? 0, 1, 1)}</td>
                  {primary && <td className="n">{cell(r, r?.outdoors[primary.id]?.hours)}</td>}
                  {primary && hasMovable && <td className="n">{cell(r, r?.outdoorsOpen[primary.id]?.hours)}</td>}
                  {rooms.map((room) => <td key={room.id} className="n">{cell(r, r?.rooms[room.id]?.hours)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export const YearTable = memo(YearTableView);
export default YearTable;
