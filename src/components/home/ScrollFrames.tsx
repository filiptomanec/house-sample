"use client";
// A pinned full-screen canvas whose frame follows the scroll position (the section is `height` svh tall, the frame sticks).
// Memory-safe on phones: frames are fetched as compressed files, coarse to fine, and only a small window around the current frame
// is decoded (FrameStore). With `blend` neighbouring frames are cross-faded (a static camera: the time of day); without it the
// nearest frame is shown whole (a moving camera would double-expose). Phones in portrait get portrait frames, and a canvas that a
// smaller variant fills sharply gets that variant (when the manifest has one). The poster is plain HTML (a <picture> chosen by
// media queries, also for reduced motion), so the first paint needs no JavaScript.
//
// When frames are fetched: the first screen of the page (`priority`) fetches only the coarse pass once the page has loaded and
// the browser is idle (at most 1.5 s), and everything on the first scroll; any other sequence starts when it is within a screen.
// Reduced motion and Save-Data never start the engine: the poster stands still and the page shows the static layout.
//
// The children get the state of what is ON THE CANVAS (`drawn`), not only what the scroll asks for, so a clock or a caption never
// runs ahead of the picture while frames are still arriving (`waiting`). With `endHold` the last share of the scroll rests on the
// last frame (the day hero: the lit house and its last caption stay before the section leaves).

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { FrameSet } from "@/lib/data/media";
import { MQ } from "@/styles/breakpoints";
import { browserDeps, FrameStore } from "./frames";
import { useMedia } from "./useMedia";
import { canvasScale, coarseCount, coverRect, decodeBudgetBytes, frameAt, heldProgress, lruCapacity, sectionProgress, smallVariantFits } from "./timeline";

/** The same query decides the poster (<source media>) and the frames the script fetches. */
export const PORTRAIT = "(max-aspect-ratio: 4/5)";

/** One sequence of frames; `small` is the lighter variant (about 960 px wide) when the media build writes one (contract C4). */
export type FrameSeq = FrameSet["landscape"] & { small?: { urls: string[]; width: number; height: number } };
/** The frames of a sequence as the media module gives them, plus the optional small variants. */
export type FrameSetX = { landscape: FrameSeq; portrait: FrameSeq | null };

export interface ScrollState {
  /** 0..1 along the pinned section. */
  progress: number;
  /** Fractional frame index the scroll position asks for. */
  frame: number;
  /** Fractional frame index on the canvas (the poster frame until the first frame is drawn). */
  drawn: number;
  /** The canvas lags the scroll position by more than WAIT_FRAMES (frames are still loading). */
  waiting: boolean;
  /** Nothing scrubs: reduced motion or Save-Data. */
  still: boolean;
}

/** Progress is published to React in steps this fine (about a pixel per step on a long section). */
const PROGRESS_STEP = 1 / 1500;
/** The drawn frame is published when it moves by this much (a fraction of a frame). */
const DRAWN_STEP = 0.01;
/** The canvas counts as waiting for frames when it is this many frames behind the scroll position. */
const WAIT_FRAMES = 1;
/** Where the frame has left the top of the viewport is published in steps of 1/400 (so the style is rarely rewritten). */
const OUT_STEPS = 400;
/** A sequence this many screens away from the viewport releases its decoded frames. */
const RELEASE_SCREENS = 1;
/** The longest the hero waits for an idle moment after load before it fetches its coarse frames. */
const IDLE_TIMEOUT_MS = 1500;
/** Where requestIdleCallback is missing (Safari), the pause after load instead. */
const IDLE_FALLBACK_MS = 300;

interface Props {
  frames: FrameSet | FrameSetX;
  /** Frame shown with reduced motion. */
  stillIndex: number;
  /** Height of the section in svh. */
  height: number;
  /** Description of the picture for assistive technology. */
  alt: string;
  blend?: boolean;
  /** The first screen of the page: the poster loads eagerly and with high priority, frames load after the page (see above). */
  priority?: boolean;
  /** Tone of the navigation bar over this block (see docs/DESIGN.md, "Navigation tone"). */
  navTone?: "clear" | "dark";
  /** Share of the scroll at the end that rests on the last frame (heldProgress), so its caption can be read. */
  endHold?: number;
  className?: string;
  children?: (state: ScrollState) => ReactNode;
}

type Connection = EventTarget & { saveData?: boolean };
const connection = (): Connection | undefined => (navigator as Navigator & { connection?: Connection }).connection;
/** Save-Data is not a media query: it is read after hydration (the server render and the first paint scrub). */
const subscribeSaveData = (notify: () => void) => {
  const c = connection();
  c?.addEventListener?.("change", notify);
  return () => c?.removeEventListener?.("change", notify);
};
const saveDataOn = (): boolean => connection()?.saveData === true;

