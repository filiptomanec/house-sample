import { memo, useMemo } from "react";
import type { ContourLabel } from "@/lib/model/site/contours";
import { nearestOnSegment, type XY } from "@/lib/model/site/geometry";
import type { Terrain } from "@/lib/model/site/terrain";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { signed } from "./fmt";
import { K, boxInFrame, boxTouchesPoly, boxesHit, cornerWidgets, gridPoints, gridSpacing, placeContourLabels, scaleLength, placeSetbackLabels, textBox, toScreen, type Box, type Frame } from "./labels";
import type { Layers } from "./MapLayers";
import type { PlotView } from "./view";

/** Font sizes on screen (px); the sizes in drawing units follow from the scale of the map. */
const PX = { setback: 12.5, house: 13, place: 11, contour: 10.5, height: 10, tree: 11.5 };

/** Texts of the map. They are not turned with the map: positions are computed in the turned frame, text stays upright. */
export const MapText = memo(function MapText({ view, rot, c, frame, s, layers, terrain, contourLabels }: {
  view: PlotView; rot: number; c: XY; frame: Frame; s: number; layers: Layers; terrain: Terrain; contourLabels: readonly ContourLabel[];
}) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const out = useMemo(() => {
    const scr = (p: readonly number[]) => toScreen(p, rot, c);
    const fs = (px: number) => px / s;
    const houseS = view.house.outline.map(scr), plotS = view.plot.map(scr);
    const outdoorS = view.outdoor.map((o) => o.polygon.map(scr));
    const taken: Box[] = [...cornerWidgets(frame, s, scaleLength(frame.w / K)).boxes];

    // the house
    const hs = fs(PX.house), hp = scr(view.house.label), houseText = t("plot.map.house");
    const houseBox = textBox(hp[0], hp[1], houseText.length, hs);
    taken.push(houseBox);

    // distances from the house to the boundary
    const sbLines = view.setbacks.map((sb) => ({ from: scr(sb.from), to: scr(sb.to) }));
    const sbTexts = view.setbacks.map((sb) => `${t(`plot.map.side.${sb.side}`)} ${f.length(sb.d, 1)}`);
    const sbBoxes = layers.setbacks ? placeSetbackLabels(sbLines, sbTexts.map((x) => x.length), fs(PX.setback), houseS, plotS, taken) : [];
    taken.push(...sbBoxes);
    const setbacks = sbBoxes.map((box, i) => ({ box, text: sbTexts[i], short: view.setbacks[i].d < view.limits.minToBoundary }));

    // the feature tree (the walnut of the name) gets its species name, under its crown or above it
    const ft = fs(PX.tree), trees: { x: number; y: number; text: string }[] = [];
    for (const tr of view.trees.filter((q) => q.feature)) {
      const [x, y] = scr(tr.pos), r = (tr.crown / 2) * K, text = tr.name[locale];
      for (const dy of [r + ft * 0.95, -(r + ft * 0.95)]) {
        const b = textBox(x, y + dy, text.length * 0.92, ft);
        if (boxInFrame(b, frame, ft * 0.4) && !taken.some((o) => boxesHit(b, o, ft * 0.3))) { trees.push({ x, y: y + dy, text }); taken.push(b); break; }
      }
    }

    // street and field names, where the map shows them
    const ps = fs(PX.place), places: { x: number; y: number; text: string }[] = [];
    const cl = view.zones.centreLine, cen = view.center;
    const onRoad = nearestOnSegment(cen, cl[0], cl[1]), rp = scr(onRoad);
    const field = view.zones.field;
    const m0: XY = [(field[0][0] + field[1][0]) / 2, (field[0][1] + field[1][1]) / 2], m1: XY = [(field[3][0] + field[2][0]) / 2, (field[3][1] + field[2][1]) / 2];
    const fp = scr([m0[0] + (m1[0] - m0[0]) * 0.12, m0[1] + (m1[1] - m0[1]) * 0.12]);
    for (const [p, key] of [[rp, "plot.map.street"], [fp, "plot.map.field"]] as const) {
      const text = t(key), b = textBox(p[0], p[1], text.length, ps);
      if (boxInFrame(b, frame, ps * 0.5) && !taken.some((o) => boxesHit(b, o, ps * 0.5))) { places.push({ x: p[0], y: p[1], text }); taken.push(b); }
    }

    // contour labels along their lines
    const fc = fs(PX.contour);
    const contours = layers.contours
      ? placeContourLabels(contourLabels, fc, rot, c, frame, { polys: [houseS, ...outdoorS], boxes: taken, lines: layers.setbacks ? sbLines : [] }, fc * 22)
      : [];
    for (const l of contours) taken.push(textBox(l.x, l.y, l.text.length, fc, l.angle));

    // spot heights on a grid
    const fh = fs(PX.height), heights: { x: number; y: number; text: string }[] = [];
    if (layers.heights) {
      for (const p of gridPoints(view.plot, gridSpacing(s * K, PX.height * 4.2))) {
        const [x, y] = scr(p), text = signed(f, terrain.groundAt(p[0], p[1]), 2);
        const b = textBox(x, y - fh * 0.95, text.length, fh);
        if (!boxInFrame(b, frame, fh) || boxTouchesPoly(b, houseS) || outdoorS.some((o) => boxTouchesPoly(b, o))) continue;
        if (taken.some((o) => boxesHit(b, o, fh * 0.3))) continue;
        taken.push(b);
        heights.push({ x, y, text });
      }
    }
    return { houseText, hp, hs, setbacks, places, ps, contours, fc, heights, fh, trees, ft };
  }, [view, rot, c, frame, s, layers, terrain, contourLabels, t, f, locale]);

  const cross = 3 / s;
  return (
    <g className="pt-texts" aria-hidden="true">
      {out.contours.map((l, i) => (
        <text key={i} className="pt-t pt-t-contour" data-major={l.major} x={l.x} y={l.y} fontSize={out.fc} textAnchor="middle" dominantBaseline="central"
          transform={l.angle ? `rotate(${l.angle} ${l.x} ${l.y})` : undefined}>{l.text}</text>
      ))}
      {out.heights.map((h, i) => (
        <g key={i}>
          <path className="pt-cross" d={`M${h.x - cross} ${h.y}H${h.x + cross}M${h.x} ${h.y - cross}V${h.y + cross}`} />
          <text className="pt-t pt-t-height" x={h.x} y={h.y - out.fh * 0.95} fontSize={out.fh} textAnchor="middle" dominantBaseline="central">{h.text}</text>
        </g>
      ))}
      {out.places.map((p, i) => <text key={i} className="pt-t pt-t-place" x={p.x} y={p.y} fontSize={out.ps} textAnchor="middle" dominantBaseline="central">{p.text}</text>)}
      {out.trees.map((p, i) => <text key={i} className="pt-t pt-t-tree" x={p.x} y={p.y} fontSize={out.ft} textAnchor="middle" dominantBaseline="central">{p.text}</text>)}
      <text className="pt-t pt-t-house" x={out.hp[0]} y={out.hp[1]} fontSize={out.hs} textAnchor="middle" dominantBaseline="central">{out.houseText}</text>
      {out.setbacks.map((l, i) => (
        <text key={i} className="pt-t pt-t-setback" data-short={l.short} x={l.box.x} y={l.box.y} fontSize={fontOf(l.box)} textAnchor="middle" dominantBaseline="central">{l.text}</text>
      ))}
    </g>
  );
});

/** Font size of a set-back label from its box (the box height is 1.05 em). */
const fontOf = (b: Box): number => b.h / 1.05;
