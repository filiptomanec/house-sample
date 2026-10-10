"use client";
// A pinned full-screen canvas whose frame follows the scroll position (the section is `height` svh tall, the frame sticks).
// Memory-safe on phones: frames are fetched as compressed files, coarse to fine, and a window around the current frame is decoded
// first (FrameStore). With `retain` (the day hero) and frames that fit a phone (keepsAll), every frame is then fetched and decoded
// in the background once the first one is on the canvas, and all are kept, so a fast scroll only draws. With `blend` neighbouring frames are cross-faded (a static camera: the time of day): frame i whole and
// frame i + 1 over it at the fraction of the scroll between them, so sun, shadows and lights glide instead of stepping; a frame
// decoded after the scroll got there fades in (ARRIVAL_FADE_MS) instead of popping. Without `blend` the nearest frame is shown
// whole and cut (a moving camera would double-expose). Phones in portrait get portrait frames, and a canvas that a
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
import { flushSync } from "react-dom";
import type { FrameSet } from "@/lib/data/media";
import { MQ } from "@/styles/breakpoints";
import { browserDeps, FrameStore, type Frame } from "./frames";
import { useMedia } from "./useMedia";
import {
  arrivalFade, blendAt, blendLayers, canvasScale, clamp01, coarseCount, coverSource, decodeBudgetBytes, decodeWindow, frameAt, heldProgress, keepsAll,
  lruCapacity, sectionProgress, smallVariantFits, type BlendLayer,
} from "./timeline";

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
/** Alphas of the cross-fade are quantised to this many steps: the canvas is redrawn only when one of them moves a step. */
const ALPHA_STEPS = 128;

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
  /** Decode every frame in the background and keep them all, where the frames fit a phone (keepsAll). */
  retain?: boolean;
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

