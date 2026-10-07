"use client";
// The React shell of the 3D scene: a sized container with the canvas, a loading state with progress, an error state with a
// retry button, a lost-context state with a restore button, a compass, cleanup on unmount. Used by the Model and Sun pages.
// Specification: docs/THREE-API.md section 11.
//
//  * three.js is loaded lazily: the effect `import()`s "@/lib/three/viewer" and "@/lib/three/house", so the page shell
//    paints first and the 3D chunk streams in after it.
//  * It owns no user-visible text: every string comes in through `labels` (pages take them from their own i18n namespace,
//    keys `<ns>.stage.*`).
//  * `role="status"` + `aria-live="polite"` on the message; the canvas is `role="img"` with `labels.canvas`; the compass is
//    `role="img"` with `labels.compass(heading)`. Buttons are real <button>s, 44 px high on coarse pointers (stage.css).
//  * Retry and restore rebuild the viewer (no page reload). StrictMode safe: a build that finishes after cleanup disposes
//    what it built.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "@/styles/components/stage.css";
import { getHouseContext, sceneExtent, type HouseContext } from "@/lib/three/context";
import { webViews } from "@/lib/three/views";
import { isWebGlAvailable } from "@/lib/three/webgl";
import type { BuildHouseOptions, HouseScene } from "@/lib/three/house";
import type { Viewer, ViewerOptions } from "@/lib/three/viewer";

/** Strings the page supplies (translated; numbers formatted with the page's formatter). */
export interface StageLabels {
  /** "Loading the model" (shown until the first frame; `progress` replaces it once the size is known). */
  loading: string;
  /** "Loading the model, 42 %": percent is an integer 0..100. */
  progress: (percent: number) => string;
  /** The scene could not be built or loaded. */
  error: string;
  retry: string;
  /** The browser took the graphics memory away (phones do that). */
  lost: string;
  restore: string;
  /** No WebGL: the 3D view is not available here. */
  unsupported: string;
  /** Accessible name of the canvas. */
  canvas: string;
  /** Accessible name of the compass for a heading in degrees. */
  compass: (headingDeg: number) => string;
  /** The north letter in the compass ("N" in English, "S" in Czech). */
  north: string;
}

export type StageStatus = "loading" | "ready" | "error" | "lost" | "unsupported";

/** What the page gets when the scene is ready. Valid until `onDispose`. */
export interface StageHandle {
  ctx: HouseContext;
  viewer: Viewer;
  house: HouseScene;
}

export interface StageProps {
  labels: StageLabels;
  /** Default: `getHouseContext()`. */
  ctx?: HouseContext;
  /** Orbit limits and shadow range: the whole plot (default) or the building with a margin. */
  extent?: "plot" | "house";
  backdrop?: ViewerOptions["backdrop"];
  /** Id of a camera of `house.cameras` with use "web" to start from; default: the first one. */
  initialView?: string;
  /** Options of the house build, except progress and abort (the shell owns those). */
  build?: Omit<BuildHouseOptions, "onProgress" | "signal">;
  viewer?: Pick<ViewerOptions, "shadowRange" | "keyboard" | "transitionMs" | "labels">;
  /** Draw the compass (default true). */
  compass?: boolean;
  /** The scene is built and the first frame is drawn. Called again after a restore with a new handle. */
  onReady?: (handle: StageHandle) => void;
  /** The handle is going away (unmount, retry, restore): drop references, stop walks, dispose add-ons you built. */
  onDispose?: (handle: StageHandle) => void;
  onStatus?: (status: StageStatus) => void;
  className?: string;
  /** Overlay controls inside the stage (view mode, walk button, hints). They sit above the canvas and are positioned by page CSS. */
  children?: ReactNode;
}

/** Frames to wait for the first picture (a hidden tab draws none: the wait is capped), ms. */
const FIRST_FRAME_TIMEOUT = 400;

const nextFrames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, FIRST_FRAME_TIMEOUT);
    const step = (left: number) => requestAnimationFrame(() => (left <= 1 ? (clearTimeout(timer), resolve()) : step(left - 1)));
    step(n);
  });

