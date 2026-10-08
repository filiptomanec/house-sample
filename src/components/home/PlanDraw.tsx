// The floor plan drawing itself on the start page, furnished: lines draw themselves when the block scrolls into view (CSS;
// everything is visible without JavaScript and with reduced motion). Every zone fill carries `data-zone`, so the zone list beside
// it and the drawing light each other up on hover (zoneHoverCss, no JavaScript). A server component: the geometry comes from the
// plan module (src/lib/plan), the colours are tokens, the numbers go through the formatter.

import { Txt } from "@/components/plan/Txt";
import { getFormatter } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { viewBoxOf, type PlanDrawing } from "@/lib/plan/planGeometry";
import { pathOf, planLayers } from "@/lib/plan/svg";
import { ZONE_ORDER, ZONE_TOKEN, type HomeZoneKey } from "./homeFacts";

/** The zone of the outdoor areas (the terrace) and the fill of a room whose zone is unknown. */
const OUTDOOR_ZONE: HomeZoneKey = "outdoor";
const FALLBACK_ZONE: HomeZoneKey = "service";

/**
 * Rules that light up one zone while the pointer is over it, in the list or in the drawing (a block that contains both carries
 * `.plan-grid`); home.css dims every other zone first. Generated from the zone keys, so a new zone needs no new CSS.
 */
export function zoneHoverCss(keys: readonly string[] = ZONE_ORDER): string {
  // the doubled class outranks the dimming rule of home.css whatever the order of the stylesheets
  return keys.map((k) => `.plan-grid.plan-grid:has([data-zone="${k}"]:hover) [data-zone="${k}"]{opacity:1}`).join("");
}

/** Rooms smaller than this get no area label (m2), and a label must fit the free span of its room. */
const MIN_LABEL_AREA = 9;
/**
 * Label size relative to the drawing width (about 12 px on a wide screen), and the width of a character relative to the font size.
 * The texts go through `Txt`: it lays them out at a hundred times the size and scales them down, because a font size of a few
 * tenths of a unit makes some engines collapse the advance widths (the digits then print on top of each other).
 */
const LABEL_SIZE = 1 / 62;
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
        <g data-zone={OUTDOOR_ZONE} dangerouslySetInnerHTML={{ __html: layers.outdoor }} />
        {drawing.rooms.map((r) => {
          const zone = zoneOfRoom[r.id] ?? FALLBACK_ZONE;
          return <path key={r.id} d={pathOf(r.rings)} fill={`var(${ZONE_TOKEN[zone]})`} fillRule="evenodd" data-zone={zone} />;
        })}
      </g>
      <g className="pd-furn" dangerouslySetInnerHTML={{ __html: layers.furniture + layers.fixtures }} />
      <g className="pd-walls" dangerouslySetInnerHTML={{ __html: layers.walls }} />
      <g className="pd-open" dangerouslySetInnerHTML={{ __html: layers.openings + layers.posts }} />
      <path className="pd-line" d={pathOf(drawing.outline)} pathLength={1} fill="none" stroke="var(--ink)" strokeWidth={OUTLINE_STROKE} strokeLinejoin="round" />
      <g className="pd-labels" textAnchor="middle">
        {drawing.rooms.filter((r) => {
          const text = f.num(r.area, 1);
          return r.area >= MIN_LABEL_AREA && r.label.spanX[1] - r.label.spanX[0] >= text.length * fs * CHAR_WIDTH;
        }).map((r) => <Txt key={r.id} x={r.label.at[0]} y={r.label.at[1] + fs * 0.35} fs={fs}>{f.num(r.area, 1)}</Txt>)}
      </g>
      <g className="pd-north">
        <g dangerouslySetInnerHTML={{ __html: layers.compass }} />
        <Txt className="pd-scale" x={drawing.scale.at[0] + drawing.scale.length + fs * 0.7} y={drawing.scale.at[1] + fs * 0.35} fs={fs} textAnchor="start">{f.length(drawing.scale.length, 0)}</Txt>
      </g>
    </svg>
  );
}
