"use client";

// The roof seen from above, in the house frame (x east, y north up): the roof planes, the placed panels (dark, as real panels
// are), the outline of the walls and a north symbol outside the drawing. Planes that can carry panels are switches: a tap (or
// Enter, Space) leaves a plane out or brings it back. Everything is drawn from the model's roof faces and the panel layout; the
// drawing knows no plane by name. It is drawn at its measured width, so the labels keep their size on every screen; a label sits
// at the pole of inaccessibility of its plane and is left out when the plane is too narrow for it.

import { useId, useRef, type KeyboardEvent } from "react";
import type { Pt } from "@/lib/model/geom";
import { poleOfInaccessibility } from "@/lib/model/polylabel";
import type { PanelLayout, RoofPlane } from "@/lib/calc/roofLayout";
import { useWidth } from "@/components/ui/useWidth";
import { useFormat, useT } from "@/lib/i18n/client";
import { px } from "./chartScale";

/** Width assumed before the drawing is measured (server markup), padding and the column kept free for the north symbol, px. */
const FALLBACK = 460;
const PAD = 8;
const NORTH_COL = 48;
const NORTH_R = 12;
/** Label metrics: Geist Mono at --fs-2xs (11 px), about 0.62 em per character, and the room a label needs around it. */
const LABEL_PX = 11;
const CHAR_PX = LABEL_PX * 0.62;

/** Width of a polygon along the horizontal line through `p`: the inside interval that contains p.x (0 when p is outside). */
export function spanAt(pts: readonly Pt[], p: Pt): number {
  const xs: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    if ((ay <= p[1] && by > p[1]) || (by <= p[1] && ay > p[1])) xs.push(ax + ((p[1] - ay) / (by - ay)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i] <= p[0] && p[0] <= xs[i + 1]) return xs[i + 1] - xs[i];
  return 0;
}

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
  const ref = useRef<HTMLDivElement>(null);
  const measured = useWidth(ref);
  const W = Math.max(240, Math.round(measured ?? FALLBACK));

  const all = [...planes.flatMap((p) => p.faces.flatMap((face) => face.pts)), ...outline.flat()];
  const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
  const s = (W - NORTH_COL - 2 * PAD) / Math.max(1e-6, maxX - minX); // px per metre
  const H = Math.max(Math.round((maxY - minY) * s + 2 * PAD), 2 * (PAD + NORTH_R * 1.5 + 9 + 2)); // room for the north symbol in any direction
  const X = (x: number) => px(PAD + (x - minX) * s);
  const Y = (y: number) => px(PAD + (maxY - y) * s);
  const points = (pts: readonly (readonly number[])[]): string => pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ");
  const info = new Map(layout.planes.map((p) => [p.key, p]));

  // north: the house +y axis points to the azimuth bearingDeg, so true north is turned by -bearingDeg on the drawing
  const a = (-bearingDeg * Math.PI) / 180, reach = NORTH_R * 1.5 + 9;
  const nx = W - NORTH_COL / 2, ny = PAD + reach + 2;

  return (
    <div className="roof-plan-wrap" ref={ref}>
      <svg className="roof-plan" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t("energy.roof.planeAria")}>
        <defs>
          <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line className="roof-hatch" x1="0" y1="0" x2="0" y2="5" />
          </pattern>
        </defs>
        {outline.map((ring, i) => <polygon key={i} className="roof-outline" points={points(ring)} />)}
        {planes.map((plane) => {
          const pl = info.get(plane.key);
          const capacity = pl?.capacity ?? 0, placed = pl?.placed ?? 0, on = pl?.enabled ?? false;
          const biggest = plane.faces.reduce((acc, b) => (b.area > acc.area ? b : acc));
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
          // the label: at the point of the biggest face farthest from its edges, only when the face is wide enough there
          const text = on ? `${f.int(placed)}/${f.int(capacity)}` : t("energy.roof.off");
          const pole = poleOfInaccessibility([biggest.pts.map((p) => [p[0], p[1]] as Pt)], 0.05);
          const fits = capacity > 0 && pole.r * s * 2 >= LABEL_PX + 4 && spanAt(biggest.pts, [pole.x, pole.y]) * s >= text.length * CHAR_PX + 10;
          return (
            <g key={plane.key} className={`roof-plane${toggle ? " can" : ""}${on ? "" : " off"}${on && placed > 0 ? " has-pv" : ""}`} {...interactive}>
              <title>{name}</title>
              {plane.faces.map((face) => <polygon key={face.id} className="roof-face" points={points(face.pts)} style={on ? undefined : { fill: `url(#${hatch})` }} />)}
              {layout.panels.filter((p) => p.planeKey === plane.key).map((p) => <polygon key={p.id} className="roof-pv" points={points(p.corners)} />)}
              {fits && (
                <g className="roof-tag" transform={`translate(${X(pole.x)} ${Y(pole.y)})`}>
                  <rect x={px(-(text.length * CHAR_PX) / 2 - 6)} y={-LABEL_PX / 2 - 4} width={px(text.length * CHAR_PX + 12)} height={LABEL_PX + 8} rx={(LABEL_PX + 8) / 2} />
                  <text textAnchor="middle" dominantBaseline="central">{text}</text>
                </g>
              )}
            </g>
          );
        })}
        <g className="roof-north" aria-hidden="true">
          <g transform={`translate(${px(nx)} ${px(ny)}) rotate(${px(-bearingDeg)})`}>
            <circle className="roof-north-ring" r={NORTH_R} />
            <path className="roof-north-ink" d={`M0,${-NORTH_R * 1.5}L${-NORTH_R * 0.45},${NORTH_R * 0.75}L0,${NORTH_R * 0.3}Z`} />
            <path className="roof-north-paper" d={`M0,${-NORTH_R * 1.5}L${NORTH_R * 0.45},${NORTH_R * 0.75}L0,${NORTH_R * 0.3}Z`} />
          </g>
          <text className="roof-north-letter" x={px(nx + Math.sin(a) * reach)} y={px(ny - Math.cos(a) * reach)} textAnchor="middle" dominantBaseline="central">{t("energy.roof.northLetter")}</text>
        </g>
      </svg>
    </div>
  );
}
