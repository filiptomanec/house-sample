"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Chips, Segmented, type ChipOption } from "@/components/ui/controls";
import { useLocale, useT } from "@/lib/i18n/client";
import { FURNITURE } from "@/lib/model/catalog";
import { readStored, writeStored } from "@/lib/calc/storageKeys";
import { boxesOf, clamp, placeItemLabels } from "@/lib/plan/labels";
import {
  SNAP, SNAP_COARSE, addItem, moveItem, newItem, parseItems, placeItem, rotateItem, serializeItems, snapPt, type ItemKind, type MyItem,
} from "@/lib/plan/myFurniture";
import { PLAN_FILL, type PlanPt } from "@/lib/plan/shared";
import type { PlanView } from "@/lib/plan/view";
import { FurniturePanel } from "./FurniturePanel";
import { ItemsLayer } from "./ItemsLayer";
import { MeasureLayer } from "./MeasureLayer";
import { MeasurePanel } from "./MeasurePanel";
import { PlanSvg, type PlanMode } from "./PlanSvg";
import { RoomInfo } from "./RoomInfo";
import { RoomTable } from "./RoomTable";
import { useScale } from "./useScale";

/** The enlarged plan is this wide (px); the chip is offered only where the plan is narrower. */
const ZOOM_PX = 1000;
/** Scale assumed before the SVG is measured (server render): a desktop width. */
const ASSUMED_SCALE = 36;

type LayerKey = "zones" | "furniture" | "dims" | "zoom";

