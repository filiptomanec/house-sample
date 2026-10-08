"use client";
// Two renders from the same camera; the second one is clipped at the divider. A mouse moves the divider at once; a touch moves it
// only after a clearly sideways drag or a tap, so a page scroll that starts on the picture never snaps it to the finger. The
// divider is a real slider: arrows, Page Up/Down, Home and End.

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

/** A touch that has not yet shown whether it drags the divider (sideways) or scrolls the page (up or down). */
type Gesture = { id: number; x: number; y: number; scrollY: number; drag: boolean };
/** Movement in px before a touch counts as a drag. */
const SLOP = 6;
/** A touch that moved the page by more than this only stopped a scroll (px). */
const SCROLL_TOLERANCE = 2;
const STEP = 5;
const PAGE_STEP = 25;
/** Keeps the drag when the finger leaves the picture; throws when the pointer is already gone, which is harmless. */
const capture = (el: Element, id: number) => { try { el.setPointerCapture(id); } catch { /* the pointer is gone */ } };
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

export interface CompareImage {
  src: string;
  width: number;
  height: number;
  label: string;
  /** Responsive sources (mediaExtras.stillPicture); without them the single file is used. */
  srcSet?: string;
  sources?: { type: string; srcSet: string }[];
}

/** One half of the pair as a <picture> (modern formats first). */
function Half({ img, sizes, alt, className, style }: { img: CompareImage; sizes: string; alt: string; className?: string; style?: CSSProperties }) {
  return (
    <picture>
      {img.sources?.map((s) => <source key={s.type} type={s.type} srcSet={s.srcSet} sizes={sizes} />)}
      <img className={className} src={img.src} srcSet={img.srcSet} sizes={img.srcSet ? sizes : undefined} alt={alt} width={img.width} height={img.height}
        draggable={false} loading="lazy" decoding="async" style={style} />
    </picture>
  );
}

export default function CompareSlider({ a, b, alt, altB, ariaLabel, sizes = "100vw" }: {
  a: CompareImage; b: CompareImage;
  /** Alt text of the picture (the first half), and of the second half when the manifest describes it separately. */
  alt: string; altB?: string | null;
  ariaLabel: string;
  /** Rendered width of the pictures (full bleed by default). */
  sizes?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [x, setX] = useState(50);
  const [glide, setGlide] = useState(false); // taps, clicks and keys glide; drags follow the finger

  const at = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    return r && r.width > 0 ? clampPct(((clientX - r.left) / r.width) * 100) : 50;
  };
  const jump = (v: number) => { setGlide(true); setX(clampPct(v)); };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") {
      if (e.button !== 0) return;
      capture(e.currentTarget, e.pointerId);
      gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, scrollY, drag: true };
      jump(at(e.clientX));
      return;
    }
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, scrollY, drag: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!g.drag) {
      const dx = Math.abs(e.clientX - g.x), dy = Math.abs(e.clientY - g.y);
      if (dy > SLOP && dy >= dx) { gesture.current = null; return; } // the page is scrolling
      if (dx <= SLOP || dx <= dy) return;
      g.drag = true;
      capture(e.currentTarget, e.pointerId);
    }
    setGlide(false);
    setX(at(e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== e.pointerId || g.drag) return;
    if (Math.abs(scrollY - g.scrollY) > SCROLL_TOLERANCE) return; // the touch only stopped a scroll
    jump(at(e.clientX)); // a tap
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowLeft: -STEP, ArrowDown: -STEP, ArrowRight: STEP, ArrowUp: STEP, PageDown: -PAGE_STEP, PageUp: PAGE_STEP } as Record<string, number>)[e.key];
    if (step !== undefined) jump(x + step);
    else if (e.key === "Home") jump(0);
    else if (e.key === "End") jump(100);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={box} className="compare" data-glide={glide} style={{ "--ratio": `${a.width} / ${a.height}` } as CSSProperties}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { gesture.current = null; }}>
      <Half img={a} sizes={sizes} alt={alt} />
      <Half img={b} sizes={sizes} alt={altB ?? ""} className="compare-b" style={{ clipPath: `inset(0 0 0 ${x}%)` }} />
      <span className="compare-tag mono" data-side="a">{a.label}</span>
      <span className="compare-tag mono" data-side="b">{b.label}</span>
      <div className="compare-handle" style={{ left: `${x}%` }} role="slider" tabIndex={0} aria-label={ariaLabel}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(x)} onKeyDown={onKeyDown}>
        <i aria-hidden>‹ ›</i>
      </div>
    </div>
  );
}
