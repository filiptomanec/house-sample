"use client";
// Hours of direct sun on the chosen day: the terraces (as set, and without the movable shading for the main one) and the
// habitable rooms, longest first. When a calculation finishes, a short status line announces the main terrace.
import { memo } from "react";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import type { SunDayResult } from "@/lib/three";
import type { AreaRow, RoomRow } from "./model";

export interface SunBarsProps {
  result: SunDayResult | null;
  pending: boolean;
  failed: boolean;
  /** No 3D scene can be built here, so there will never be a result. */
  unavailable: boolean;
  areas: readonly AreaRow[];
  primary: AreaRow | null;
  rooms: readonly RoomRow[];
  /** The model has movable shading, so "without shading" is a different number worth showing. */
  hasMovable: boolean;
  /** "21. června" */
  dateText: string;
  /** What the movable shading is set to, already a sentence; null when the model has none. */
  shadingText: string;
}

interface Row {
  key: string;
  label: string;
  hours: number;
  kind: "area" | "open" | "room";
}

function SunBarsView({ result, pending, failed, unavailable, areas, primary, rooms, hasMovable, dateText, shadingText }: SunBarsProps) {
  const t = useT(), f = useFormat(), locale = useLocale();
  let message: string | null = null;
  if (!result) message = failed ? t("sun.results.failed") : unavailable ? t("sun.results.noStage") : t("sun.results.computing");

  const rows: Row[] = [];
  if (result) {
    for (const a of areas) {
      const s = result.outdoors[a.id];
      if (s) rows.push({ key: a.id, label: a.label[locale], hours: s.hours, kind: "area" });
      const open = result.outdoorsOpen[a.id];
      if (hasMovable && open && a.id === primary?.id) rows.push({ key: `${a.id}-open`, label: t("sun.results.withoutShading", { name: a.label[locale] }), hours: open.hours, kind: "open" });
    }
    const lit = rooms.flatMap((r) => (result.rooms[r.id] ? [{ key: r.id, label: r.label[locale], hours: result.rooms[r.id].hours, kind: "room" as const }] : []));
    rows.push(...lit.sort((a, b) => b.hours - a.hours));
  }
  const max = Math.max(1, ...rows.map((r) => r.hours));
  const lead = rows.find((r) => r.kind === "area") ?? null;
  return (
    <section className="panel panel-pad sun-bars" aria-labelledby="sun-bars-title" aria-busy={pending} data-pending={pending || undefined}>
      <h2 className="h3" id="sun-bars-title">{t("sun.results.title", { date: dateText })}</h2>
      {/* one short announcement when a calculation finishes, instead of a live region over every number */}
      <p className="sr-only" role="status" aria-live="polite">
        {!pending && result && lead ? t("sun.results.ready", { date: dateText, name: lead.label, hours: f.unit(lead.hours, "h", 1) }) : ""}
      </p>
      {message && <p className="small sun-message" role="status">{message}</p>}
      {result && (
        <div className="bars">
          {rows.map((r) => (
            <div key={r.key} className={`bar-row sun-bar-${r.kind}`}>
              <span>{r.label}</span>
              <div className="bar" aria-hidden="true"><i style={{ width: `${(r.hours / max) * 100}%` }} /></div>
              <b className="mono">{f.unit(r.hours, "h", 1)}</b>
            </div>
          ))}
        </div>
      )}
      {shadingText && <p className="note">{shadingText}</p>}
      <p className="note">{t("sun.results.note")}</p>
    </section>
  );
}

export const SunBars = memo(SunBarsView);
export default SunBars;