export default function ScrollFrames({ frames, stillIndex, height, alt, blend = true, priority = false, navTone, endHold = 0, className, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ScrollState>({ progress: 0, frame: 0, drawn: 0, waiting: false, still: false });
  const [ready, setReady] = useState(false);
  const saveData = useSyncExternalStore(subscribeSaveData, saveDataOn, () => false);
  const reduced = useMedia(MQ.reducedMotion);
  const set = frames as FrameSetX;
  const usePortrait = useMedia(PORTRAIT) && set.portrait !== null;
  const variant: FrameSeq = usePortrait && set.portrait ? set.portrait : set.landscape;
  const sequenceKey = `${variant.urls.length}:${variant.urls[0]}`;
  const still = Math.min(Math.max(0, stillIndex), set.landscape.urls.length - 1);
  const isStill = reduced || saveData;

  // a still sequence shows the poster: the still frame with reduced motion, the first frame with Save-Data
  const shown: ScrollState = isStill ? { progress: 0, frame: reduced ? still : 0, drawn: reduced ? still : 0, waiting: false, still: true } : state;

  useEffect(() => {
    if (isStill) return;
    const wrapEl = wrap.current, stickEl = stick.current, cv = canvas.current;
    const ctx = cv?.getContext("2d", { alpha: false });
    if (!wrapEl || !stickEl || !cv || !ctx) return;

    const seq = variant.small && smallVariantFits(innerWidth, innerHeight, devicePixelRatio || 1, variant, variant.small) ? variant.small : variant;
    const n = seq.urls.length;
    const capacity = lruCapacity(seq.width, seq.height, decodeBudgetBytes({
      coarse: matchMedia(MQ.coarse).matches,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    }));
    let alive = true, raf = 0, drawnKey = -1, p = 0, published = -1, drawnPub = 0, out = "", painted = false, scrollable = 0, scale = 1, released = false;

    const store = new FrameStore(seq.urls, browserDeps, {
      capacity,
      onDecoded: () => { drawnKey = -1; schedule(); },
      onProgress: (settled, total) => {
        wrapEl.style.setProperty("--sf-loaded", (settled / Math.max(1, total)).toFixed(3));
        wrapEl.dataset.loading = settled < total ? "true" : "false";
      },
    });

    const measure = () => {
      scrollable = wrapEl.offsetHeight - stickEl.offsetHeight;
      scale = canvasScale(cv.clientWidth, cv.clientHeight, devicePixelRatio || 1, seq.width, seq.height);
      const w = Math.round(cv.clientWidth * scale), h = Math.round(cv.clientHeight * scale);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; drawnKey = -1; }
    };

    const paint = (bitmap: ImageBitmap, alpha: number) => {
      const r = coverRect(bitmap.width, bitmap.height, cv.width, cv.height);
      ctx.globalAlpha = alpha;
      ctx.drawImage(bitmap, r.x, r.y, r.w, r.h);
    };

    const publishDrawn = (d: number) => {
      if (Math.abs(d - drawnPub) < DRAWN_STEP) return;
      drawnPub = d;
      setState((s) => ({ ...s, drawn: d, waiting: Math.abs(s.frame - d) > WAIT_FRAMES }));
    };

    const draw = () => {
      raf = 0;
      if (!alive) return;
      const f = frameAt(heldProgress(p, endHold), n);
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
      publishDrawn(over >= 0 ? base + t : base);
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
        const fr = frameAt(heldProgress(p, endHold), n);
        setState((s) => ({ ...s, progress: p, frame: fr, waiting: Math.abs(fr - s.drawn) > WAIT_FRAMES }));
      }
      schedule();
    };

    // when to fetch (see the head of the file)
    const cleanups: (() => void)[] = [];
    if (priority) {
      const intents = ["scroll", "wheel", "touchstart", "keydown"] as const;
      const onIntent = () => { store.start(); intents.forEach((e) => removeEventListener(e, onIntent)); };
      intents.forEach((e) => addEventListener(e, onIntent, { passive: true }));
      let idle = 0, timer: ReturnType<typeof setTimeout> | undefined;
      const coarse = () => store.start(coarseCount(n));
      const afterLoad = () => {
        if (typeof requestIdleCallback === "function") idle = requestIdleCallback(coarse, { timeout: IDLE_TIMEOUT_MS });
        else timer = setTimeout(coarse, IDLE_FALLBACK_MS);
      };
      if (document.readyState === "complete") afterLoad(); else addEventListener("load", afterLoad, { once: true });
      cleanups.push(() => {
        intents.forEach((e) => removeEventListener(e, onIntent));
        removeEventListener("load", afterLoad);
        if (idle && typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
        if (timer) clearTimeout(timer);
      });
    } else {
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        store.start();
      }, { rootMargin: "100% 0px" });
      io.observe(wrapEl);
      cleanups.push(() => io.disconnect());
    }

    const ro = new ResizeObserver(() => { measure(); onScroll(); schedule(); });
    ro.observe(stickEl);
    measure();
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      cleanups.forEach((c) => c());
      ro.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      store.dispose();
      delete wrapEl.dataset.loading;
      setReady(false);
    };
    // `variant` is read through sequenceKey (its URLs are stable for a given key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStill, sequenceKey, blend, priority, endHold]);

  return (
    // a still sequence is a plain picture with text under it: the bar is not clear over it (a `.night` block makes it dark glass)
    <div ref={wrap} className={`sf ${className ?? ""}`} data-nav={isStill ? undefined : navTone} data-still={isStill ? "true" : undefined}
      style={{ "--sf-h": `${height}svh` } as CSSProperties}>
      <div ref={stick} className="sf-sticky">
        <div className="sf-media" role="img" aria-label={alt} data-ready={ready}>
          {/* The browser picks the poster itself (<source media>), so a phone never downloads the landscape frame, and with
              reduced motion it shows the still frame instead of the first one. */}
          {!ready && (
            <picture className="sf-poster">
              {set.portrait && <source media={`${MQ.reducedMotion} and ${PORTRAIT}`} srcSet={set.portrait.urls[still]} />}
              <source media={MQ.reducedMotion} srcSet={set.landscape.urls[still]} />
              {set.portrait && <source media={PORTRAIT} srcSet={set.portrait.urls[0]} />}
              <img src={set.landscape.urls[0]} alt="" width={set.landscape.width} height={set.landscape.height}
                decoding="async" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} />
            </picture>
          )}
          <canvas ref={canvas} aria-hidden />
        </div>
        <div className="sf-overlay">{children?.(shown)}</div>
      </div>
    </div>
  );
}
