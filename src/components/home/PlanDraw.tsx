// The floor plan drawing itself on the start page: lines draw themselves when the block scrolls into view (CSS; everything is
// visible without JavaScript and with reduced motion). A server component: the geometry comes from the plan module
// (src/lib/plan), the colours are tokens, the numbers go through the formatter.

import { getFormatter } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { viewBoxOf, type PlanDrawing } from "@/lib/plan/planGeometry";
import { pathOf, planLayers } from "@/lib/plan/svg";
import { ZONE_TOKEN, type HomeZoneKey } from "./homeFacts";

/** Rooms smaller than this get no area label (m2), and a label must fit the free span of its room. */
const MIN_LABEL_AREA = 9;
/** Label size relative to the drawing width, and the width of a character relative to the font size. */
const LABEL_SIZE = 1 / 90;
const CHAR_WIDTH = 0.62;
/** Stroke of the outline in plan metres. */
const OUTLINE_STROKE = 0.12;

export default function PlanDraw({ drawing, zoneOfRoom, locale, label }: {
  drawing: PlanDrawing;
  zoneOfRoom: Readonly<Record<string, HomeZoneKey>>;
  locale: Locale;
  label: string;
}) {
  const f = getFormatter(locale);
  const layers = planLayers(drawing);
  const fs = drawing.viewBox.w * LABEL_SIZE;
  return (
    <svg className="plan-draw rv" viewBox={viewBoxOf(drawing)} role="img" aria-label={label}>
      <g className="pd-zones">
        <g dangerouslySetInnerHTML={{ __html: layers.outdoor }} />
        {drawing.rooms.map((r) => <path key={r.id} d={pathOf(r.rings)} fill={`var(${ZONE_TOKEN[zoneOfRoom[r.id] ?? "service"]})`} fillRule="evenodd" />)}
      </g>
      <g className="pd-walls" dangerouslySetInnerHTML={{ __html: layers.walls }} />
      <g className="pd-open" dangerouslySetInnerHTML={{ __html: layers.openings + layers.posts }} />
      <path className="pd-line" d={pathOf(drawing.outline)} pathLength={1} fill="none" stroke="var(--ink)" strokeWidth={OUTLINE_STROKE} strokeLinejoin="round" />
      <g className="pd-labels" fontSize={fs} textAnchor="middle" fontFamily="var(--font-mono), monospace" fill="var(--ink)">
        {drawing.rooms.filter((r) => {
          const text = f.num(r.area, 1);
          return r.area >= MIN_LABEL_AREA && r.label.spanX[1] - r.label.spanX[0] >= text.length * fs * CHAR_WIDTH;
        }).map((r) => <text key={r.id} x={r.label.at[0]} y={r.label.at[1] + fs * 0.35}>{f.num(r.area, 1)}</text>)}
      </g>
      <g className="pd-north">
        <g dangerouslySetInnerHTML={{ __html: layers.compass }} />
        <text x={drawing.scale.at[0] + drawing.scale.length / 2} y={drawing.scale.at[1] + fs * 1.6} fontSize={fs} textAnchor="middle" fontFamily="var(--font-mono), monospace" fill="var(--ink-2)">{f.length(drawing.scale.length, 0)}</text>
      </g>
    </svg>
  );
}
