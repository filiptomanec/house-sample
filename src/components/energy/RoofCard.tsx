"use client";

// Panels on the roof: the drawing, the choice of roof planes, the number of panels, the battery and what they mean for the
// household (self-use, self-sufficiency, surplus, purchase).

import { useMemo } from "react";
import { Chips, Segmented, Slider } from "@/components/ui/controls";
import { panelCapacity } from "@/lib/calc/roofLayout";
import { DIRS } from "@/lib/model/catalog";
import { useFormat, useT } from "@/lib/i18n/client";
import { RoofPlan } from "./RoofPlan";
import type { EnergyState } from "./useEnergy";
import { kwpText } from "./view";

export function RoofCard({ state }: { state: EnergyState }) {
  const t = useT();
  const f = useFormat();
  const { ctx, inputs, result, setPanelCount, setBattery, togglePlane } = state;
  const { layout, totals } = result;
  const pv = ctx.house.equipment.pv;
  const wholeRoof = useMemo(() => panelCapacity(ctx.planes, pv, ctx.planes.map((p) => p.key), ctx.obstacles), [ctx, pv]);
  const used = DIRS.filter((d) => layout.countBySide[d] > 0);
  const wp = f.unit(layout.moduleWp, "Wp");
  const summary = layout.count <= 0
    ? t("energy.roof.none")
    : used.length === 1
      ? t("energy.roof.summarySingle", { count: layout.count, wp, side: t(`energy.planeSide.${used[0]}`) })
      : t("energy.roof.summary", { count: layout.count, wp, sides: used.map((d) => t("energy.roof.side", { count: layout.countBySide[d], side: t(`energy.planeSide.${d}`) })).join(" · ") });
  const panels = (n: number) => t("common.count.panels", { count: n });

  // planes that can carry panels, named by side; a side with several planes gets a number
  const usable = layout.planes.filter((p) => p.capacity > 0);
  const chips = usable.map((p) => {
    const same = usable.filter((q) => q.side === p.side);
    const name = same.length > 1 ? `${t(`energy.dir.${p.side}`)} ${f.int(same.indexOf(p) + 1)}` : t(`energy.dir.${p.side}`);
    return { value: p.key, label: <><span>{name}</span><span className="chip-count">{f.int(p.placed)}/{f.int(p.capacity)}</span></> };
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
        <div className="stack roof-card-controls">
          <Slider
            label={t("energy.roof.count")}
            value={Math.min(inputs.pv.panelCount, layout.capacity)}
            min={0}
            max={layout.capacity}
            onChange={setPanelCount}
            format={(v) => t("energy.roof.countValue", { count: f.int(v), kwp: kwpText(t, f, (v * layout.moduleWp) / 1000) })}
            hint={t("energy.roof.countHint", { fit: panels(layout.capacity), all: panels(wholeRoof) })}
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
