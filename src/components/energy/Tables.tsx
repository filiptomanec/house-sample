"use client";

// "Where the heat goes" (the envelope grouped by kind, sorted by loss, with the directions behind a toggle), "where the
// electricity goes", the design heat load and the summer indicator. Rows come from the calculation (view.ts); the kind of a
// row picks its label, never an id.

import { useId, useState, type CSSProperties } from "react";
import type { EnergyResult } from "@/lib/calc/energy";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { monthSpan } from "./months";
import { electricityRows, heatGroups, type HeatGroup } from "./view";

/** Share of a total as the width of a bar: a custom property, so that the colour stays in the stylesheet. */
const width = (share: number): CSSProperties => ({ "--w": `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%` }) as CSSProperties;

/** One kind of construction: its row with the loss bar, and (behind the toggle) its rows by direction, in one tbody. */
function HeatRows({ g, open, onToggle }: { g: HeatGroup; open: boolean; onToggle: () => void }) {
  const f = useFormat();
  const id = useId();
  const cells = (area: number | null, u: number | null, h: number, share: number) => (
    <>
      <td className="n">{area === null ? "" : f.num(area, 1)}</td>
      <td className="n">{u === null ? "" : f.num(u, 3)}</td>
      <td className="n">{f.num(h, 1)}</td>
      <td className="n share">{f.percent(share * 100)}</td>
    </>
  );
  const partIds = g.parts.map((_, i) => `${id}-${i}`);
  return (
    <tbody className={`heat-group${g.largest ? " largest" : ""}${open ? " is-open" : ""}`}>
      <tr className="heat-row">
        <th scope="row">
          {g.parts.length > 0 ? (
            <button type="button" className="heat-toggle" aria-expanded={open} aria-controls={partIds.join(" ")} onClick={onToggle}>
              <span>{g.label}</span><i className="chev" aria-hidden />
            </button>
          ) : <span className="heat-label">{g.label}</span>}
          <span className="heat-bar" style={width(g.share)} aria-hidden><i /></span>
        </th>
        {cells(g.area, g.u, g.h, g.share)}
      </tr>
      {g.parts.map((p, i) => (
        <tr key={p.key} className="heat-part" id={partIds[i]} hidden={!open}>
          <th scope="row">{p.label}</th>
          {cells(p.area, p.u, p.h, p.share)}
        </tr>
      ))}
    </tbody>
  );
}

export function HeatPanel({ result, bridgeDeltaU }: { result: EnergyResult; bridgeDeltaU: number }) {
  const t = useT();
  const f = useFormat();
  const { ventilation } = result;
  const recovery = ventilation.recovery > 0 ? t("energy.tables.recoveryNote", { eff: f.percent(ventilation.recovery * 100) }) : "";
  const { groups, total } = heatGroups(result, t, t("energy.tables.ventilationRow", { flow: f.unit(ventilation.airflowM3h, "m³/h"), recovery }));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) => setOpen((s) => {
    const next = new Set(s);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  return (
    <section className="panel panel-pad energy-heat" aria-labelledby="heat-title">
      <h2 className="h3" id="heat-title">{t("energy.tables.heatTitle")}</h2>
      <div className="table-wrap">
        <table className="data env-table">
          <caption className="sr-only">{t("energy.tables.lossBarAria")}</caption>
          <colgroup><col /><col className="c-n" /><col className="c-n" /><col className="c-n" /><col className="c-share" /></colgroup>
          <thead>
            <tr>
              <th scope="col">{t("energy.tables.construction")}</th>
              <th scope="col" className="n">{t("energy.tables.area")}<span className="u">{t("energy.units.m2")}</span></th>
              <th scope="col" className="n">U<span className="u">{t("energy.units.u")}</span></th>
              <th scope="col" className="n">{t("energy.tables.loss")}<span className="u">{t("energy.units.wk")}</span></th>
              <th scope="col" className="n">{t("energy.tables.share")}</th>
            </tr>
          </thead>
          {groups.map((g) => <HeatRows key={g.key} g={g} open={open.has(g.key)} onToggle={() => toggle(g.key)} />)}
          <tfoot><tr><th scope="row">{t("energy.tables.total")}</th><td /><td /><td className="n">{f.num(total, 1)}</td><td /></tr></tfoot>
        </table>
      </div>
      <p className="note">{t("energy.tables.floorNote", { du: f.num(bridgeDeltaU, 2) })}</p>
    </section>
  );
}

export function ElectricityPanel({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const { totals, pool } = result;
  const kwh = t("energy.units.kwh");
  const rows = electricityRows(result, t, f);
  return (
    <section className="panel panel-pad energy-electricity" aria-labelledby="electricity-title">
      <h2 className="h3" id="electricity-title">{t("energy.tables.electricityTitle")}</h2>
      <ul className="el-list">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="el-row"><span>{r.label}</span><b>{f.unit(r.kwh, kwh)}</b></div>
            <span className={`share-bar s-${r.key}`} style={width(r.share)} aria-hidden><i className={r.key === "pool" || r.key === "ev" ? "hatch" : undefined} /></span>
          </li>
        ))}
      </ul>
      <div className="kv">
        <span className="sum">{t("energy.tables.elTotal")}</span><span className="sum">{f.unit(totals.elTotalKwh, kwh)}</span>
      </div>
      {pool.present && <p className="note">{t("energy.pool.note", { season: monthSpan(locale, pool.seasonMonths) })}</p>}
    </section>
  );
}

