"use client";
import { useFormat } from "@/lib/i18n/client";
import { MONO_W, clamp, fontSizes } from "@/lib/plan/labels";
import { measure } from "@/lib/plan/myFurniture";
import type { PlanPt } from "@/lib/plan/shared";
import { Txt } from "./Txt";

/** Marks of the measuring tool: two points, the line between them and its length, and the keyboard cursor. Points are in plan space. */
export function MeasureLayer({ pts, cursor, scale }: { pts: readonly PlanPt[]; cursor: PlanPt | null; scale: number }) {
  const f = useFormat(), fs = fontSizes(scale).ui * 1.15, r = clamp(5 / scale, 0.08, 0.25);
  const two = pts.length === 2 ? measure(pts[0], pts[1]) : null;
  const text = two ? f.length(two.length) : "";
  const w = text.length * MONO_W * fs + fs * 1.2;
  return (
    <g aria-hidden="true" pointerEvents="none" className="pl-measure">
      {two && <line x1={pts[0][0]} y1={pts[0][1]} x2={pts[1][0]} y2={pts[1][1]} className="pl-measure-line" />}
      {cursor && <circle cx={cursor[0]} cy={cursor[1]} r={r * 1.6} className="pl-measure-cursor" />}
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={r} className="pl-measure-dot" />)}
      {two && (
        <g transform={`translate(${(pts[0][0] + pts[1][0]) / 2} ${(pts[0][1] + pts[1][1]) / 2 - fs * 1.4})`}>
          <rect x={-w / 2} y={-fs * 0.95} width={w} height={fs * 1.7} rx={fs * 0.3} className="pl-measure-tag" />
          <Txt x={0} y={fs * 0.32} fs={fs} textAnchor="middle" className="pl-measure-text">{text}</Txt>
        </g>
      )}
    </g>
  );
}
