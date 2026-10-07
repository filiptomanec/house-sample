"use client";
import { Stat } from "@/components/ui/controls";
import { useFormat, useT } from "@/lib/i18n/client";
import { SNAP, SNAP_COARSE, measure } from "@/lib/plan/myFurniture";
import type { PlanPt } from "@/lib/plan/planGeometry";

/** Result of the measuring tool: the distance and its two components. `pts` are the points set (0 to 2). */
export function MeasurePanel({ pts }: { pts: readonly PlanPt[] }) {
  const t = useT(), f = useFormat();
  const m = pts.length === 2 ? measure(pts[0], pts[1]) : null;
  return (
    <div className="stack">
      <p className="label">{t("plan.measure.title")}</p>
      {m ? (
        <>
          <Stat value={f.num(m.length, 2)} unit="m" label={`${t("plan.measure.horizontal")} ${f.length(m.dx, 2)} · ${t("plan.measure.vertical")} ${f.length(m.dy, 2)}`} />
          <p className="note">{t("plan.measure.note", { step: Math.round(SNAP * 100) })}</p>
        </>
      ) : <p className="small">{t("plan.measure.prompt")}</p>}
      <p id="measure-keys" className="note">{t("plan.measure.keys", { step: Math.round(SNAP * 100), coarse: Math.round(SNAP_COARSE * 100) })}</p>
    </div>
  );
}
