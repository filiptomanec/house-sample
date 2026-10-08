"use client";
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createTerrain } from "@/lib/model/site/terrain";
import type { XY } from "@/lib/model/site/geometry";
import { Chips, Segmented } from "@/components/ui/controls";
import { useFormat, useT } from "@/lib/i18n/client";
import { buildContours } from "./contours";
import { absolute, signed } from "./fmt";
import { K, cornerWidgets, frameFor, fromScreen, scaleLength, toScreen, toUnits } from "./labels";
import { MapLayers, type Layers } from "./MapLayers";
import { MapText } from "./MapText";
import { MeasurePanel } from "./MeasurePanel";
import { useSize } from "./useWidth";
import type { PlotView } from "./view";

type North = "true" | "drawing";
type LayerKey = keyof Layers;

/** Metres of margin around the plot on the map. */
const PAD = 9;
/** Pixels per drawing unit assumed before the map has been measured (server render): a desktop width. */
const ASSUMED_SCALE = 1.5;
const LAYER_KEYS: readonly LayerKey[] = ["contours", "heights", "boundary", "setbacks"];

export function PlotTool({ view, facts }: { view: PlotView; facts: ReactNode }) {
  const t = useT(), f = useFormat();
  const svg = useRef<SVGSVGElement>(null);
  const [north, setNorth] = useState<North>("true");
  const [layers, setLayers] = useState<Layers>({ contours: true, heights: false, boundary: true, setbacks: true });
  const [pick, setPick] = useState<XY[]>([]);
  const [hover, setHover] = useState<XY | null>(null);

  const terrain = useMemo(() => createTerrain(view.terrain, view.bearingDeg), [view.terrain, view.bearingDeg]);
  const contours = useMemo(() => buildContours(terrain, view.plot, 18, (rel) => signed(f, rel, 1)), [terrain, view.plot, f]);

  const rot = north === "true" ? view.bearingDeg : 0;
  const c = useMemo(() => toUnits(view.center), [view.center]);
  const frame = useMemo(() => frameFor(view.plot, rot, c, PAD), [view.plot, rot, c]);
  const size = useSize(svg);
  // pixels per drawing unit: the SVG is letterboxed when its height is capped, so both directions count
  const s = Math.round((size ? Math.min(size.w / frame.w, size.h / frame.h) : ASSUMED_SCALE) * 50) / 50;

  const toHouse = (e: { clientX: number; clientY: number }): XY => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return fromScreen([p.x, p.y], rot, c);
  };
  const onMove = (e: PointerEvent) => { if (e.pointerType === "mouse") setHover(toHouse(e)); };
  const onClick = (e: MouseEvent) => {
    const q = toHouse(e);
    setHover(null);
    setPick((a) => (a.length >= 2 ? [q] : [...a, q]));
  };
  const onPick = (i: 0 | 1, p: XY | null) => {
    setHover(null);
    setPick((cur) => (!p ? cur.slice(0, i) : i === 0 ? [p, ...cur.slice(1, 2)] : [cur[0], p]));
  };

  const line = pick.length === 2 ? ([pick[0], pick[1]] as const) : pick.length === 1 && hover ? ([pick[0], hover] as const) : null;
  const mapLabel = view.setbacks.map((sb) => `${t(`plot.map.sideName.${sb.side}`)} ${f.length(sb.d, 1)}`);
  const turn = `rotate(${rot} ${c[0]} ${c[1]})`;
  // the distance written on the map, upright at the middle of the line (the panel below the map may be off screen on a phone)
  const tag = line ? { at: toScreen([(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2], rot, c), text: f.length(Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]), 1) } : null;
  // north arrows: the screen direction of true north and of the drawing's +y axis
  const trueAngle = rot - view.bearingDeg, drawAngle = rot;
  const bar = scaleLength(frame.w / K), px = (v: number) => v / s;
  const corner = cornerWidgets(frame, s, bar);

  const layerOptions = LAYER_KEYS.map((k) => ({ value: k, label: t(`plot.layer.${k}`) }));
  const on = LAYER_KEYS.filter((k) => layers[k]);
  const readout = hover
    ? t("plot.map.readout", { abs: absolute(f, terrain.groundAt(hover[0], hover[1]), view.zeroLevelAsl), rel: signed(f, terrain.groundAt(hover[0], hover[1]), 2) })
    : t("plot.map.hint");

  return (
    <div className="shell pt-tool">
      <div className="pt-bar">
        <Segmented ariaLabel={t("plot.map.orientation")} value={north} onChange={setNorth}
          options={[{ value: "true", label: t("plot.map.trueNorth") }, { value: "drawing", label: t("plot.map.drawingNorth") }]} />
        <Chips ariaLabel={t("plot.map.layers")} options={layerOptions} selected={on} onToggle={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))} />
      </div>
      <div className="pt-layout">
        <div className="pt-stage panel">
          <svg ref={svg} className="pt-svg" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} role="img"
            aria-label={t("plot.map.aria", { setbacks: f.list(mapLabel) })}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={onClick}>
            {/* wider than the frame: the SVG box can be wider than the viewBox (letterboxing), and that strip must not show the panel */}
            <rect className="pt-bg" x={frame.x - frame.w} y={frame.y - frame.h} width={frame.w * 3} height={frame.h * 3} />
            <g transform={turn}><MapLayers view={view} layers={layers} contours={contours.paths} /></g>
            {line && (
              <g transform={turn} className="pt-measure" pointerEvents="none">
                <path className="pt-measure-line" d={`M${line[0][0] * K} ${-line[0][1] * K}L${line[1][0] * K} ${-line[1][1] * K}`} />
                {line.map((p, i) => <circle key={i} className="pt-measure-dot" cx={p[0] * K} cy={-p[1] * K} r={px(5)} />)}
              </g>
            )}
            <MapText view={view} rot={rot} c={c} frame={frame} s={s} layers={layers} terrain={terrain} contourLabels={contours.labels} />
            {tag && (
              <g className="pt-measure-tag" aria-hidden="true" pointerEvents="none" transform={`translate(${tag.at[0]} ${tag.at[1]}) scale(${1 / s})`}>
                <rect x={-(tag.text.length * 7.4 + 16) / 2} y={-36} width={tag.text.length * 7.4 + 16} height={22} rx={6} />
                <text y={-20.5} textAnchor="middle">{tag.text}</text>
              </g>
            )}
            {/* north arrows in the corner, upright: true north (large) and the +y axis of the drawing (small) */}
            <g className="pt-north" aria-hidden="true" transform={`translate(${corner.north[0]} ${corner.north[1]}) scale(${1 / s})`}>
              <g transform={`rotate(${trueAngle})`}>
                <path className="pt-arrow" d="M0 -36L10 12L0 5L-10 12Z" />
              </g>
              <text className="pt-arrow-n" y="-46" textAnchor="middle">{t("plot.map.side.N")}</text>
              <g transform="translate(-52 0)">
                <g transform={`rotate(${drawAngle})`}>
                  <path className="pt-arrow-draw" d="M0 14L0 -26M-5 -19L0 -28L5 -19" />
                </g>
                <text className="pt-arrow-label" y="-36" textAnchor="middle">{t("plot.map.drawing")}</text>
              </g>
            </g>
            {/* scale bar */}
            <g className="pt-scale" aria-hidden="true" transform={`translate(${corner.scale[0]} ${corner.scale[1]})`}>
              {[0, 1].map((i) => <rect key={i} className="pt-scale-seg" data-odd={i === 1} x={(i * bar * K) / 2} y={0} width={(bar * K) / 2} height={px(6)} />)}
              <text className="pt-scale-text" x={0} y={px(20)} fontSize={px(11)}>0</text>
              <text className="pt-scale-text" x={bar * K} y={px(20)} fontSize={px(11)} textAnchor="end">{f.length(bar, 0)}</text>
            </g>
          </svg>
          <p className={hover ? "pt-readout mono" : "pt-readout"}>{readout}</p>
          <ul className="legend pt-legend" aria-label={t("plot.legend.title")}>
            {(["house", "roof", "paving", "terrace", "tree", "hedge", "fence", "buildable"] as const).map((k) => (
              <li key={k}><i className={`pt-sw pt-sw-${k}`} aria-hidden="true" />{t(`plot.legend.${k}`)}</li>
            ))}
          </ul>
        </div>
        <aside className="pt-side stack">
          <MeasurePanel view={view} terrain={terrain} pick={pick} onPick={onPick} onClear={() => { setPick([]); setHover(null); }} />
          {facts}
        </aside>
      </div>
    </div>
  );
}
