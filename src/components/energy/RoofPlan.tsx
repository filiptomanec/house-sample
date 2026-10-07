"use client";

// The roof seen from above, in the house frame (x east, y north up): the roof planes, the placed panels, the outline of the
// walls. Planes that can carry panels are switches: a tap (or Enter, Space) leaves a plane out or brings it back. Everything
// is drawn from the model's roof faces and the panel layout; the drawing knows no plane by name.

import { useId, type KeyboardEvent } from "react";
import type { Pt } from "@/lib/model/geom";
import type { PanelLayout, RoofPlane } from "@/lib/calc/roofLayout";
import { useFormat, useT } from "@/lib/i18n/client";
import { px } from "./chartScale";

/** Drawing unit: decimetres, so that the font sizes in SVG units stay well above the size at which WebKit rounds glyph widths. */
const U = 10;
const MARGIN = 14;

const points = (pts: readonly (readonly number[])[]): string => pts.map(([x, y]) => `${(x * U).toFixed(1)},${(-y * U).toFixed(1)}`).join(" ");

export function RoofPlan({ planes, layout, outline, bearingDeg, onToggle }: {
  planes: readonly RoofPlane[];
  layout: PanelLayout;
  outline: readonly (readonly Pt[])[];
  bearingDeg: number;
  onToggle: (key: string) => void;
}) {
  const t = useT();
  const f = useFormat();
  const hatch = useId();
  const all = [...planes.flatMap((p) => p.faces.flatMap((face) => face.pts)), ...outline.flat()];
  const xs = all.map((p) => p[0] * U), ys = all.map((p) => -p[1] * U);
  const x0 = Math.min(...xs) - MARGIN, y0 = Math.min(...ys) - MARGIN;
  const w = Math.max(...xs) + MARGIN - x0, h = Math.max(...ys) + MARGIN - y0;
  const info = new Map(layout.planes.map((p) => [p.key, p]));

  return (
    <svg className="roof-plan" viewBox={`${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`} role="group" aria-label={t("energy.roof.planeAria")}>
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="roof-hatch" x1="0" y1="0" x2="0" y2="5" />
        </pattern>
      </defs>
      {outline.map((ring, i) => <polygon key={i} className="roof-outline" points={points(ring)} />)}
      {planes.map((plane) => {
        const pl = info.get(plane.key);
        const capacity = pl?.capacity ?? 0, placed = pl?.placed ?? 0, on = pl?.enabled ?? false;
        const biggest = plane.faces.reduce((a, b) => (b.area > a.area ? b : a));
        const name = t("energy.roof.planeLabel", { dir: t(`energy.dir.${plane.side}`), area: f.area(plane.area, 0) });
        const toggle = capacity > 0 ? () => onToggle(plane.key) : undefined;
        const onKey = (e: KeyboardEvent) => {
          if (toggle && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggle();
          }
        };
        const interactive = toggle
          ? { role: "switch", tabIndex: 0, "aria-checked": on, "aria-label": t(on ? "energy.roof.planeOn" : "energy.roof.planeOff", { name, placed: f.int(placed), capacity: f.int(capacity) }), onClick: toggle, onKeyDown: onKey }
          : { "aria-hidden": true };
        return (
          <g key={plane.key} className={`roof-plane${toggle ? " can" : ""}${on ? "" : " off"}`} {...interactive}>
            <title>{name}</title>
            {plane.faces.map((face) => <polygon key={face.id} className="roof-face" points={points(face.pts)} style={on ? undefined : { fill: `url(#${hatch})` }} />)}
            {layout.panels.filter((p) => p.planeKey === plane.key).map((p) => <polygon key={p.id} className="roof-pv" points={points(p.corners)} />)}
            {capacity > 0 && (
              <text className={`roof-label${placed > 0 ? " on-pv" : ""}`} x={px(biggest.centroid[0] * U)} y={px(-biggest.centroid[1] * U)} textAnchor="middle" dominantBaseline="central">
                {on ? `${placed}/${capacity}` : t("energy.roof.off")}
              </text>
            )}
          </g>
        );
      })}
      <g className="roof-north" transform={`translate(${(x0 + w - MARGIN - 6).toFixed(1)},${(y0 + MARGIN + 12).toFixed(1)}) rotate(${-bearingDeg})`} aria-hidden>
        <path d="M0,-11 L5,6 L0,3 L-5,6 Z" />
        <text y="19" textAnchor="middle">{t("energy.roof.northLetter")}</text>
      </g>
    </svg>
  );
}