/** The 3D stage. See the file header for the contract. */
export default function Stage(props: StageProps): ReactNode {
  const { labels, className, children } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<StageHandle | null>(null);
  // the effect must not restart when a page re-renders with new callbacks: it reads the latest props through this ref
  const latest = useRef(props);
  useEffect(() => { latest.current = props; });
  const [status, setStatus] = useState<StageStatus>("loading");
  const [percent, setPercent] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef<StageStatus>("loading");
  const update = useCallback((next: StageStatus) => {
    statusRef.current = next;
    setStatus(next);
    latest.current.onStatus?.(next);
  }, []);

  useEffect(() => {
    const container = rootRef.current;
    if (!container) return;
    let cancelled = false;
    let viewer: Viewer | null = null;
    let house: HouseScene | null = null;
    let handle: StageHandle | null = null;
    let offHeading: (() => void) | null = null;
    const abort = new AbortController();

    (async () => {
      if (!isWebGlAvailable()) { update("unsupported"); return; }
      const [{ createViewer, WebGlUnavailableError }, { buildHouse }] = await Promise.all([import("@/lib/three/viewer"), import("@/lib/three/house")]);
      if (cancelled) return;
      const p = latest.current;
      const ctx: HouseContext = p.ctx ?? getHouseContext();
      const views = webViews(ctx.house.cameras);
      const initialView = views.find((v) => v.id === p.initialView) ?? views[0];
      try {
        viewer = createViewer(container, {
          bearingDeg: ctx.bearingDeg,
          extent: sceneExtent(ctx, p.extent ?? "plot"),
          initialView,
          backdrop: p.backdrop ?? "stage",
          labels: p.viewer?.labels ?? !!p.build?.formatTag,
          shadowRange: p.viewer?.shadowRange,
          keyboard: p.viewer?.keyboard,
          transitionMs: p.viewer?.transitionMs,
          ariaLabel: p.labels.canvas,
          groundColor: ctx.style.materials.lawn?.color,
          onContextLost: (lost) => {
            if (cancelled) return;
            if (lost) update("lost");
            else if (statusRef.current === "lost") update("ready");
          },
        });
      } catch (e) {
        if (!cancelled) update(e instanceof WebGlUnavailableError ? "unsupported" : "error");
        return;
      }
      const v = viewer;
      offHeading = v.onHeading((h) => {
        if (dialRef.current) dialRef.current.style.transform = `rotate(${-h}deg)`;
        compassRef.current?.setAttribute("aria-label", latest.current.labels.compass(Math.round(h)));
      });
      let last = -1;
      try {
        house = await buildHouse(v, ctx, {
          ...p.build,
          signal: abort.signal,
          onProgress: (f) => {
            const pct = Math.round(f * 100);
            if (pct !== last) { last = pct; setPercent(pct); }
          },
        });
        await v.ready;
        await nextFrames(2);
      } catch (e) {
        if (!cancelled) {
          console.warn("3D scene could not be built", e);
          update("error");
        }
        return;
      }
      // the page was left while the scene was finishing: cleanup has already run, so what was built is freed here
      if (cancelled) { house.dispose(); return; }
      handle = { ctx, viewer: v, house };
      handleRef.current = handle;
      // development hook for manual checks and the e2e tests: the handle of the current scene
      if (process.env.NODE_ENV !== "production") (window as unknown as { __stage?: StageHandle }).__stage = handle;
      update(v.contextLost ? "lost" : "ready");
      latest.current.onReady?.(handle);
    })();

    return () => {
      cancelled = true;
      abort.abort();
      if (handle) latest.current.onDispose?.(handle);
      handleRef.current = null;
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __stage?: StageHandle }).__stage;
      offHeading?.();
      house?.dispose();
      viewer?.dispose();
    };
  }, [attempt, update]);

  // a language change renames the canvas without rebuilding the scene
  useEffect(() => {
    handleRef.current?.viewer.renderer.domElement.setAttribute("aria-label", labels.canvas);
  }, [labels.canvas]);

  const message =
    status === "loading" ? (percent > 0 ? labels.progress(percent) : labels.loading)
    : status === "error" ? labels.error
    : status === "lost" ? labels.lost
    : status === "unsupported" ? labels.unsupported
    : "";
  const action = status === "error" ? labels.retry : status === "lost" ? labels.restore : null;
  const rebuild = () => {
    setPercent(0);
    update("loading");
    setAttempt((n) => n + 1);
  };

  return (
    <div ref={rootRef} className={className ? `stage ${className}` : "stage"} data-status={status} role="group" aria-label={labels.canvas}>
      {children}
      {props.compass !== false && (
        <div ref={compassRef} className="compass" role="img" aria-label={labels.compass(0)} hidden={status !== "ready"}>
          <div ref={dialRef} className="compass-dial" aria-hidden>
            <svg viewBox="0 0 40 40" focusable="false">
              <circle cx="20" cy="20" r="18" className="compass-ring" />
              <path d="M20 5 L25 21 L20 18 L15 21 Z" className="compass-needle" />
            </svg>
            <span className="compass-n">{labels.north}</span>
          </div>
        </div>
      )}
      <div className="stage-msg" role="status" aria-live="polite" data-visible={status !== "ready"}>
        {message && <p>{message}</p>}
        {status === "loading" && <div className="stage-bar" aria-hidden><i style={{ "--stage-p": percent / 100 } as CSSProperties} /></div>}
        {action && <button type="button" className="btn sm" onClick={rebuild}>{action}</button>}
      </div>
    </div>
  );
}
