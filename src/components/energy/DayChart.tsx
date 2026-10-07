"use client";

// One typical day hour by hour: what covers the consumption (roof directly, battery, grid) and the production curve. The flows
// are those of the calculation: either the average over the four day types of the month or one of them.

import { monthNames } from "@/lib/calendar";
import type { DayFlows, EnergyResult } from "@/lib/calc/energy";
import { Chips } from "@/components/ui/controls";
import { useNarrow } from "@/components/ui/useNarrow";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { niceMax, px, tickDecimals, ticks } from "./chartScale";

const sum = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0);

type Kind = "average" | "clear" | "partly" | "overcast" | "dark";

export function DayChart({ result, month, kind, onKind }: { result: EnergyResult; month: number; kind: Kind; onKind: (k: Kind) => void }) {
  const t = useT();
  const f = useFormat();
  const locale = useLocale();
  const narrow = useNarrow();
  const day = result.days[month];
  const flows: DayFlows = kind === "average" ? day : (day.types.find((x) => x.key === kind) ?? day);
  const monthName = monthNames(locale, "long")[month];

  const W = narrow ? 320 : 720, H = narrow ? 230 : 270, L = narrow ? 38 : 44, B = 26, T = 16, R = 6, fs = 11;
  const max = niceMax(Math.max(...flows.load, ...flows.pv) * 1.05);
  const y = (v: number) => px(T + (H - T - B) * (1 - v / max));
  const gw = px((W - L - R) / 24);
  const decimals = tickDecimals(max / 2);
  const layers = [
    { key: "direct", label: t("energy.charts.direct"), v: flows.direct, cls: "s-pv" },
    { key: "fromBattery", label: t("energy.charts.fromBattery"), v: flows.fromBattery, cls: "s-battery" },
    { key: "fromGrid", label: t("energy.charts.fromGrid"), v: flows.fromGrid, cls: "s-grid" },
  ];
  const line = flows.pv.map((v, h) => `${h ? "L" : "M"}${px(L + h * gw + gw / 2)},${y(v)}`).join("");
  const step = narrow ? 6 : 3;

  return (
    <div className="day-chart">
      <Chips
        label={t("energy.charts.dayType")}
        options={(["average", "clear", "partly", "overcast", "dark"] as const).map((k) => ({ value: k, label: t(`energy.dayType.${k}`) }))}
        selected={[kind]}
        onToggle={onKind}
      />
      <figure className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("energy.charts.dayAria", { month: monthName })}>
          {ticks(max, 2).map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
              <text className="chart-axis" x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={fs}>{f.num(v, decimals)}</text>
            </g>
          ))}
          <text className="chart-axis" x={L} y={T - 5} fontSize={fs}>{t("energy.charts.axisKwhHour")}</text>
          {flows.load.map((_, h) => {
            let acc = 0;
            return (
              <g key={h}>
                {layers.map((l) => {
                  const top = y(acc + l.v[h]), height = px(y(acc) - top);
                  acc += l.v[h];
                  return height > 0.2 ? <rect key={l.key} className={l.cls} x={px(L + h * gw + 1.5)} y={top} width={px(gw - 3)} height={height} /> : null;
                })}
                {h % step === 0 && <text className="chart-axis" x={px(L + h * gw + gw / 2)} y={H - 8} textAnchor="middle" fontSize={fs}>{h}</text>}
              </g>
            );
          })}
          <path className="chart-line" d={line} />
        </svg>
        <figcaption className="legend small">
          {layers.map((l) => <span key={l.key}><i className={`dot ${l.cls}`} />{l.label} {f.unit(sum(l.v), t("energy.units.kwh"), 1)}</span>)}
          <span><i className="swatch-line" />{t("energy.charts.dayProduction", { pv: f.unit(sum(flows.pv), t("energy.units.kwh"), 1), export: f.unit(sum(flows.toGrid), t("energy.units.kwh"), 1) })}</span>
        </figcaption>
      </figure>
    </div>
  );
}
