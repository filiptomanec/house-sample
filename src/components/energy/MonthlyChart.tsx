"use client";

// Electricity by month: consumption stacked by purpose in the graphite ramp (pool and car hatched), solar production beside it
// in mint. Drawn at its real width with 11 px axis text; the value axis steps by 1, 2 or 5 times a power of ten. Clicking a month
// selects it for the day chart (the month control of the day chart does the same with proper touch targets); a table of the
// numbers is there for screen readers.

import { useId, useRef } from "react";
import { monthNames } from "@/lib/calendar";
import type { EnergyResult } from "@/lib/calc/energy";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { HatchDef, useChartWidth } from "./chartParts";
import { CHART_COMPACT_WIDTH, niceTicks, px, tickDecimals } from "./chartScale";
import { narrowMonths, shortMonths } from "./months";

/** The stack from the bottom: the steady household load first, then what follows the seasons. */
const PARTS = ["household", "heat", "dhw", "pool", "ev"] as const;
const HATCHED = new Set<string>(["pool", "ev"]);

export function MonthlyChart({ result, month, onMonth }: { result: EnergyResult; month: number; onMonth: (m: number) => void }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const hatch = useId();
  const ref = useRef<HTMLDivElement>(null);
  const W = useChartWidth(ref);
  const compact = W < CHART_COMPACT_WIDTH;
  // the height is set by .chart-monthly svg in energy.css (300 px, 240 px on phones); these must agree
  const H = compact ? 240 : 300;
  const L = compact ? 38 : 46, R = 2, T = 24, B = 26;

  const values: Record<(typeof PARTS)[number], number[]> = {
    household: result.months.map((m) => m.elApplianceKwh + m.elVentKwh),
    heat: result.months.map((m) => m.elHeatKwh),
    dhw: result.months.map((m) => m.elDhwKwh),
    pool: result.months.map((m) => m.elPoolKwh),
    ev: result.months.map((m) => m.elEvKwh),
  };
  const labels: Record<(typeof PARTS)[number], string> = {
    household: t("energy.charts.household"), heat: t("energy.charts.heat"), dhw: t("energy.charts.dhw"), pool: t("energy.charts.pool"), ev: t("energy.charts.ev"),
  };
  const parts = PARTS.filter((k) => values[k].some((v) => v > 0));
  const pv = result.months.map((m) => m.pvKwh);
  const axis = niceTicks(Math.max(...result.months.map((m) => m.elTotalKwh), ...pv), compact ? 4 : 5);
  const y = (v: number) => px(T + (H - T - B) * (1 - v / axis.max));
  const gw = (W - L - R) / 12;
  const bw = px(Math.min(compact ? 9 : 22, gw * 0.34));
  const decimals = tickDecimals(axis.step);
  const names = compact ? narrowMonths(locale) : shortMonths(locale);
  const long = monthNames(locale, "long");
  const kwh = t("energy.units.kwh");
  const sel = result.months[month];
  // a compact axis labels every other month (I, III, V ...) and the selected one, whose neighbours then give way
  const showLabel = (i: number) => !compact || i === month || (i % 2 === 0 && Math.abs(i - month) !== 1);

  return (
    <figure className="chart chart-monthly" ref={ref}>
      <p className="chart-readout small" aria-live="polite">
        <b>{long[month]}</b>
        <span>{t("energy.charts.consumption")} <span className="num">{f.unit(sel.elTotalKwh, kwh)}</span></span>
        <span><i className="dot s-pv" aria-hidden />{t("energy.charts.production")} <span className="num">{f.unit(sel.pvKwh, kwh)}</span></span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("energy.charts.monthlyAria")}>
        <HatchDef id={hatch} />
        {axis.ticks.map((v) => (
          <g key={v}>
            <line className={v === 0 ? "chart-base" : "chart-grid"} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="chart-axis" x={L - 8} y={y(v) + 4} textAnchor="end">{f.num(v, decimals)}</text>
          </g>
        ))}
        <text className="chart-axis" x={0} y={T - 12}>{t("energy.charts.axisKwh")}</text>
        {result.months.map((m, i) => {
          const cx = L + i * gw + gw / 2;
          const x0 = px(cx - bw - 1);
          let acc = 0;
          return (
            <g key={i} onClick={() => onMonth(i)} className={i === month ? "chart-month on" : "chart-month"}>
              <rect className="chart-pick" x={px(L + i * gw + 1)} y={T - 6} width={px(gw - 2)} height={H - T - B + 6} rx={4} />
              {parts.map((k) => {
                const v = values[k][i];
                const top = y(acc + v), h = px(y(acc) - top);
                acc += v;
                if (h <= 0.2) return null;
                return (
                  <g key={k}>
                    <rect className={`s-${k}`} x={x0} y={top} width={bw} height={h} />
                    {HATCHED.has(k) && <rect fill={`url(#${hatch})`} x={x0} y={top} width={bw} height={h} />}
                  </g>
                );
              })}
              {pv[i] > 0 && (
                <>
                  <rect className="s-pv-area" x={px(cx + 1)} y={y(pv[i])} width={bw} height={px(Math.max(0, y(0) - y(pv[i])))} />
                  <line className="s-pv-cap" x1={px(cx + 1)} x2={px(cx + 1 + bw)} y1={y(pv[i]) + 1} y2={y(pv[i]) + 1} />
                </>
              )}
              {showLabel(i) && <text className="chart-axis chart-axis-x" x={px(cx)} y={H - 7} textAnchor="middle">{names[i]}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend small">
        {parts.map((k) => <span key={k}><i className={`dot s-${k}${HATCHED.has(k) ? " hatch" : ""}`} aria-hidden />{labels[k]}</span>)}
        <span><i className="dot s-pv" aria-hidden />{t("energy.charts.production")}</span>
      </figcaption>
      <div className="sr-only">
        <table>
          <caption>{t("energy.charts.monthlyAria")}</caption>
          <thead><tr><th>{t("energy.charts.tableMonth")}</th><th>{t("energy.charts.tableConsumption")}</th><th>{t("energy.charts.tableProduction")}</th></tr></thead>
          <tbody>
            {result.months.map((m, i) => (
              <tr key={i}><th>{long[i]}</th><td>{f.unit(m.elTotalKwh, kwh)}</td><td>{f.unit(m.pvKwh, kwh)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
