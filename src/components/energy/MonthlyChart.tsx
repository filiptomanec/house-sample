"use client";

// Electricity by month: consumption stacked by purpose, production beside it. Tapping a month selects it for the day chart
// (the month picker under the chart does the same with proper touch targets, and a table of the numbers is there for
// screen readers).

import { monthNames } from "@/lib/calendar";
import type { EnergyResult } from "@/lib/calc/energy";
import { useNarrow } from "@/components/ui/useNarrow";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { shortMonths } from "./months";
import { niceMax, px, tickDecimals, ticks } from "./chartScale";

export function MonthlyChart({ result, month, onMonth }: { result: EnergyResult; month: number; onMonth: (m: number) => void }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const narrow = useNarrow();
  const names = shortMonths(locale);
  const W = narrow ? 320 : 720, H = narrow ? 240 : 300, L = narrow ? 36 : 44, B = 26, T = 16, R = 6, fs = narrow ? 11 : 11;

  const parts = [
    { key: "heat", label: t("energy.charts.heat"), v: result.months.map((m) => m.elHeatKwh) },
    { key: "dhw", label: t("energy.charts.dhw"), v: result.months.map((m) => m.elDhwKwh) },
    { key: "household", label: t("energy.charts.household"), v: result.months.map((m) => m.elApplianceKwh + m.elVentKwh) },
    { key: "ev", label: t("energy.charts.ev"), v: result.months.map((m) => m.elEvKwh) },
  ].filter((p) => p.v.some((x) => x > 0));
  const pv = result.months.map((m) => m.pvKwh);
  const max = niceMax(Math.max(...result.months.map((m) => m.elTotalKwh), ...pv));
  const y = (v: number) => px(T + (H - T - B) * (1 - v / max));
  const gw = px((W - L - R) / 12), bw = px(Math.min(22, gw * 0.36));
  const decimals = tickDecimals(max / 4);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("energy.charts.monthlyAria")}>
        {ticks(max, 4).map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="chart-axis" x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={fs}>{f.num(v, decimals)}</text>
          </g>
        ))}
        <text className="chart-axis" x={L} y={T - 5} fontSize={fs}>{t("energy.charts.axisKwh")}</text>
        {result.months.map((m, i) => {
          const x0 = px(L + i * gw + gw / 2 - bw - 1);
          let acc = 0;
          return (
            <g key={i} onClick={() => onMonth(i)} className="chart-month">
              <rect className={i === month ? "chart-pick on" : "chart-pick"} x={px(L + i * gw)} y={T} width={gw} height={H - T - B} />
              {parts.map((p) => {
                const top = y(acc + p.v[i]), h = px(y(acc) - top);
                acc += p.v[i];
                return h > 0.2 ? <rect key={p.key} className={`s-${p.key}`} x={x0} y={top} width={bw} height={h} /> : null;
              })}
              <rect className="s-pv" x={px(x0 + bw + 2)} y={y(pv[i])} width={bw} height={px(Math.max(0, y(0) - y(pv[i])))} />
              <text className={i === month ? "chart-axis on" : "chart-axis"} x={px(L + i * gw + gw / 2)} y={H - 8} textAnchor="middle" fontSize={fs}>{narrow ? f.int(i + 1) : names[i]}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="legend small">
        {parts.map((p) => <span key={p.key}><i className={`dot s-${p.key}`} />{p.label}</span>)}
        <span><i className="dot s-pv" />{t("energy.charts.production")}</span>
      </figcaption>
      <div className="sr-only">
      <table>
        <caption>{t("energy.charts.monthlyAria")}</caption>
        <thead><tr><th>{t("energy.charts.tableMonth")}</th><th>{t("energy.charts.tableConsumption")}</th><th>{t("energy.charts.tableProduction")}</th></tr></thead>
        <tbody>
          {result.months.map((m, i) => (
            <tr key={i}><th>{monthNames(locale, "long")[i]}</th><td>{f.unit(m.elTotalKwh, t("energy.units.kwh"))}</td><td>{f.unit(m.pvKwh, t("energy.units.kwh"))}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
