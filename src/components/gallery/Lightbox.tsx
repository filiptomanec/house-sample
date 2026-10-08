"use client";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { inertOutside, trapTab } from "@/lib/modal";
import { HERO_NAME } from "./morph";
import type { GalleryItem } from "./filter";
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, NO_ZOOM, ZOOM_TAP, isZoomed, panBy, pinchStep, toggleAt, zoomAt, zoomTransform, type Zoom } from "./zoom";

/** Swipes shorter than this (px) are taps. */
const SWIPE_PX = 50;

type Pt = { x: number; y: number };
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Full-screen viewer in a portal: role="dialog", Escape, close button, a tap on the backdrop, arrow keys and swipes, a counter,
 * the page behind inert and scroll-locked, a focus trap. The picture zooms inside the viewer (never the page): pinch, double tap
 * or double click for 2x at that point, drag to pan, the +/- keys and a zoom button; paging and closing reset it. In landscape on
 * a phone the picture takes the full height; on wide screens the arrows sit outside the picture. The caller owns the index and
 * plays the morph to and from the tile.
 */
export function Lightbox({ items, index, onClose, onGo }: { items: readonly GalleryItem[]; index: number; onClose: () => void; onGo: (delta: number) => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null), closeBtn = useRef<HTMLButtonElement>(null), img = useRef<HTMLImageElement>(null);
  const zoom = useRef<Zoom>(NO_ZOOM);
  // the index of the picture that is zoomed (so paging shows the next one unzoomed without an effect that sets state)
  const [zoomedAt, setZoomedAt] = useState<number | null>(null);
  const zoomed = zoomedAt === index;
  const pointers = useRef(new Map<number, Pt>());
  // `target`: where the gesture began (the capture retargets later events to the viewer itself)
  const gesture = useRef<{ start: Pt; target: EventTarget | null; moved: boolean; multi: boolean; pinch: { mid: Pt; dist: number } | null }>({ start: { x: 0, y: 0 }, target: null, moved: false, multi: false, pinch: null });
  const lastTap = useRef<{ at: number; p: Pt } | null>(null);
  const item = items[index];

  /** The picture's laid-out size and centre (unaffected by the transform). */
  const frame = () => {
    const el = img.current;
    if (!el) return null;
    const w = el.offsetWidth, h = el.offsetHeight, r = el.getBoundingClientRect();
    // the bounding box is the transformed one: its centre is the laid-out centre moved by the pan
    return { w, h, cx: r.left + r.width / 2 - zoom.current.x, cy: r.top + r.height / 2 - zoom.current.y };
  };
  const apply = (z: Zoom, animate = false) => {
    zoom.current = z;
    const el = img.current;
    if (el) {
      el.dataset.animate = animate ? "true" : "false";
      el.style.transform = zoomTransform(z);
    }
    setZoomedAt(isZoomed(z) ? index : null);
  };
  const toggle = (at?: Pt) => {
    const f = frame();
    if (!f) return;
    const p = at ? { x: at.x - f.cx, y: at.y - f.cy } : { x: 0, y: 0 };
    apply(toggleAt(zoom.current, p, f.w, f.h), true);
  };
  const step = (dir: 1 | -1) => {
    const f = frame();
    if (f) apply(zoomAt(zoom.current, zoom.current.s * (dir > 0 ? ZOOM_TAP : 1 / ZOOM_TAP), { x: 0, y: 0 }, f.w, f.h), true);
  };

  // a new picture starts unzoomed (the state follows from zoomedAt; here only the transform and the gesture are reset)
  useLayoutEffect(() => {
    zoom.current = NO_ZOOM;
    if (img.current) img.current.style.transform = "";
    pointers.current.clear();
    lastTap.current = null;
  }, [index]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (isZoomed(zoom.current)) apply(NO_ZOOM, true);
      else onClose();
    } else if (e.key === "ArrowRight") onGo(1);
    else if (e.key === "ArrowLeft") onGo(-1);
    else if (e.key === "+" || e.key === "=") step(1);
    else if (e.key === "-") step(-1);
    else trapTab(e, [box.current]);
  });

  // The page behind is inert and does not scroll; focus starts on the close button. A layout effect, so the page is
  // interactive again the moment the lightbox unmounts (returning focus to the tile needs that).
  useLayoutEffect(() => {
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = "hidden";
    const release = inertOutside([box.current]);
    closeBtn.current?.focus({ preventScroll: true });
    return () => { html.style.overflow = prev; release(); };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, []);

  // the neighbours are fetched ahead (the same responsive choice as the viewer), so paging does not wait for the network
  useEffect(() => {
    if (items.length < 2) return;
    for (const d of [1, -1]) {
      const n = items[(index + d + items.length) % items.length];
      const pre = new Image();
      pre.sizes = "100vw";
      if (n.picture.srcSet) pre.srcset = n.picture.srcSet;
      pre.src = n.src;
    }
  }, [items, index]);

  // ---------------------------------------------------------------------------------------- gestures (pointer events)
  const down = (e: React.PointerEvent) => {
    // buttons keep their own clicks (a capture here would retarget them to the backdrop)
    if ((e.pointerType === "mouse" && e.button !== 0) || (e.target as Element).closest("button")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      gesture.current = { start: { x: e.clientX, y: e.clientY }, target: e.target, moved: false, multi: false, pinch: null };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.multi = true;
      g.pinch = { mid: mid(a, b), dist: dist(a, b) };
    }
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone (released before this handler ran): nothing to capture */
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const g = gesture.current;
    if (Math.abs(cur.x - g.start.x) > 6 || Math.abs(cur.y - g.start.y) > 6) g.moved = true;
    const f = frame();
    if (!f) return;
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const next = { mid: mid(a, b), dist: dist(a, b) };
      const toLocal = (p: Pt) => ({ x: p.x - f.cx, y: p.y - f.cy });
      apply(pinchStep(zoom.current, { mid: toLocal(g.pinch.mid), dist: g.pinch.dist }, { mid: toLocal(next.mid), dist: next.dist }, f.w, f.h));
      g.pinch = next;
    } else if (pointers.current.size === 1 && isZoomed(zoom.current)) {
      apply(panBy(zoom.current, cur.x - prev.x, cur.y - prev.y, f.w, f.h));
    }
  };
  const up = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.pinch = null; // one finger left after a pinch: it pans from here
      return;
    }
    if (!p || pointers.current.size > 0) return;
    if (g.multi) return; // the end of a pinch is no tap and no swipe
    const dx = p.x - g.start.x, dy = p.y - g.start.y;
    if (!isZoomed(zoom.current) && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      onGo(dx < 0 ? 1 : -1);
      return;
    }
    if (g.moved) return;
    // a tap: the second one in a row toggles the zoom at that point, a single tap on the backdrop closes
    const now = e.timeStamp;
    const last = lastTap.current;
    const onPicture = g.target === img.current;
    if (onPicture && last && now - last.at < DOUBLE_TAP_MS && dist(last.p, p) < DOUBLE_TAP_PX) {
      lastTap.current = null;
      toggle(p);
      return;
    }
    lastTap.current = onPicture ? { at: now, p } : null;
    const backdrop = g.target === e.currentTarget || (g.target instanceof Element && g.target.matches(".lb-stage, .lb-figure"));
    if (backdrop && !isZoomed(zoom.current)) onClose();
  };
  const cancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) gesture.current.pinch = null;
  };

  const zoomLabel = zoomed ? t("gallery.lightbox.zoomOut") : t("gallery.lightbox.zoomIn");
  const pic = item.picture;
  return createPortal(
    <div ref={box} className="lightbox night" role="dialog" aria-modal="true" aria-label={t("gallery.lightbox.label")} data-zoomed={zoomed}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
      <figure className="lb-figure">
        <div className="lb-stage">
          <picture>
            {pic.sources.map((s) => <source key={s.type} type={s.type} srcSet={s.srcSet} sizes="100vw" />)}
            <img ref={img} src={pic.src} srcSet={pic.srcSet} sizes="100vw" alt={item.alt} width={pic.width} height={pic.height} decoding="async" draggable={false}
              style={{ viewTransitionName: HERO_NAME }} aria-describedby="lb-hint" />
          </picture>
        </div>
        <figcaption className="lb-cap" aria-live="polite">
          <b>{item.title}</b>
          <span className="mono lb-line">{item.caption}</span>
          <span className="mono lb-count">{t("gallery.lightbox.counter", { n: index + 1, total: items.length })}</span>
          <span id="lb-hint" className="lb-hint">{t("gallery.lightbox.zoomHint")}</span>
        </figcaption>
      </figure>
      <button ref={closeBtn} type="button" className="lb-btn lb-close" onClick={onClose} aria-label={t("gallery.lightbox.close")}><span aria-hidden="true">✕</span></button>
      <button type="button" className="lb-btn lb-zoom" onClick={() => toggle()} aria-label={zoomLabel} aria-pressed={zoomed}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M15 15l5 5M7.5 10.5h6" stroke="currentColor" strokeWidth="1.6" fill="none" />{!zoomed && <path d="M10.5 7.5v6" stroke="currentColor" strokeWidth="1.6" />}</svg>
      </button>
      {items.length > 1 && (
        <>
          <button type="button" className="lb-btn lb-prev" onClick={() => onGo(-1)} aria-label={t("gallery.lightbox.prev")}><span aria-hidden="true">‹</span></button>
          <button type="button" className="lb-btn lb-next" onClick={() => onGo(1)} aria-label={t("gallery.lightbox.next")}><span aria-hidden="true">›</span></button>
        </>
      )}
    </div>,
    document.body,
  );
}