export function PlanTool({ view }: { view: PlanView }) {
  const t = useT(), locale = useLocale();
  const svg = useRef<SVGSVGElement>(null), stage = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PlanMode>("rooms");
  const [on, setOn] = useState<Record<LayerKey, boolean>>({ zones: true, furniture: true, dims: false, zoom: false });
  const [room, setRoom] = useState(view.initialRoom);
  const [pts, setPts] = useState<PlanPt[]>([]), [hover, setHover] = useState<PlanPt | null>(null), [cursor, setCursor] = useState<PlanPt | null>(null);
  const [items, setItems] = useState<MyItem[]>([]), [sel, setSel] = useState<number | null>(null);
  const drag = useRef<{ off: PlanPt; moved: boolean } | null>(null), justDragged = useRef(false);
  const measured = useScale(svg, view.drawing.viewBox.w);
  const scale = measured ?? ASSUMED_SCALE;
  const { bounds, fingerprint } = view;

  // The visitor's furniture lives in the browser only, so it is read after mount (server and client markup agree).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only in the browser
  useEffect(() => { setItems(readStored("furniture", { parse: parseItems, fingerprint }) ?? []); }, [fingerprint]);
  const persist = (next: readonly MyItem[]) => { writeStored("furniture", serializeItems(next), { fingerprint }); };
  const commit = (next: MyItem[]) => { setItems(next); persist(next); };

  // On a touch screen a drag of a piece must not scroll the page; elsewhere the (enlarged) plan can still be panned.
  useEffect(() => {
    const el = svg.current;
    if (!el || mode !== "furniture") return;
    const block = (e: TouchEvent) => { if ((e.target as Element | null)?.closest?.("[data-item]")) e.preventDefault(); };
    el.addEventListener("touchstart", block, { passive: false });
    el.addEventListener("touchmove", block, { passive: false });
    return () => { el.removeEventListener("touchstart", block); el.removeEventListener("touchmove", block); };
  }, [mode]);

  const names = useMemo(() => items.map((it) => (it.kind === "custom" ? t("plan.furniture.customName") : FURNITURE[it.kind].name[locale])), [items, t, locale]);
  const placed = useMemo(() => placeItemLabels(items, names, scale), [items, names, scale]);
  const avoid = useMemo(() => boxesOf(placed), [placed]);
  const current = view.rooms.find((r) => r.id === room);

  /** Pointer position in plan space (metres, y down). */
  const toPlan = (e: { clientX: number; clientY: number }): PlanPt => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const onDown = (e: PointerEvent) => {
    justDragged.current = false; // after a drag with a finger iOS may send no click: the flag must not swallow the next tap
    if (mode !== "furniture") return;
    const el = (e.target as Element).closest("[data-item]");
    if (!el) return;
    const i = Number(el.getAttribute("data-item")), q = toPlan(e);
    setSel(i);
    drag.current = { off: [q[0] - items[i].x, q[1] + items[i].y], moved: false };
    svg.current!.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (mode === "measure" && pts.length === 1 && e.pointerType === "mouse") setHover(snapPt(toPlan(e)));
    if (drag.current && sel !== null) {
      const q = toPlan(e), it = items[sel], next = placeItem(it, q[0] - drag.current.off[0], -(q[1] - drag.current.off[1]), bounds);
      if (next.x !== it.x || next.y !== it.y) { drag.current.moved = true; setItems(items.map((o, k) => (k === sel ? next : o))); }
    }
  };
  const onUp = () => { if (drag.current?.moved) { justDragged.current = true; persist(items); } drag.current = null; };
  // points are set and the selection cleared on a tap, so that panning the enlarged plan with a finger adds nothing
  const addPoint = (q: PlanPt) => { setPts((a) => (a.length >= 2 ? [q] : [...a, q])); setHover(null); };
  const onClick = (e: MouseEvent) => {
    if (justDragged.current) { justDragged.current = false; return; }
    if (mode === "measure") { addPoint(snapPt(toPlan(e))); setCursor(null); }
    else if (mode === "furniture" && !(e.target as Element).closest("[data-item]")) setSel(null);
  };
  /** Keyboard measuring: arrow keys move a cursor (it starts at the label of the selected room), Enter sets a point. */
  const onSvgKey = (e: KeyboardEvent) => {
    if (mode !== "measure" || e.target !== e.currentTarget) return;
    const step = e.shiftKey ? SNAP_COARSE : SNAP, vb = view.drawing.viewBox;
    const mv: Record<string, PlanPt> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const here = cursor ?? current?.at ?? [vb.x + vb.w / 2, vb.y + vb.h / 2];
    if (mv[e.key]) {
      e.preventDefault();
      setCursor(snapPt([clamp(here[0] + mv[e.key][0], vb.x, vb.x + vb.w), clamp(here[1] + mv[e.key][1], vb.y, vb.y + vb.h)]));
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const q = snapPt(here); setCursor(q); addPoint(q); }
  };

  const focusItem = (i: number) => requestAnimationFrame(() => svg.current?.querySelector<SVGGElement>(`[data-item="${i}"]`)?.focus({ preventScroll: true }));
  const onAdd = (kind: ItemKind, size?: { w: number; d: number }) => {
    const at = current ? view.drawing.rooms.find((r) => r.id === current.id)!.label.at : ([bounds[0], -bounds[1]] as PlanPt);
    const shift = (items.length % 6) * 3 * SNAP; // a cascade, so that new pieces do not hide each other
    const next = addItem(items, newItem(kind, size ?? null, [at[0] + shift, -at[1] + shift], bounds));
    commit(next); setSel(next.length - 1); focusItem(next.length - 1);
  };
  const rotate = (i: number) => commit(items.map((it, k) => (k === i ? placeItem(rotateItem(it), it.x, it.y, bounds) : it)));
  const remove = (i: number) => { commit(items.filter((_, k) => k !== i)); setSel(null); };
  const onItemKey = (e: KeyboardEvent, i: number) => {
    const step = e.shiftKey ? SNAP_COARSE : SNAP;
    const mv: Record<string, PlanPt> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (mv[e.key]) { e.preventDefault(); commit(items.map((it, k) => (k === i ? moveItem(it, mv[e.key][0], mv[e.key][1], bounds) : it))); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); rotate(i); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(i); svg.current?.focus({ preventScroll: true }); }
  };

  /** From the table: select the room, show the plan (centred, below the bar) and, when the plan is wider than the window, the room. */
  const pick = (id: string) => {
    setMode("rooms"); setRoom(id); setPts([]); setCursor(null); setSel(null);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // WebKit stops smooth scrolling that starts during a re-render, and svg.scrollIntoView(center) jumps to the top: compute from the frame
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const st = stage.current;
      if (!st) return;
      const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0, space = window.innerHeight - pad;
      const sr = st.getBoundingClientRect(), pr = svg.current?.querySelector(`[data-room="${id}"]`)?.getBoundingClientRect();
      const mid = sr.height <= space || !pr ? (sr.top + sr.bottom) / 2 : clamp((pr.top + pr.bottom) / 2, sr.top + space / 2, sr.bottom - space / 2);
      window.scrollTo({ top: window.scrollY + mid - pad - space / 2, behavior });
      const el = svg.current?.querySelector(`[data-room="${id}"]`);
      if (el && st.scrollWidth > st.clientWidth) {
        const r = el.getBoundingClientRect(), box = st.getBoundingClientRect();
        st.scrollTo({ left: st.scrollLeft + (r.left + r.right) / 2 - (box.left + box.right) / 2, behavior });
      }
    }));
  };

  const measurePts = pts.length === 1 && hover ? [pts[0], hover] : pts;
  const layerOptions: ChipOption<LayerKey>[] = [
    { value: "zones", label: t("plan.layers.zones") }, { value: "furniture", label: t("plan.layers.furniture") }, { value: "dims", label: t("plan.layers.dims") },
    ...(on.zoom || (measured !== null && measured * view.drawing.viewBox.w < ZOOM_PX - 1) ? [{ value: "zoom" as const, label: t("plan.layers.zoom") }] : []),
  ];
  const changeMode = (m: PlanMode) => { setMode(m); setPts([]); setHover(null); setCursor(null); setSel(null); };

  return (
    <div className="shell plan-tool">
      <div className="pl-bar">
        <Segmented ariaLabel={t("plan.modes.label")} value={mode} onChange={changeMode}
          options={[{ value: "rooms", label: t("plan.modes.rooms") }, { value: "measure", label: t("plan.modes.measure") }, { value: "furniture", label: t("plan.modes.furniture") }]} />
        <Chips ariaLabel={t("plan.layers.label")} options={layerOptions} selected={(Object.keys(on) as LayerKey[]).filter((k) => on[k])}
          onToggle={(k) => setOn((o) => ({ ...o, [k]: !o[k] }))} />
      </div>
      <p id="plan-help" className="sr-only">{t("plan.drawing.help")}</p>

      <div className="pl-layout">
        <div ref={stage} className={`pl-stage panel${on.zoom ? " zoomed" : ""}`}>
          <PlanSvg ref={svg} view={view} mode={mode} zones={on.zones} furniture={on.furniture} dims={on.dims} room={room} onRoom={setRoom}
            scale={scale} avoid={avoid} handlers={{ onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp, onPointerLeave: () => setHover(null), onClick, onKeyDown: onSvgKey }}>
            {mode === "measure" && <MeasureLayer pts={measurePts} cursor={cursor} scale={scale} />}
            <ItemsLayer items={items} placed={placed} names={names} sel={sel} active={mode === "furniture"} onSelect={setSel} onKey={onItemKey} />
          </PlanSvg>
        </div>

        <aside className="pl-info panel panel-pad" aria-live="polite">
          {mode === "rooms" && (current ? <RoomInfo room={current} /> : <p className="small">{t("plan.room.prompt")}</p>)}
          {mode === "measure" && <MeasurePanel pts={measurePts} />}
          {mode === "furniture" && (
            <FurniturePanel items={items} sel={sel} names={names} onAdd={onAdd} onRotate={() => sel !== null && rotate(sel)} onRemove={() => sel !== null && remove(sel)}
              onClear={() => { commit([]); setSel(null); }} />
          )}
        </aside>
      </div>

      <ul className="legend pl-legend" aria-label={t("plan.legend.label")}>
        {view.legend.map((k) => (
          <li key={k}><span className="dot" style={{ "--dot": `var(${PLAN_FILL[k]})` } as CSSProperties} aria-hidden="true" />{t.dyn(`plan.legend.${k}`)}</li>
        ))}
      </ul>

      <RoomTable view={view} current={mode === "rooms" ? room : null} onPick={pick} />
    </div>
  );
}
