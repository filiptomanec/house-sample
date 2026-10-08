"use client";
import { useMemo, useState, type Ref } from "react";
import { measureBetween } from "@/lib/model/site/profile";
import { sampleProfile } from "@/lib/model/site/profile";
import type { XY } from "@/lib/model/site/geometry";
import type { Terrain } from "@/lib/model/site/terrain";
import { useFormat, useT } from "@/lib/i18n/client";
import { NBSP, absolute, signed } from "./fmt";
import { Profile } from "./Profile";
import type { PlotView, Preset } from "./view";

const same = (a: XY | undefined, b: XY) => !!a && a[0] === b[0] && a[1] === b[1];

/**
 * Measuring: two points from the map or from the lists of corners; distance, rise, slope and the elevation profile. The panel
 * stays one line (title and hint) until it is opened or the first point is set on the map; the lists live inside it.
 */
export function MeasurePanel({ view, terrain, pick, onPick, onClear, ref }: {
  view: PlotView; terrain: Terrain; pick: readonly XY[]; onPick: (i: 0 | 1, p: XY | null) => void; onClear: () => void; ref?: Ref<HTMLElement>;
}) {
  const t = useT(), f = useFormat();
  const [opened, setOpened] = useState(false);
  const open = opened || pick.length > 0;
  const garages = view.presets.filter((p) => p.group === "garage").length;
  const nameOf = (p: Preset): string =>
    p.group === "garage"
      ? t("plot.preset.garage") + (garages > 1 ? ` ${p.index + 1}` : "")
      : t(p.group === "house" ? "plot.preset.house" : "plot.preset.plot", { corner: t(`plot.corner.${p.corner ?? "NE"}`) });
  const idOf = (p: XY | undefined) => (p ? view.presets.find((x) => same(p, x.p))?.id ?? "" : "");
  const set = (i: 0 | 1, id: string) => onPick(i, id ? view.presets.find((x) => x.id === id)?.p ?? null : null);

  const both = pick.length === 2 ? ([pick[0], pick[1]] as const) : null;
  const m = useMemo(() => (both ? measureBetween(terrain.groundAt, both[0], both[1], view.bearingDeg) : null), [both?.[0], both?.[1], terrain, view.bearingDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  const profile = useMemo(
    () => (m ? sampleProfile(terrain.groundAt, m.from, m.to, { count: Math.min(240, Math.max(24, Math.round(m.distance * 3) + 1)) }) : null),
    [m, terrain],
  );
  const abs = (z: number) => absolute(f, z, view.zeroLevelAsl);
  const rising = m ? m.slopePct > 0.05 : false, falling = m ? m.slopePct < -0.05 : false;

  const groups: { key: Preset["group"]; label: string }[] = [
    { key: "house", label: t("plot.measure.groupHouse") }, { key: "garage", label: t("plot.measure.groupGarage") }, { key: "plot", label: t("plot.measure.groupPlot") },
  ];
  const options = (skip?: XY) => groups.map((g) => {
    const items = view.presets.filter((p) => p.group === g.key && !same(skip, p.p));
    return items.length ? <optgroup key={g.key} label={g.label}>{items.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}</optgroup> : null;
  });

  return (
    <section ref={ref} id="pt-measure" className="panel panel-pad pt-measure-panel" aria-labelledby="pt-measure-h">
      <details className="pt-measure-box" open={open} onToggle={(e) => setOpened((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="pt-panel-head">
        <span className="pt-measure-title">
          <h2 className="label" id="pt-measure-h">{t("plot.measure.title")}</h2>
          {!open && <span className="small pt-measure-hint">{t("plot.map.hint")}</span>}
        </span>
        <span className="method-icon" aria-hidden />
      </summary>
      <div className="stack pt-measure-body">
      {pick.length > 0 && <div className="pt-measure-actions"><button type="button" className="btn ghost sm" onClick={onClear}>{t("plot.measure.clear")}</button></div>}
      <div className="pt-pick">
        <label className="field"><span className="small">{t("plot.measure.from")}</span>
          <select className="numin" value={idOf(pick[0])} onChange={(e) => set(0, e.target.value)}>
            <option value="">{pick[0] ? t("plot.measure.onMap") : t("plot.measure.choose")}</option>
            {options(pick[1])}
          </select>
        </label>
        <label className="field"><span className="small">{t("plot.measure.to")}</span>
          <select className="numin" value={idOf(pick[1])} disabled={!pick[0]} onChange={(e) => set(1, e.target.value)}>
            <option value="">{pick[1] ? t("plot.measure.onMap") : t("plot.measure.choose")}</option>
            {options(pick[0])}
          </select>
        </label>
      </div>
      <div aria-live="polite" className="stack">
        {m && profile ? (
          <>
            <div className="kv">
              <span>{t("plot.measure.distance")}</span><span>{f.length(m.distance, 2)}</span>
              <span>{t("plot.measure.rise")}<small>{t("plot.measure.riseNote", { from: abs(m.zFrom), to: abs(m.zTo) })}</small></span><span>{signed(f, m.dz, 2)}{NBSP}m</span>
              <span>{t("plot.measure.slope")}<small>{rising ? t("plot.measure.rising") : falling ? t("plot.measure.falling") : t("plot.measure.level")}</small></span><span>{f.percent(Math.abs(m.slopePct), 1)}</span>
              <span>{t("plot.measure.steepest")}</span><span>{f.percent(m.maxSlopePct, 1)}</span>
              <span>{t("plot.measure.direction")}<small>{t("plot.measure.directionNote")}</small></span><span>{f.degrees(m.trueAzimuth, 0)}</span>
            </div>
            <div>
              <p className="label">{t("plot.measure.profile")}</p>
              <Profile data={profile} />
            </div>
          </>
        ) : <p className="small">{t("plot.measure.empty")}</p>}
      </div>
      </div>
      </details>
    </section>
  );
}
