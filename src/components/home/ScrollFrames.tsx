"use client";
// A pinned full-screen canvas whose frame follows the scroll position (the section is `height` svh tall, the frame sticks).
// Memory-safe on phones: frames are fetched as compressed files, coarse to fine, and only a small window around the current frame
// is decoded (FrameStore). Nothing is fetched until the section is within a screen of the viewport. With `blend` neighbouring
// frames are cross-faded (a static camera: the time of day); without it the nearest frame is shown whole (a moving camera would
// double-expose). Phones in portrait get portrait crops. The poster is plain HTML (a <picture> chosen by media queries, also
// for reduced motion), so the first paint needs no JavaScript; reduced motion never starts the engine.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FrameSet } from "@/lib/data/media";
import { MQ } from "@/styles/breakpoints";
import { browserDeps, FrameStore } from "./frames";
import { useMedia } from "./useMedia";
import { canvasScale, coverRect, decodeBudgetBytes, frameAt, lruCapacity, sectionProgress } from "./timeline";

/** The same query decides the poster (<source media>) and the frames the script fetches. */
export const PORTRAIT = "(max-aspect-ratio: 4/5)";

export interface ScrollState {
  /** 0..1 along the pinned section. */
  progress: number;
  /** Fractional frame index. */
  frame: number;
}

/** Progress is published to React in steps this fine (about a pixel per step on a long section). */
const PROGRESS_STEP = 1 / 1500;
/** Where the frame has left the top of the viewport is published in steps of 1/400 (so the style is rarely rewritten). */
const OUT_STEPS = 400;
/** A sequence this many screens away from the viewport releases its decoded frames. */
const RELEASE_SCREENS = 1;

interface Props {
  frames: FrameSet;
  /** Frame shown with reduced motion. */
  stillIndex: number;
  /** Height of the section in svh. */
  height: number;
  /** Description of the picture for assistive technology. */
  alt: string;
  blend?: boolean;
  /** The first screen of the page: the poster loads eagerly and with high priority. */
  priority?: boolean;
  /** Tone of the navigation bar over this block (see docs/DESIGN.md, "Navigation tone"). */
  navTone?: "clear" | "dark";
  className?: string;
  children?: (state: ScrollState) => ReactNode;
}