/** Design heat load (EN 12831) and what the heat pump delivers on that day. */
export function DesignPanel({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const { designLoad } = result;
  const kw = t("energy.units.kw");
  const share = f.percent(Math.min(designLoad.coverage, 9.99) * 100);
  const temp = f.unit(designLoad.outdoorC, "°C");
  const cover = t.has("energy.tables.designCoverAt")
    ? t.dyn("energy.tables.designCoverAt", { temp, output: f.unit(designLoad.ratedPowerKwAtDesign, kw, 0, 1), rated: f.unit(designLoad.ratedKw, kw, 0, 1), share })
    : t("energy.tables.designCover", { rated: f.unit(designLoad.ratedPowerKwAtDesign, kw, 0, 1), share });
  return (
    <section className="panel panel-pad energy-design" aria-labelledby="design-title">
      <h2 className="h3" id="design-title">{t("energy.tables.designTitle")}</h2>
      <div className="kv">
        <span>{t("energy.tables.designTransmission")}</span><span>{f.unit(designLoad.transmissionW, "W")}</span>
        <span>{t("energy.tables.designGround")}</span><span>{f.unit(designLoad.groundW, "W")}</span>
        <span>{t("energy.tables.designVentilation")}</span><span>{f.unit(designLoad.ventilationW, "W")}</span>
        <span className="sum">{t("energy.tables.designTotal")}</span><span className="sum">{f.unit(designLoad.totalW, "W")}</span>
        <span>{t("energy.tables.designSpecific")}</span><span>{f.unit(designLoad.specificWm2, "W/m²", 1)}</span>
      </div>
      {designLoad.totalW > 0 && (
        <p className="note cover">{cover}</p>
      )}
    </section>
  );
}

/**
 * The summer indicator: solar heat through the glazing from June to August with the blinds up and with the blinds following the
 * sun. Shown once its strings exist (energy.summer.*, requested from the copy pass); until then it renders nothing.
 */
export function SummerPanel({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  if (!t.has("energy.summer.title")) return null;
  const s = result.summerSolarLoad;
  const mwh = t("energy.units.mwh");
  const value = (kwh: number) => f.unit(kwh / 1000, mwh, 1);
  const max = Math.max(s.openKwh, s.withBlindsKwh, 1e-9);
  const rows = [
    { key: "open", label: t.dyn("energy.summer.open"), v: s.openKwh },
    { key: "blinds", label: t.dyn("energy.summer.withBlinds"), v: s.withBlindsKwh },
  ];
  return (
    <section className="panel panel-pad energy-summer" aria-labelledby="summer-title">
      <h2 className="h3" id="summer-title">{t.dyn("energy.summer.title")}</h2>
      <p className="small">{t.dyn("energy.summer.lede", { season: monthSpan(locale, s.months), open: value(s.openKwh), saved: value(s.savedKwh) })}</p>
      <div className="bars summer-bars">
        {rows.map((r) => (
          <div key={r.key} className={`bar-row summer-${r.key}`}>
            <span>{r.label}</span>
            <span className="bar" aria-hidden><i style={width(r.v / max)} /></span>
            <b className="num">{value(r.v)}</b>
          </div>
        ))}
      </div>
      {t.has("energy.summer.note") && <p className="note">{t.dyn("energy.summer.note")}</p>}
    </section>
  );
}
