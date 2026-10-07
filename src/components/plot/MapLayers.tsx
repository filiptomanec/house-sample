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

/**
 * The turned part of the map: ground, surfaces, planting, house and lines. Everything is drawn in house-frame metres
 * (K units per metre, y down) and the whole group is turned by the parent. Classes carry the colours (plot.css, tokens only).
 */
export const MapLayers = memo(function MapLayers({ view, layers, contours }: { view: PlotView; layers: Layers; contours: readonly ContourPath[] }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const b = bboxOf(view.plot), m = 40;
  const maskBox = { x: (b.x0 - m) * K, y: -(b.y1 + m) * K, w: (b.x1 - b.x0 + 2 * m) * K, h: (b.y1 - b.y0 + 2 * m) * K };
  const roofs = view.house.roofs;
  return (
    <g className="pt-turn">
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
        {view.outdoor.map((o, i) => <polygon key={i} className="pt-outdoor" data-type={o.type} data-covered={o.covered} points={pts(o.polygon)} />)}
      </g>

      {layers.contours && (
        <g className="pt-contours">
          {contours.map((c, i) => <path key={i} className="pt-contour" data-major={c.major} d={c.d} />)}
        </g>
      )}

      <g className="pt-planting">
        {view.hedges.map((h, i) => <path key={i} className="pt-hedge" d={pathData(h.path, false)} style={{ strokeWidth: h.width * K }} />)}
        {view.fences.map((f, i) => f.parts.map((p, j) => <path key={`${i}-${j}`} className="pt-fence" data-kind={f.kind} d={pathData(p, false)} />))}
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
      {view.outdoor.flatMap((o, i) => o.posts.map((p, j) => { const [x, y] = toUnits(p); return <circle key={`${i}-${j}`} className="pt-post" cx={x} cy={y} r={1.6} />; }))}

      <g className="pt-house">
        <polygon className="pt-walls" points={pts(view.house.outline)} />
        {view.house.garages.map((g, i) => <polygon key={i} className="pt-garage" points={pts(g)} />)}
        <polygon className="pt-walls-line" points={pts(view.house.outline)} />
      </g>

      <g className="pt-trees">
        {view.shrubs.map((s, i) => { const [x, y] = toUnits(s.pos); return <circle key={i} className="pt-shrub" cx={x} cy={y} r={(s.width / 2) * K} />; })}
        {view.trees.map((t, i) => { const [x, y] = toUnits(t.pos); return <g key={i}><circle className="pt-crown" cx={x} cy={y} r={(t.crown / 2) * K} /><circle className="pt-trunk" cx={x} cy={y} r={2.2} /></g>; })}
      </g>

      {layers.boundary && (
        <g className="pt-bounds">
          <polygon className="pt-buildable" points={pts(view.buildable)} />
          <polygon className="pt-boundary" points={pts(view.plot)} />
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
