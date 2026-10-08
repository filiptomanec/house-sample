"use client";

// One typical day hour by hour: where the electricity comes from (straight from the roof in mint, from the battery hatched,
// from the grid in grey) and the production curve over it. The flows are the calculation's: either the weighted mean of the
// month's four day types or one of them. Drawn at its real width with 11 px axis text and round value steps.

import { useId, useRef } from "react";
import { monthNames } from "@/lib/calendar";
import { DAY_TYPE_KEYS, type DayFlows, type DayTypeKey, type EnergyResult } from "@/lib/calc/energy";
import { Segmented } from "@/components/ui/controls";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { HatchDef, useChartWidth } from "./chartParts";
import { CHART_COMPACT_WIDTH, niceTicks, px, tickDecimals } from "./chartScale";

const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0);

export type DayKind = "average" | DayTypeKey;
export const DAY_KINDS: readonly DayKind[] = ["average", ...DAY_TYPE_KEYS];

export function DayChart({ result, month, kind, onKind }: { result: EnergyResult; month: number; kind: DayKind; onKind: (k: DayKind) => void }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const hatch = useId();
  const ref = useRef<HTMLDivElement>(null);
  const W = useChartWidth(ref);
  const compact = W < CHART_COMPACT_WIDTH;
  // the height is set by .chart-day svg in energy.css (270 px, 220 px on phones); these must agree
  const H = compact ? 220 : 270;
  const L = compact ? 30 : 40, R = 2, T = 24, B = 26;

  const day = result.days[month];
  const flows: DayFlows = kind === "average" ? day : (day.types.find((x) => x.key === kind) ?? day);
  const monthName = monthNames(locale, "long")[month];
  const axis = niceTicks(Math.max(...flows.load, ...flows.pv), compact ? 3 : 4);
  const y = (v: number) => px(T + (H - T - B) * (1 - v / axis.max));
  const gw = (W - L - R) / 24;
  const bw = px(Math.max(2, gw - (compact ? 2 : 4)));
  const decimals = tickDecimals(axis.step);
  const kwh = t("energy.units.kwh");
  const layers = [
    { key: "direct", label: t("energy.charts.direct"), v: flows.direct, cls: "s-pv", hatched: false },
    { key: "fromBattery", label: t("energy.charts.fromBattery"), v: flows.fromBattery, cls: "s-battery", hatched: true },
    { key: "fromGrid", label: t("energy.charts.fromGrid"), v: flows.fromGrid, cls: "s-grid", hatched: false },
  ];
  const at = (h: number) => px(L + h * gw + gw / 2);
  const line = flows.pv.map((v, h) => `${h ? "L" : "M"}${at(h)},${y(v)}`).join("");
  const area = `${line}L${at(23)},${y(0)}L${at(0)},${y(0)}Z`;
  const step = compact ? 6 : 3;

  return (
    <div className="day-chart">
      <div className="day-kind">
        <Segmented
          label={t("energy.charts.dayType")}
          value={kind}
          options={DAY_KINDS.map((k) => ({ value: k, label: t(`energy.dayType.${k}`) }))}
          onChange={onKind}
        />
      </div>
      <figure className="chart chart-day" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("energy.charts.dayAria", { month: monthName })}>
          <HatchDef id={hatch} />
          {axis.ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? "chart-base" : "chart-grid"} x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text className="chart-axis" x={L - 8} y={y(v) + 4} textAnchor="end">{f.num(v, decimals)}</text>
            </g>
          ))}
          <text className="chart-axis" x={0} y={T - 12}>{t("energy.charts.axisKwhHour")}</text>
          <path className="chart-area" d={area} />
          {flows.load.map((_, h) => {
            let acc = 0;
            return (
              <g key={h}>
                {layers.map((l) => {
                  const v = l.v[h];
                  const top = y(acc + v), height = px(y(acc) - top);
                  acc += v;
                  if (height <= 0.2) return null;
                  const x = px(L + h * gw + (gw - bw) / 2);
                  return (
                    <g key={l.key}>
                      <rect className={l.cls} x={x} y={top} width={bw} height={height} />
                      {l.hatched && <rect fill={`url(#${hatch})`} x={x} y={top} width={bw} height={height} />}
                    </g>
                  );
                })}
                {h % step === 0 && <text className="chart-axis" x={at(h)} y={H - 7} textAnchor="middle">{f.int(h)}</text>}
              </g>
            );
          })}
          <path className="chart-line" d={line} />
        </svg>
        <figcaption className="legend small">
          {layers.map((l) => (
            <span key={l.key}><i className={`dot ${l.cls}${l.hatched ? " hatch" : ""}`} aria-hidden />{l.label} <span className="num">{f.unit(sum(l.v), kwh, 1)}</span></span>
          ))}
          <span><i className="swatch-line" aria-hidden />{t("energy.charts.dayProduction", { pv: f.unit(sum(flows.pv), kwh, 1), export: f.unit(sum(flows.toGrid), kwh, 1) })}</span>
        </figcaption>
      </figure>
    </div>
  );
}
