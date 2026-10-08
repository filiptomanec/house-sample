import { memo, useId } from "react";
import type { XY } from "@/lib/model/site/geometry";
import { bboxOf } from "@/lib/model/site/geometry";
import type { ContourPath } from "./contours";
import { K, toUnits } from "./labels";
import { pathData } from "./contours";
import type { PlotView } from "./view";

export interface Layers { contours: boolean; heights: boolean; boundary: boolean; setbacks: boolean }

/** Polygon points in drawing units, one decimal. */
export const pts = (poly: readonly XY[]): string => poly.map((p) => { const [x, y] = toUnits(p); return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`; }).join(" ");

/** Smallest marker of a post on the map (drawing units): a real 6 cm post would vanish. */
const POST_MIN = 0.9;
/**
 * Drawing conventions of the map, in metres (not house data): how far inside the fence the parked leaf of a sliding gate is
 * drawn (the real leaf runs a few centimetres behind it, which would sit on the fence line at this scale), and the spacing of
 * the deck boards.
 */
const PARK_GAP = 0.55;
const BOARD = 0.3;

/**
 * The turned part of the map: ground, surfaces, planting, the boundary with its gates, the house and lines. Everything is
 * drawn in house-frame metres (K units per metre, y down) and the whole group is turned by the parent. Classes carry the
 * colours (plot.css, tokens only).
 */
export const MapLayers = memo(function MapLayers({ view, layers, contours }: { view: PlotView; layers: Layers; contours: readonly ContourPath[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const b = bboxOf(view.plot), m = 40;
  const maskBox = { x: (b.x0 - m) * K, y: -(b.y1 + m) * K, w: (b.x1 - b.x0 + 2 * m) * K, h: (b.y1 - b.y0 + 2 * m) * K };
  const roofs = view.house.roofs;
  const off = (p: XY, n: XY, d: number): XY => [p[0] + n[0] * d, p[1] + n[1] * d];
  const square = (p: XY, size: number, cls: string, key: string) => {
    const [x, y] = toUnits(p), h = Math.max(POST_MIN, size * K) / 2;
    return <rect key={key} className={cls} x={x - h} y={y - h} width={2 * h} height={2 * h} />;
  };
  return (
    <g className="pt-turn">
      <defs>
        {/* deck boards along the house x axis, in drawing units (the pattern turns with the map) */}
        <pattern id={`${uid}-deck`} patternUnits="userSpaceOnUse" width={BOARD * K} height={BOARD * K}>
          <rect className="pt-deck-base" width={BOARD * K} height={BOARD * K} />
          <path className="pt-deck-board" d={`M0 ${(BOARD * K) / 2}H${BOARD * K}`} />
        </pattern>
      </defs>
      <g className="pt-ground">
        <polygon className="pt-field" points={pts(view.zones.field)} />
        {view.zones.neighbours.map((n, i) => <g key={i}><polygon className="pt-nb-plot" points={pts(n.plot)} /><polygon className="pt-nb-house" points={pts(n.house)} /></g>)}
        <polygon className="pt-verge" points={pts(view.zones.verge)} />
        <polygon className="pt-road" points={pts(view.zones.carriageway)} />
        <path className="pt-road-centre" d={pathData(view.zones.centreLine, false)} />
        <polygon className="pt-plot" points={pts(view.plot)} />
      </g>

      <g className="pt-surfaces">
        {view.beds.map((bd, i) => <polygon key={i} className="pt-bed" data-kind={bd.kind} points={pts(bd.polygon)} />)}
        {view.paved.map((p, i) => <polygon key={i} className="pt-paved" data-kind={p.kind} points={pts(p.polygon)} />)}
        {view.access.map((p, i) => <polygon key={i} className="pt-paved" data-kind="access" points={pts(p)} />)}
        {view.outdoor.map((o, i) => (
          <g key={i}>
            <polygon className="pt-outdoor" data-type={o.type} data-role={o.role} data-covered={o.covered} points={pts(o.polygon)}
              style={o.role === "deck" ? { fill: `url(#${uid}-deck)` } : undefined} />
            {o.water && <polygon className="pt-water" points={pts(o.water)} />}
          </g>
        ))}
        {view.tank && (() => {
          const [x, y] = toUnits(view.tank.pos), r = (view.tank.diameter / 2) * K;
          return <g className="pt-tank"><circle className="pt-tank-body" cx={x} cy={y} r={r} /><circle className="pt-tank-lid" cx={x} cy={y} r={Math.min(r * 0.32, 0.4 * K)} /></g>;
        })()}
      </g>

      {layers.contours && (
        <g className="pt-contours">
          {contours.map((c, i) => <path key={i} className="pt-contour" data-major={c.major} d={c.d} />)}
        </g>
      )}

      {/* the legal boundary as a soft band under the fence that stands on it */}
      {layers.boundary && <polygon className="pt-boundary" points={pts(view.plot)} />}

      <g className="pt-boundary-built">
        {view.hedges.map((h, i) => <path key={i} className="pt-hedge" d={pathData(h.path, false)} style={{ strokeWidth: h.width * K }} />)}
        {view.fences.map((f, i) => f.parts.map((p, j) => <path key={`${i}-${j}`} className="pt-fence" data-kind={f.kind} d={pathData(p, false)} />))}
        {view.fences.map((f, i) => f.posts.map((p, j) => square(p, f.postSize ?? 0, "pt-fence-post", `fp${i}-${j}`)))}
        {view.gates.map((g, i) => (
          <g key={i} className="pt-gate" data-kind={g.kind}>
            {g.parkLine && (
              <polygon className="pt-gate-park" points={pts([g.parkLine[0], g.parkLine[1], off(g.parkLine[1], g.inward, PARK_GAP), off(g.parkLine[0], g.inward, PARK_GAP)])} />
            )}
            {g.swing && <path className="pt-gate-arc" d={`${pathData([g.swing.hinge, ...g.swing.arc], false)}`} />}
            {g.swing && <path className="pt-gate-open" d={pathData([g.swing.hinge, g.swing.open], false)} />}
            <polygon className="pt-gate-leaf" points={pts(g.leaf)} />
            {g.posts.map((p, j) => square(p, g.postSize, "pt-gate-post", `gp${j}`))}
          </g>
        ))}
        {view.pillars.map((p, i) => <polygon key={i} className="pt-pillar" points={pts(p.footprint)} />)}
      </g>

      <g className="pt-house">
        <polygon className="pt-walls" points={pts(view.house.outline)} />
        {view.house.garages.map((g, i) => <polygon key={i} className="pt-garage" points={pts(g)} />)}
        {view.house.roofLines.map(([a, c], i) => <path key={i} className="pt-roof-line" d={pathData([a, c], false)} />)}
        <polygon className="pt-walls-line" points={pts(view.house.outline)} />
      </g>

      <defs>
        {roofs.map((_, i) => (
          <mask key={i} id={`${uid}-m${i}`} maskUnits="userSpaceOnUse" x={maskBox.x} y={maskBox.y} width={maskBox.w} height={maskBox.h}>
            <rect x={maskBox.x} y={maskBox.y} width={maskBox.w} height={maskBox.h} fill="white" />
            {roofs.map((o, j) => (j === i ? null : <polygon key={j} points={pts(o)} fill="black" />))}
          </mask>
        ))}
      </defs>
      <g className="pt-roofs">
        {roofs.map((r, i) => <polygon key={i} className="pt-roof" points={pts(r)} mask={`url(#${uid}-m${i})`} />)}
      </g>
      {view.outdoor.flatMap((o, i) => o.posts.map((p, j) => square(p, o.postSize ?? 0, "pt-post", `p${i}-${j}`)))}

      <g className="pt-trees">
        {view.shrubs.map((s, i) => { const [x, y] = toUnits(s.pos); return <circle key={i} className="pt-shrub" cx={x} cy={y} r={(s.width / 2) * K} />; })}
        {view.trees.map((t, i) => {
          const [x, y] = toUnits(t.pos);
          return <g key={i} data-feature={t.feature}><circle className="pt-crown" cx={x} cy={y} r={(t.crown / 2) * K} /><circle className="pt-trunk" cx={x} cy={y} r={t.feature ? 3 : 2.2} /></g>;
        })}
      </g>

      {layers.boundary && (
        <g className="pt-bounds">
          <polygon className="pt-buildable" points={pts(view.buildable)} />
        </g>
      )}
      {layers.setbacks && (
        <g className="pt-setbacks">
          {view.setbacks.map((sb) => <path key={sb.side} className="pt-setback" data-short={sb.d < view.limits.minToBoundary} d={pathData([sb.from, sb.to], false)} />)}
        </g>
      )}
    </g>
  );
});
