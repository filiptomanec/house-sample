"use client";
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFormat, useT } from "@/lib/i18n/client";
import { inertOutside, trapTab } from "@/lib/modal";
import { HERO_NAME } from "./morph";
import type { GalleryItem } from "./filter";

/** Swipes shorter than this (px) are taps. */
const SWIPE_PX = 50;

/**
 * Full-screen viewer in a portal: role="dialog", Escape, close button, a tap on the backdrop, arrow keys and swipes, a counter,
 * the page behind inert and scroll-locked, a focus trap. The caller owns the index and plays the morph to and from the tile.
 */
export function Lightbox({ items, index, onClose, onGo }: { items: readonly GalleryItem[]; index: number; onClose: () => void; onGo: (delta: number) => void }) {
  const t = useT(), f = useFormat();
  const box = useRef<HTMLDivElement>(null), closeBtn = useRef<HTMLButtonElement>(null), touchX = useRef<number | null>(null);
  const item = items[index];

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight") onGo(1);
    else if (e.key === "ArrowLeft") onGo(-1);
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

  // the neighbours are fetched ahead, so paging does not wait for the network
  useEffect(() => {
    if (items.length < 2) return;
    for (const d of [1, -1]) new Image().src = items[(index + d + items.length) % items.length].src;
  }, [items, index]);

  return createPortal(
    <div ref={box} className="lightbox night" role="dialog" aria-modal="true" aria-label={t("gallery.lightbox.label")}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > SWIPE_PX) onGo(dx < 0 ? 1 : -1);
      }}>
      <figure className="lb-figure" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.src} alt={item.alt} width={item.width} height={item.height} decoding="async" style={{ viewTransitionName: HERO_NAME }} />
        <figcaption className="lb-cap" aria-live="polite">
          <b>{item.title}</b>
          <span className="mono">{f.clock(item.minutes)}</span>
          <span className="mono lb-count">{t("gallery.lightbox.counter", { n: index + 1, total: items.length })}</span>
        </figcaption>
      </figure>
      <button ref={closeBtn} type="button" className="lb-btn lb-close" onClick={onClose} aria-label={t("common.close")}><span aria-hidden="true">✕</span></button>
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