export default function ScrollFrames({ frames, stillIndex, height, alt, blend = true, priority = false, navTone, endHold = 0, retain = false, className, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
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
    const wrapEl = wrap.current, stickEl = stick.current, cv = canvas.current, scrimEl = scrim.current, overlayEl = overlay.current;
    const ctx = cv?.getContext("2d", { alpha: false });
    if (!wrapEl || !stickEl || !cv || !ctx) return;

    const seq = variant.small && smallVariantFits(innerWidth, innerHeight, devicePixelRatio || 1, variant, variant.small) ? variant.small : variant;
    const n = seq.urls.length;
    const deviceMemoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const budget = decodeBudgetBytes({ coarse: matchMedia(MQ.coarse).matches, deviceMemoryGb });
    const keep = retain && keepsAll(seq, deviceMemoryGb);
    let alive = true, raf = 0, drawnKey = "", out = -1, painted = false, released = false;
    // cross-fade: the frame standing alone on the canvas because its partner was not decoded yet (-1: none), and the fade-in
    // from it that runs once the missing frame has arrived (the frame it fades from, -1: none, and when it started)
    let alone = -1, fadeFrom = -1, fadeAt = 0;
    // layout, measured on resize only (never on a scroll frame): where the section starts in the document, how far it scrolls
    let wrapTop = 0, wrapH = 0, stickH = 0, scrollable = 0;
    // what React was last told, and the scroll direction (decoding runs ahead of it)
    let pubP = -1, pubD = -1, pubWait = false, lastF = -1, dir: 1 | -1 = 1, drawn = 0;
    // background fetch of every frame once the first is on the canvas (keep)
    let idleAll = 0, timerAll: ReturnType<typeof setTimeout> | undefined;

    const capacity = lruCapacity(seq.width, seq.height, budget);
    const measure = () => {
      wrapTop = wrapEl.getBoundingClientRect().top + scrollY;
      wrapH = wrapEl.offsetHeight;
      stickH = stickEl.offsetHeight;
      scrollable = wrapH - stickH;
      const scale = canvasScale(cv.clientWidth, cv.clientHeight, devicePixelRatio || 1, seq.width, seq.height);
      const w = Math.round(cv.clientWidth * scale), h = Math.round(cv.clientHeight * scale);
      if (cv.width === w && cv.height === h) return;
      cv.width = w; cv.height = h; drawnKey = "";
    };
    measure();

    const st = new FrameStore<Frame>(seq.urls, browserDeps, {
      capacity,
      keepAll: keep,
      // nothing is drawn here: the next animation frame draws once, and only if what the canvas should show has changed
      onDecoded: () => schedule(),
      onProgress: (settled, total) => {
        // only on the elements that show it: a custom property set on the section would restyle all of it per download
        const v = (settled / Math.max(1, total)).toFixed(3);
        wrapEl.querySelectorAll<HTMLElement>("[data-sf-loaded]").forEach((el) => el.style.setProperty("--sf-loaded", v));
        wrapEl.dataset.loading = settled < total ? "true" : "false";
      },
    });

    /** The decoded frame itself, its shown part picked by the source rectangle (no copy of it is ever made). */
    const paint = (frame: Frame, alpha: number) => {
      const s = coverSource(frame.width, frame.height, cv.width, cv.height);
      ctx.globalAlpha = alpha;
      ctx.drawImage(frame.source, s.sx, s.sy, s.sw, s.sh, 0, 0, cv.width, cv.height);
    };
    const startAll = () => {
      if (typeof requestIdleCallback === "function") idleAll = requestIdleCallback(() => st.start(), { timeout: IDLE_TIMEOUT_MS });
      else timerAll = setTimeout(() => st.start(), IDLE_FALLBACK_MS);
    };

    /** One React update per animation frame at most, and only when something it shows has moved. */
    const publish = (progress: number, frame: number, onCanvas: number) => {
      const waiting = Math.abs(frame - onCanvas) > WAIT_FRAMES;
      const edge = (progress === 0 || progress === 1) && progress !== pubP;
      if (!edge && Math.abs(progress - pubP) < PROGRESS_STEP && Math.abs(onCanvas - pubD) < DRAWN_STEP && waiting === pubWait) return;
      pubP = progress; pubD = onCanvas; pubWait = waiting;
      // rendered now, inside this animation frame: the clock and the captions change in the same frame as the picture, and React
      // does not schedule a task of its own that lands in the middle of the next frame
      flushSync(() => setState({ progress, frame, drawn: onCanvas, waiting, still: false }));
    };

    // everything runs in one animation frame: read the scroll position (no layout read), draw, then tell React once
    const draw = () => {
      raf = 0;
      if (!alive) return;
      const top = wrapTop - scrollY;
      const frameTop = top > 0 ? top : Math.min(0, top + wrapH - stickH);
      const leave = Math.round(clamp01(-frameTop / Math.max(1, stickH)) * OUT_STEPS) / OUT_STEPS;
      if (leave !== out) {
        out = leave;
        // opacity on the two small elements that fade, not a custom property on the section (that would restyle all of it)
        if (scrimEl) scrimEl.style.opacity = String(Math.min(1, leave * 5));
        if (overlayEl && navTone === "clear") overlayEl.style.opacity = String(clamp01(1.2 - leave * 4));
      }
      if (top + wrapH < -innerHeight * RELEASE_SCREENS || top > innerHeight * (1 + RELEASE_SCREENS)) {
        // far off screen: give the decoded frames back (a phone must not hold two sequences; a kept sequence stays), nothing else to do
        if (!released) { released = true; if (!keep) st.release(); drawnKey = ""; alone = -1; fadeFrom = -1; }
        return;
      }
      if (released) { released = false; drawnKey = ""; }
      const p = sectionProgress(top, scrollable);
      const f = frameAt(heldProgress(p, endHold), n);
      if (lastF >= 0 && Math.abs(f - lastF) > 0.001) dir = f > lastF ? 1 : -1;
      lastF = f;
      let layers: BlendLayer[], shows: number;
      if (!blend) {
        const cur = Math.round(f);
        st.setCurrent(cur, decodeWindow(dir, false, capacity), dir);
        const base = st.has(cur) ? cur : st.nearest(cur);
        layers = base >= 0 ? [{ index: base, alpha: 1 }] : [];
        shows = base;
      } else {
        // frame i0 whole, i1 over it at alpha t; the decode window holds i0, i1 and the next frame in the scroll direction first
        const { i0, i1, t } = blendAt(f, n);
        st.setCurrent(i0, decodeWindow(dir, true, capacity), dir);
        const base = st.has(i0) ? i0 : st.nearest(Math.round(f));
        const over = base === i0 && i1 !== i0 && st.has(i1) ? i1 : -1;
        // what the canvas should show changed by more than the scroll moved it (a frame arrived late): fade in, do not pop
        if (fadeFrom < 0 && alone >= 0 && base >= 0 && (base !== alone || over >= 0)) { fadeFrom = alone; fadeAt = performance.now(); }
        let k = 1;
        if (fadeFrom >= 0) {
          k = st.has(fadeFrom) ? arrivalFade(performance.now() - fadeAt) : 1;
          if (k >= 1) fadeFrom = -1;
        }
        ({ layers, drawn: shows } = blendLayers({ base, over, t }, fadeFrom, k));
        alone = fadeFrom < 0 && over < 0 ? base : -1;
        if (fadeFrom >= 0) schedule(); // the fade runs on its own, also when the scroll stands still
      }
      // what is on the canvas: the frames and their alphas (in steps); nothing is drawn again while that has not changed
      const key = layers.map((l) => `${l.index}:${Math.round(l.alpha * ALPHA_STEPS)}`).join(" ");
      if (layers.length && key !== drawnKey) {
        drawnKey = key;
        for (const l of layers) paint(st.get(l.index)!, l.alpha);
        ctx.globalAlpha = 1;
        drawn = shows;
        if (!painted) { painted = true; setReady(true); if (keep) startAll(); }
      }
      publish(p, f, drawn);
    };
    function schedule() { if (!raf && alive) raf = requestAnimationFrame(draw); }
    const onScroll = () => schedule();

    // when to fetch (see the head of the file)
    const cleanups: (() => void)[] = [];
    if (priority) {
      const intents = ["scroll", "wheel", "touchstart", "keydown"] as const;
      const onIntent = () => { st.start(); intents.forEach((e) => removeEventListener(e, onIntent)); };
      intents.forEach((e) => addEventListener(e, onIntent, { passive: true }));
      let idle = 0, timer: ReturnType<typeof setTimeout> | undefined;
      const coarse = () => st.start(coarseCount(n));
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
        st.start();
      }, { rootMargin: "100% 0px" });
      io.observe(wrapEl);
      cleanups.push(() => io.disconnect());
    }

    // the section moves in the document when anything above it changes size: the body is observed too
    const ro = new ResizeObserver(() => { measure(); schedule(); });
    ro.observe(stickEl);
    ro.observe(wrapEl);
    ro.observe(document.body);
    const onResize = () => { measure(); schedule(); };
    schedule();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (idleAll && typeof cancelIdleCallback === "function") cancelIdleCallback(idleAll);
      if (timerAll) clearTimeout(timerAll);
      if (scrimEl) scrimEl.style.opacity = "";
      if (overlayEl) overlayEl.style.opacity = "";
      cleanups.forEach((c) => c());
      ro.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      st.dispose();
      delete wrapEl.dataset.loading;
      setReady(false);
    };
    // `variant` is read through sequenceKey (its URLs are stable for a given key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStill, sequenceKey, blend, priority, endHold, retain, navTone]);

  return (
    // a still sequence is a plain picture with text under it: the bar is not clear over it (a `.night` block makes it dark glass)
    <div ref={wrap} className={`sf ${className ?? ""}`} data-nav={isStill ? undefined : navTone} data-still={isStill ? "true" : undefined}
      style={{ "--sf-h": `${height}svh` } as CSSProperties}>
      {navTone === "clear" && <div ref={scrim} className="sf-scrim" aria-hidden />}
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
        <div ref={overlay} className="sf-overlay">{children?.(shown)}</div>
      </div>
    </div>
  );
}
