"use client";

// Panels on the roof: the drawing, the choice of roof planes, the number of panels, the battery and what they mean for the
// household (self-use, self-sufficiency, surplus, purchase).

import { useMemo } from "react";
import { Chips, Segmented, Slider } from "@/components/ui/controls";
import { panelCapacity } from "@/lib/calc/roofLayout";
import { DIRS } from "@/lib/model/catalog";
import { useFormat, useT } from "@/lib/i18n/client";
import { NBSP } from "@/lib/i18n/format";
import { RoofPlan } from "./RoofPlan";
import type { EnergyState } from "./useEnergy";

export function RoofCard({ state }: { state: EnergyState }) {
  const t = useT();
  const f = useFormat();
  const { ctx, inputs, result, setPanelCount, setBattery, togglePlane } = state;
  const { layout, totals } = result;
  const pv = ctx.house.equipment.pv;
  const wholeRoof = useMemo(() => panelCapacity(ctx.planes, pv, ctx.planes.map((p) => p.key), ctx.obstacles), [ctx, pv]);
  const sides = DIRS.filter((d) => layout.countBySide[d] > 0).map((d) => `${t(`energy.dir.${d}`)}${NBSP}${f.int(layout.countBySide[d])}`).join(" · ");
  const summary = layout.count > 0
    ? t("energy.roof.summary", { count: layout.count, wp: f.unit(layout.moduleWp, "Wp"), sides })
    : t("energy.roof.none");
  const panelsText = (n: number) => t("energy.roof.panelsWord", { count: n });

  // planes that can carry panels, named by side; a side with several planes gets a number
  const usable = layout.planes.filter((p) => p.capacity > 0);
  const chips = usable.map((p) => {
    const same = usable.filter((q) => q.side === p.side);
    const suffix = same.length > 1 ? ` ${same.indexOf(p) + 1}` : "";
    return { value: p.key, label: `${t(`energy.dir.${p.side}`)}${suffix}${NBSP}${f.int(p.placed)}/${f.int(p.capacity)}` };
  });

  return (
    <section className="panel panel-pad roof-card" aria-labelledby="roof-title">
      <div className="roof-card-head">
        <h2 className="h3" id="roof-title">{t("energy.roof.title")}</h2>
        <p className="small">{summary} {t("energy.roof.toggleHint")}</p>
      </div>
      <div className="roof-card-body">
        <div className="roof-card-plan">
          <RoofPlan planes={ctx.planes} layout={layout} outline={ctx.derived.outline.polygons.map((p) => p.pts)} bearingDeg={ctx.house.location.houseAxisBearingDeg} onToggle={togglePlane} />
          <Chips ariaLabel={t("energy.roof.planes")} options={chips} selected={inputs.pv.enabledPlanes} onToggle={togglePlane} />
        </div>
        <div className="stack">
          <Slider
            label={t("energy.roof.count")}
            value={Math.min(inputs.pv.panelCount, layout.capacity)}
            min={0}
            max={layout.capacity}
            onChange={setPanelCount}
            format={(v) => t("energy.roof.countValue", { count: f.int(v), kwp: f.unit((v * layout.moduleWp) / 1000, t("energy.units.kwp"), 2) })}
            hint={t("energy.roof.countHint", { fit: panelsText(layout.capacity), all: panelsText(wholeRoof) })}
          />
          <Segmented
            label={t("energy.roof.battery")}
            value={inputs.pv.batteryId}
            options={ctx.house.equipment.battery.options.map((o) => ({ value: o.id, label: o.capacityKwh > 0 ? f.num(o.capacityKwh, 0, 1) : t("energy.roof.batteryNone") }))}
            onChange={setBattery}
          />
          <div className="kv">
            <span>{t("energy.roof.selfUse")}</span><span>{f.percent(totals.selfConsumption * 100)}</span>
            <span>{t("energy.roof.selfSufficiency")}</span><span>{f.percent(totals.selfSufficiency * 100)}</span>
            <span>{t("energy.roof.export")}</span><span>{f.unit(totals.exportKwh, t("energy.units.kwh"))}</span>
            <span>{t("energy.roof.import")}</span><span>{f.unit(totals.importKwh, t("energy.units.kwh"))}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
