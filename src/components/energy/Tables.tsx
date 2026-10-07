"use client";

// "Where the heat goes" (the envelope table, the design load) and "where the electricity goes". Rows come from the
// calculation; the kind of a row picks its label, never an id.

import type { CSSProperties } from "react";
import type { EnergyResult, EnvelopeKind } from "@/lib/calc/energy";
import { useFormat, useT } from "@/lib/i18n/client";

/** Share of a total as the width of a bar: a custom property, so that the colour stays in the stylesheet. */
const share = (value: number, total: number): CSSProperties => ({ "--w": `${total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)).toFixed(1) : 0}%` }) as CSSProperties;

/** Rows of the envelope that are shown as one part of the loss bar. */
const GROUP_OF: Record<EnvelopeKind, string> = { wall: "wall", window: "openings", slider: "openings", door: "openings", roof: "roof", floor: "floor", bridge: "bridge", partition: "partition" };
const GROUP_ORDER = ["wall", "openings", "roof", "floor", "bridge", "partition", "ventilation"] as const;

/** One bar that shows the heat loss split by part, with a legend that gives each part's share. */
function LossBar({ result, total }: { result: EnergyResult; total: number }) {
  const t = useT();
  const f = useFormat();
  const sums = new Map<string, number>();
  for (const r of result.envelope.rows) sums.set(GROUP_OF[r.kind], (sums.get(GROUP_OF[r.kind]) ?? 0) + r.h);
  sums.set("ventilation", result.ventilation.hV);
  const parts = GROUP_ORDER.map((g) => ({ g, v: sums.get(g) ?? 0 })).filter((p) => p.v > 0);
  return (
    <div className="loss">
      <div className="loss-bar" role="img" aria-label={t("energy.tables.lossBarAria")}>
        {parts.map((p) => <i key={p.g} className={`lc-${p.g}`} style={{ flexGrow: Math.round(p.v * 100) / 100 }} />)}
      </div>
      <ul className="legend small">
        {parts.map((p) => <li key={p.g}><i className={`dot lc-${p.g}`} />{t(`energy.envelope.${p.g}`)} {f.percent(total > 0 ? (p.v / total) * 100 : 0)}</li>)}
      </ul>
    </div>
  );
}

export function HeatPanel({ result, bridgeDeltaU }: { result: EnergyResult; bridgeDeltaU: number }) {
  const t = useT();
  const f = useFormat();
  const { envelope, ventilation, designLoad } = result;
  const total = envelope.hTransmission + ventilation.hV;
  const recovery = ventilation.recovery > 0 ? t("energy.tables.recoveryNote", { eff: f.percent(ventilation.recovery * 100) }) : "";
  const flow = f.unit(ventilation.airflowM3h, "m³/h");

  return (
    <div className="panel panel-pad energy-heat">
      <h2 className="h3">{t("energy.tables.heatTitle")}</h2>
      <LossBar result={result} total={total} />
      <div className="table-wrap">
        <table className="data env-table">
          <thead>
            <tr>
              <th>{t("energy.tables.construction")}</th>
              <th className="n">{t("energy.tables.area")}<span className="u">{t("energy.units.m2")}</span></th>
              <th className="n">U<span className="u">{t("energy.units.u")}</span></th>
              <th className="n">{t("energy.tables.loss")}<span className="u">{t("energy.units.wk")}</span></th>
            </tr>
          </thead>
          <tbody>
            {envelope.rows.map((r) => (
              <tr key={r.key}>
                <td>{t(`energy.envelope.${r.kind}`)}{r.dir ? `, ${t(`energy.dir.${r.dir}`)}` : ""}</td>
                <td className="n">{f.num(r.area, 1)}</td>
                <td className="n">{f.num(r.u, 3)}</td>
                <td className="n">{f.num(r.h, 1)}</td>
              </tr>
            ))}
            <tr>
              <td>{t("energy.tables.ventilationRow", { flow, recovery })}</td>
              <td className="n" /><td className="n" /><td className="n">{f.num(ventilation.hV, 1)}</td>
            </tr>
          </tbody>
          <tfoot><tr><td>{t("energy.tables.total")}</td><td /><td /><td className="n">{f.num(total, 1)}</td></tr></tfoot>
        </table>
      </div>
      <p className="note">{t("energy.tables.floorNote", { du: f.num(bridgeDeltaU, 2) })}</p>

      <h3 className="energy-subhead">{t("energy.tables.designTitle")}</h3>
      <div className="kv">
        <span>{t("energy.tables.designTransmission")}</span><span>{f.unit(designLoad.transmissionW, "W")}</span>
        <span>{t("energy.tables.designGround")}</span><span>{f.unit(designLoad.groundW, "W")}</span>
        <span>{t("energy.tables.designVentilation")}</span><span>{f.unit(designLoad.ventilationW, "W")}</span>
        <span className="sum">{t("energy.tables.designTotal")}</span><span className="sum">{f.unit(designLoad.totalW, "W")}</span>
        <span>{t("energy.tables.designSpecific")}</span><span>{f.unit(designLoad.specificWm2, "W/m²", 1)}</span>
      </div>
      {designLoad.totalW > 0 && (
        <p className="note">{t("energy.tables.designCover", { rated: f.unit(designLoad.ratedKw, t("energy.units.kw")), share: f.percent(Math.min(designLoad.coverage, 9.99) * 100) })}</p>
      )}
    </div>
  );
}

export function ElectricityPanel({ result }: { result: EnergyResult }) {
  const t = useT();
  const f = useFormat();
  const { totals } = result;
  const kwh = t("energy.units.kwh");
  const rows = [
    { key: "heat", label: t("energy.tables.elHeat", { heat: f.unit(totals.heatNeedKwh, kwh) }), v: totals.elHeatKwh },
    { key: "dhw", label: t("energy.tables.elDhw", { heat: f.unit(totals.dhwHeatKwh, kwh) }), v: totals.elDhwKwh },
    { key: "household", label: t("energy.tables.elHousehold"), v: totals.elApplianceKwh },
    { key: "vent", label: t("energy.tables.elVent"), v: totals.elVentKwh },
    { key: "ev", label: t("energy.tables.elEv"), v: totals.elEvKwh },
  ].filter((r) => r.v > 0);
  return (
    <div className="panel panel-pad energy-electricity">
      <h2 className="h3">{t("energy.tables.electricityTitle")}</h2>
      <ul className="el-list">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="el-row"><span>{r.label}</span><b>{f.unit(r.v, kwh)}</b></div>
            <span className={`share-bar s-${r.key}`} style={share(r.v, totals.elTotalKwh)}><i /></span>
          </li>
        ))}
      </ul>
      <div className="kv">
        <span className="sum">{t("energy.tables.elTotal")}</span><span className="sum">{f.unit(totals.elTotalKwh, kwh)}</span>
      </div>
    </div>
  );
}
