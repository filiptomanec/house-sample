"use client";
// A horizontal strip of renders. Touch and trackpads scroll it natively (scroll-snap); the previous and next buttons exist for
// a mouse only (they are hidden without hover and a fine pointer). Every card is a real link to the gallery. Pictures are
// responsive (<picture> with the formats and widths of the manifest, `sizes` of the card) and load lazily.

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { MQ } from "@/styles/breakpoints";
import type { Picture } from "./mediaExtras";

export interface RailItem {
  id: string;
  /** The single file (the fallback of `picture`). */
  src: string;
  title: string;
  caption: string;
  width: number;
  height: number;
  picture?: Picture;
}

/** Rendered width of a card: 78 % of a phone, at most 720 px; the first card (the strongest frame) is wider. Keep in step with `.rail > li` in home.css. */
export const RAIL_SIZES = "(max-width: 640px) 78vw, 720px";
export const RAIL_LEAD_SIZES = "(max-width: 640px) 86vw, (max-width: 1180px) 72vw, 1040px";

/** Tolerance when deciding that the strip is at its start or end (px). */
const EDGE = 4;

export default function Rail({ items, label, href, linkLabel, prevLabel, nextLabel }: {
  items: RailItem[]; label: string; href: string; linkLabel: string; prevLabel: string; nextLabel: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const [edge, setEdge] = useState({ start: true, end: false });

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const max = el.scrollWidth - el.clientWidth;
      setEdge((e) => {
        const next = { start: el.scrollLeft <= EDGE, end: el.scrollLeft >= max - EDGE };
        return e.start === next.start && e.end === next.end ? e : next;
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    schedule();
    el.addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(raf); el.removeEventListener("scroll", schedule); removeEventListener("resize", schedule); };
  }, []);

  const step = (dir: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const card = el.querySelector("li");
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const by = card ? card.getBoundingClientRect().width + gap : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * by, behavior: matchMedia(MQ.reducedMotion).matches ? "auto" : "smooth" });
  };

  return (
    <>
      <ul ref={list} id={id} className="rail" role="list" aria-label={label}>
        {items.map((r, i) => {
          const sizes = i === 0 ? RAIL_LEAD_SIZES : RAIL_SIZES;
          return (
            <li key={r.id}>
              <Link href={href} className="rail-item">
                <span className="rail-ph">
                  <picture>
                    {r.picture?.sources.map((s) => <source key={s.type} type={s.type} srcSet={s.srcSet} sizes={sizes} />)}
                    <img src={r.picture?.src ?? r.src} srcSet={r.picture?.srcSet} sizes={r.picture?.srcSet ? sizes : undefined}
                      alt="" loading="lazy" decoding="async" width={r.width} height={r.height} />
                  </picture>
                </span>
                <span className="rail-cap"><b>{r.title}</b> <span className="mono">{r.caption}</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="shell rail-foot">
        <Link className="link-arrow" href={href}>{linkLabel}</Link>
        <div className="rail-nav">
          <button type="button" aria-controls={id} aria-label={prevLabel} disabled={edge.start} onClick={() => step(-1)}>
            <svg viewBox="0 0 20 20" aria-hidden><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
          </button>
          <button type="button" aria-controls={id} aria-label={nextLabel} disabled={edge.end} onClick={() => step(1)}>
            <svg viewBox="0 0 20 20" aria-hidden><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
          </button>
        </div>
      </div>
    </>
  );
}
