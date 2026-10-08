"use client";
import { useMemo, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref, type SVGProps } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { NBSP } from "@/lib/i18n/format";
import { PLAN_FILL, pathOf, viewBoxOf, type PlanPt, type PlanRect } from "@/lib/plan/shared";
import { clamp, fontSizes, layoutOutdoorLabels, layoutRoomLabels, layoutWindowLabels, type Box } from "@/lib/plan/labels";
import type { PlanView } from "@/lib/plan/view";
import { Txt } from "./Txt";

export type PlanMode = "rooms" | "measure" | "furniture";

type SvgHandlers = Pick<SVGProps<SVGSVGElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onPointerLeave" | "onClick" | "onKeyDown">;

/** Markup of a static layer of the drawing, inserted as it is (it is built from the model by lib/plan/svg.ts, never from user input). */
const Layer = ({ cls, html }: { cls: string; html: string }) => <g className={cls} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;

/** Bounding rect of rings (plan space). */
const boundsOf = (rings: readonly (readonly PlanPt[])[]): PlanRect => {
  const xs = rings.flatMap((r) => r.map((p) => p[0])), ys = rings.flatMap((r) => r.map((p) => p[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Radius of the north symbol on screen (px) and its limits in metres (it must fit the margin of the drawing). */
const NORTH_PX = 16;

/**
 * The floor plan: static layers from the server, the interactive rooms, texts placed for the current scale and the
 * selection. `children` are drawn on top (measuring marks, furniture of the visitor).
 */
export function PlanSvg({ ref, view, mode, zones, furniture, dims, room, onRoom, scale, avoid, handlers, children }: {
  ref?: Ref<SVGSVGElement>; view: PlanView; mode: PlanMode; zones: boolean; furniture: boolean; dims: boolean;
  room: string; onRoom: (id: string) => void; scale: number; avoid: readonly Box[]; handlers: SvgHandlers; children?: ReactNode;
}) {
  const t = useT(), f = useFormat();
  const { drawing, layers } = view, vb = drawing.viewBox;
  const fs = fontSizes(scale);
  const byId = useMemo(() => new Map(drawing.rooms.map((r) => [r.id, r])), [drawing]);
  const facts = useMemo(() => new Map(view.rooms.map((r) => [r.id, r])), [view.rooms]);
  const current = byId.get(room);

  // the north symbol in the top right corner, a fixed size on screen (clamped so that it stays inside the margin)
  const north = useMemo(() => {
    const r = clamp(NORTH_PX / scale, 0.22, 0.6), letter = fs.ui * 1.05;
    const at: PlanPt = [vb.x + vb.w - r * 1.6 - 0.15, vb.y + r * 1.6 + letter * 1.3 + 0.15];
    const a = (drawing.north.angleDeg * Math.PI) / 180, reach = r * 1.5 + letter * 0.95;
    const tip: PlanPt = [at[0] + Math.sin(a) * reach, at[1] - Math.cos(a) * reach];
    return { at, r, letter, tip, box: [at[0] - r * 1.7, at[1] - r * 1.7 - letter * 1.4, at[0] + r * 1.7, at[1] + r * 1.7] as PlanRect };
  }, [scale, fs.ui, vb, drawing.north.angleDeg]);

  // texts: room numbers and areas, window sizes, names of the outdoor areas
  const roomLabels = useMemo(() => layoutRoomLabels(view.rooms.map((r) => {
    const p = byId.get(r.id)!;
    return { id: r.id, number: r.number, area: f.num(r.area, 1), at: p.label.at, spanX: p.label.spanX, spanY: p.label.spanY };
  }), scale, avoid), [view.rooms, byId, f, scale, avoid]);
  const winLabels = useMemo(() => layoutWindowLabels(drawing.openings.filter((o) => o.facade).map((o) => ({
    id: o.id, text: `${f.num(o.w * 1000)}${NBSP}×${NBSP}${f.num(o.h * 1000)}`, at: o.facade!.at, out: o.facade!.out,
  })), fs.dims, [vb.x, vb.y, vb.x + vb.w, vb.y + vb.h]), [drawing, f, fs.dims, vb]);
  const outdoorLabels = useMemo(() => {
    const sc = drawing.scale, ui = fs.ui;
    const obstacles: PlanRect[] = [
      ...drawing.rooms.flatMap((r) => r.rings.map((q) => boundsOf([q]))),
      ...drawing.furniture.map((q) => q.rect),
      north.box,
      [sc.at[0] - 0.2, sc.at[1] - ui * 2.2, sc.at[0] + sc.length + 0.4, sc.at[1] + 0.3],
    ];
    // a name set beside its area must not land on another area either
    obstacles.push(...drawing.outdoor.map((o) => o.rect));
    return layoutOutdoorLabels(view.outdoor.map((o) => ({ id: o.id, text: o.name, at: o.at, w: o.w, h: o.h, rect: o.rect })), fs.outdoor, obstacles,
      [vb.x + 0.1, vb.y + 0.1, vb.x + vb.w - 0.1, vb.y + vb.h - 0.1]);
  }, [drawing, view.outdoor, fs.outdoor, fs.ui, north.box, vb]);

  /** Arrow keys jump to the nearest room in that direction (plan space: up is -y). */
  const onRoomKey = (e: KeyboardEvent) => {
    const dir: Record<string, PlanPt> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key], here = view.rooms.find((r) => r.id === room);
    if (!d || !here) return;
    e.preventDefault();
    let best: string | null = null, score = Infinity;
    for (const q of view.rooms) {
      if (q.id === here.id) continue;
      const dx = q.at[0] - here.at[0], dy = q.at[1] - here.at[1], along = dx * d[0] + dy * d[1], across = Math.abs(dx * d[1] - dy * d[0]);
      if (along <= 0.2) continue;
      if (along + 2 * across < score) { score = along + 2 * across; best = q.id; }
    }
    if (best) {
      onRoom(best);
      // roving tabindex: the focus moves with the selection
      const root = (e.currentTarget as SVGElement).ownerSVGElement, id = best;
      requestAnimationFrame(() => root?.querySelector<SVGElement>(`[data-room="${id}"]`)?.focus({ preventScroll: true }));
    }
  };

  const inRooms = mode === "rooms";
  const ui = fs.ui;
  return (
    <svg ref={ref} viewBox={viewBoxOf(drawing)} role="group" aria-label={t("plan.drawing.label")} tabIndex={mode === "measure" ? 0 : -1}
      aria-describedby={mode === "measure" ? "measure-keys" : undefined} className="plan-svg" data-mode={mode}
      data-zones={zones ? "on" : "off"} data-furniture={furniture ? "on" : "off"} data-dims={dims ? "on" : "off"} {...handlers}>
      <Layer cls="pl-outdoor" html={layers.outdoor} />
      <g role={inRooms ? "radiogroup" : undefined} aria-label={inRooms ? t("plan.drawing.rooms") : undefined} aria-describedby={inRooms ? "plan-help" : undefined} aria-hidden={inRooms ? undefined : true}>
        {drawing.rooms.map((r, i) => {
          const v = facts.get(r.id)!;
          return (
            <path key={r.id} className="pl-room" d={pathOf(r.rings)} fillRule="evenodd" style={{ "--fill": `var(${PLAN_FILL[r.fill]})` } as CSSProperties}
              role={inRooms ? "radio" : undefined} aria-checked={inRooms ? r.id === room : undefined} tabIndex={inRooms ? (r.id === room ? 0 : -1) : undefined}
              aria-label={t("plan.drawing.roomLabel", { number: v.number, name: v.name, area: f.area(v.area, 1) })}
              data-room={r.id} data-fill={r.fill} data-i={i} onKeyDown={onRoomKey} onFocus={() => inRooms && onRoom(r.id)} onClick={() => inRooms && onRoom(r.id)} />
          );
        })}
      </g>
      <Layer cls="pl-furniture" html={layers.furniture} />
      <Layer cls="pl-fixtures" html={layers.fixtures} />
      <Layer cls="pl-walls" html={layers.walls} />
      <Layer cls="pl-openings" html={layers.openings} />
      <Layer cls="pl-posts" html={layers.posts} />
      <Layer cls="pl-dims" html={layers.dims} />
      <Layer cls="pl-compass" html={layers.scale} />
      <g className="pl-north" aria-hidden="true" transform={`translate(${north.at[0]} ${north.at[1]}) rotate(${drawing.north.angleDeg})`}>
        <circle r={north.r} className="pl-north-ring" />
        <path d={`M0,${-north.r * 1.5}L${-north.r * 0.45},${north.r * 0.75}L0,${north.r * 0.3}Z`} className="pl-north-ink" />
        <path d={`M0,${-north.r * 1.5}L${north.r * 0.45},${north.r * 0.75}L0,${north.r * 0.3}Z`} className="pl-north-paper" />
      </g>

      <g aria-hidden="true" pointerEvents="none" className="pl-text">
        {outdoorLabels.map((l) => (
          <Txt key={l.id} x={l.x} y={l.y} fs={fs.outdoor} rot={l.rot} dy={fs.outdoor * 35} halo={0.3} textAnchor="middle" className="pl-od-text" data-inside={l.inside}>{l.text}</Txt>
        ))}
        {roomLabels.map((l, i) => {
          const v = facts.get(l.id)!;
          return (
            <g key={l.id} opacity={l.dim ? 0.22 : undefined} textAnchor={l.mode === "row" ? "start" : "middle"} data-i={i}>
              <Txt x={l.number.x} y={l.number.y} fs={l.number.fs} halo={0.24} className="pl-num">{v.number}</Txt>
              {l.area && <Txt x={l.area.x} y={l.area.y} fs={l.area.fs} halo={0.24} className="pl-area">{f.num(v.area, 1)}</Txt>}
            </g>
          );
        })}
        <g className="pl-dim-text">
          {winLabels.map((l) => (
            <g key={l.id} transform={`translate(${l.x} ${l.y}) rotate(${l.rot})`}>
              <rect x={-l.len / 2} y={-l.height / 2} width={l.len} height={l.height} rx={l.height / 5} className="pl-tag" />
              <Txt x={0} y={fs.dims * 0.36} fs={fs.dims} textAnchor="middle" className="pl-tag-text">{l.text}</Txt>
            </g>
          ))}
          <Txt x={vb.x + 0.7} y={vb.y + ui * 1.5} fs={ui * 0.9} textAnchor="start" className="pl-dim-note">{t("plan.drawing.windowsNote")}</Txt>
          {drawing.dimensions.map((m) => (
            <Txt key={m.axis} x={m.text[0]} y={m.text[1]} dy={ui * 35} rot={m.axis === "depth" ? -90 : 0} halo={0.35} fs={ui} textAnchor="middle" className="pl-dim-value">{f.length(m.value)}</Txt>
          ))}
        </g>
        <g className="pl-scale-text">
          <Txt x={drawing.scale.at[0]} y={drawing.scale.at[1] - ui * 0.9} fs={ui} textAnchor="middle">0</Txt>
          <Txt x={drawing.scale.at[0] + drawing.scale.length} y={drawing.scale.at[1] - ui * 0.9} fs={ui} textAnchor="middle">{f.length(drawing.scale.length, 0)}</Txt>
          <Txt x={north.tip[0]} y={north.tip[1] + north.letter * 0.36} fs={north.letter} textAnchor="middle" className="pl-north-letter">{t("plan.drawing.north")}</Txt>
        </g>
      </g>

      {inRooms && current && (
        <g aria-hidden="true" pointerEvents="none">
          <path className="pl-sel" d={pathOf(current.net)} fillRule="evenodd" />
          <path className="pl-sel-focus" d={pathOf(current.net)} fillRule="evenodd" />
        </g>
      )}
      {children}
    </svg>
  );
}