export default function ScrollFrames({ frames, stillIndex, height, alt, blend = true, priority = false, navTone, className, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ScrollState>({ progress: 0, frame: 0 });
  const [ready, setReady] = useState(false);
  const reduced = useMedia(MQ.reducedMotion);
  const usePortrait = useMedia(PORTRAIT) && frames.portrait !== null;
  const variant = usePortrait && frames.portrait ? frames.portrait : frames.landscape;
  const sequenceKey = `${variant.urls.length}:${variant.urls[0]}`;

  useEffect(() => {
    if (reduced) return;
    const wrapEl = wrap.current, stickEl = stick.current, cv = canvas.current;
    const ctx = cv?.getContext("2d", { alpha: false });
    if (!wrapEl || !stickEl || !cv || !ctx) return;

    const n = variant.urls.length;
    const capacity = lruCapacity(variant.width, variant.height, decodeBudgetBytes({
      coarse: matchMedia(MQ.coarse).matches,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    }));
    let alive = true, raf = 0, drawnKey = -1, p = 0, published = -1, out = "", painted = false, scrollable = 0, scale = 1, released = false;

    const store = new FrameStore(variant.urls, browserDeps, {
      capacity,
      onDecoded: () => { drawnKey = -1; schedule(); },
    });

    const measure = () => {
      scrollable = wrapEl.offsetHeight - stickEl.offsetHeight;
      scale = canvasScale(cv.clientWidth, cv.clientHeight, devicePixelRatio || 1, variant.width, variant.height);
      const w = Math.round(cv.clientWidth * scale), h = Math.round(cv.clientHeight * scale);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; drawnKey = -1; }
    };

    const paint = (bitmap: ImageBitmap, alpha: number) => {
      const r = coverRect(bitmap.width, bitmap.height, cv.width, cv.height);
      ctx.globalAlpha = alpha;
      ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
    };

    const draw = () => {
      raf = 0;
      if (!alive) return;
      const f = frameAt(p, n);
      const cur = Math.round(f);
      let base: number, over = -1, t = 0;
      if (!blend) {
        store.setCurrent(cur, [-1, 0, 1, 2]);
        base = store.has(cur) ? cur : store.nearest(cur);
      } else {
        const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1);
        t = f - i0;
        store.setCurrent(cur, [-2, -1, 0, 1, 2]);
        base = store.has(i0) && store.has(i1) ? i0 : store.nearest(cur);
        if (base === i0 && t > 0.01 && store.has(i1)) over = i1;
      }
      // what is on the canvas: the base frame and the share of the next one (in percent)
      const key = base * 1000 + (over >= 0 ? Math.round(t * 100) + 1 : 0);
      if (base < 0 || key === drawnKey) return;
      drawnKey = key;
      paint(store.get(base)!, 1);
      if (over >= 0) paint(store.get(over)!, t);
      ctx.globalAlpha = 1;
      if (!painted) { painted = true; setReady(true); }
    };
    function schedule() { if (!raf && alive) raf = requestAnimationFrame(draw); }

    const onScroll = () => {
      const r = wrapEl.getBoundingClientRect();
      const frameTop = r.top > 0 ? r.top : Math.min(0, r.bottom - stickEl.offsetHeight);
      const leave = (Math.round(Math.min(1, Math.max(0, -frameTop / Math.max(1, stickEl.offsetHeight))) * OUT_STEPS) / OUT_STEPS).toString();
      if (leave !== out) { out = leave; wrapEl.style.setProperty("--sf-out", leave); }
      if (r.bottom < -innerHeight * RELEASE_SCREENS || r.top > innerHeight * (1 + RELEASE_SCREENS)) {
        // far off screen: give the decoded frames back (a phone must not hold two sequences), nothing else to do
        if (!released) { released = true; store.release(); drawnKey = -1; }
        return;
      }
      if (released) { released = false; drawnKey = -1; }
      p = sectionProgress(r.top, scrollable);
      if (Math.abs(p - published) >= PROGRESS_STEP || ((p === 0 || p === 1) && p !== published)) {
        published = p;
        setState({ progress: p, frame: frameAt(p, n) });
      }
      schedule();
    };

    // fetch only when the section is within about a screen of the viewport
    let started = false;
    const io = new IntersectionObserver((entries) => {
      if (started || !entries.some((e) => e.isIntersecting)) return;
      started = true;
      io.disconnect();
      store.start();
    }, { rootMargin: "100% 0px" });
    io.observe(wrapEl);

    const ro = new ResizeObserver(() => { measure(); onScroll(); schedule(); });
    ro.observe(stickEl);
    measure();
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      store.dispose();
      setReady(false);
    };
    // `variant` is read through sequenceKey (its URLs are stable for a given key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, sequenceKey, blend]);

  const still = Math.min(Math.max(0, stillIndex), frames.landscape.urls.length - 1);
  return (
    <div ref={wrap} className={`sf ${className ?? ""}`} data-nav={navTone} style={{ "--sf-h": `${height}svh` } as CSSProperties}>
      <div ref={stick} className="sf-sticky">
        <div className="sf-media" role="img" aria-label={alt} data-ready={ready}>
          {/* The browser picks the poster itself (<source media>), so a phone never downloads the landscape frame, and with
              reduced motion it shows the still frame instead of the first one. */}
          {!ready && (
            <picture className="sf-poster">
              {frames.portrait && <source media={`${MQ.reducedMotion} and ${PORTRAIT}`} srcSet={frames.portrait.urls[still]} />}
              <source media={MQ.reducedMotion} srcSet={frames.landscape.urls[still]} />
              {frames.portrait && <source media={PORTRAIT} srcSet={frames.portrait.urls[0]} />}
              <img src={frames.landscape.urls[0]} alt="" width={frames.landscape.width} height={frames.landscape.height}
                decoding="async" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} />
            </picture>
          )}
          <canvas ref={canvas} aria-hidden />
        </div>
        <div className="sf-overlay">{children?.(state)}</div>
      </div>
    </div>
  );
}
