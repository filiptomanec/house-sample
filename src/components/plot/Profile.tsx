"use client";
import { useMemo, useRef } from "react";
import type { Profile as ProfileData } from "@/lib/model/site/profile";
import { useFormat, useT } from "@/lib/i18n/client";
import { signed } from "./fmt";
import { useWidth } from "./useWidth";

const H = 170, M = { t: 10, r: 10, b: 26 };

/** Round tick values covering [lo, hi], at most about `count` of them. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = Math.max(hi - lo, 1e-9), raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Elevation profile between two points (heights relative to the finished floor), drawn at the width of its box. */
export function Profile({ data }: { data: ProfileData }) {
  const t = useT(), f = useFormat();
  const box = useRef<HTMLDivElement>(null);
  const W = Math.round(useWidth(box) ?? 320);
  const g = useMemo(() => {
    const pad = Math.max(0.1, (data.zMax - data.zMin) * 0.15);
    const lo = Math.min(data.zMin, 0) - pad, hi = Math.max(data.zMax, 0) + pad;
    const ticks = niceTicks(lo, hi, 4), digits = ticks.some((v) => Math.abs(v * 10 - Math.round(v * 10)) > 1e-6) ? 2 : 1;
    const labelW = Math.max(...ticks.map((v) => signed(f, v, digits).length)) * 6.6 + 10;
    const l = Math.round(labelW);
    const X = (s: number) => l + (s / (data.length || 1)) * (W - l - M.r);
    const Y = (z: number) => M.t + ((hi - z) / (hi - lo)) * (H - M.t - M.b);
    const line = data.points.map((p, i) => `${i ? "L" : "M"}${X(p.s).toFixed(1)} ${Y(p.z).toFixed(1)}`).join("");
    return { ticks, digits, l, X, Y, line, area: `${line}L${X(data.length).toFixed(1)} ${Y(lo).toFixed(1)}L${X(0).toFixed(1)} ${Y(lo).toFixed(1)}Z` };
  }, [data, f, W]);
  return (
    <div ref={box} className="pt-profile">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("plot.measure.profileAria", { length: f.length(data.length, 1), rise: signed(f, data.rise, 2) })}>
        {g.ticks.map((v) => (
          <g key={v}>
            <line className="pt-pf-grid" x1={g.l} x2={W - M.r} y1={g.Y(v)} y2={g.Y(v)} />
            <text className="pt-pf-text" x={g.l - 6} y={g.Y(v)} textAnchor="end" dominantBaseline="central">{signed(f, v, g.digits)}</text>
          </g>
        ))}
        <path className="pt-pf-area" d={g.area} />
        <path className="pt-pf-line" d={g.line} />
        <line className="pt-pf-zero" x1={g.l} x2={W - M.r} y1={g.Y(0)} y2={g.Y(0)} />
        <text className="pt-pf-text" x={g.l} y={H - 8}>{f.length(0, 0)}</text>
        <text className="pt-pf-text" x={W - M.r} y={H - 8} textAnchor="end">{f.length(data.length, 1)}</text>
      </svg>
    </div>
  );
}
