"use client";
// The panel of the hidden diagnostic mode (?perf=1; PerfGate loads it on demand). It runs its own animation-frame loop and reads
// the scroll position in every frame, counts scroll, resize and visual-viewport events, drains what the frame player reports
// (perfSink.ts) and shows the aggregate (perfStats.ts): the refresh rate idle and while scrolling, the scroll cadence and speed,
// dropped frames by scroll speed and what the player did in them. The live numbers are rewritten twice a second (straight into
// the DOM, so the probe adds no React work while scrolling); two seconds after scrolling stops the panel freezes a summary, and
// "Copy" puts that summary on the clipboard as JSON.
//
// i18n EXCEPTION: a developer tool, so its labels are English and not in the dictionaries; the only such place in the app.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MQ } from "@/styles/breakpoints";
import { decoderMode } from "./frameDecoder";
import type { PerfRecorder } from "./perfSink";
import { hints, panelLines, PerfStats, type ProbeEnv } from "./perfStats";

/** The summary freezes this long after the page last moved. */
const FREEZE_AFTER_MS = 2000;
/** How often the live numbers are rewritten. */
const REFRESH_MS = 500;

const S: Record<"panel" | "bar" | "button" | "text", CSSProperties> = {
  panel: {
    position: "fixed", zIndex: 2147483000, top: "calc(env(safe-area-inset-top) + var(--nav-h, 60px) + 8px)",
    right: "calc(env(safe-area-inset-right) + 8px)", maxWidth: "min(41ch, calc(100vw - 16px - env(safe-area-inset-left) - env(safe-area-inset-right)))",
    padding: "6px 8px", borderRadius: 6, background: "rgba(0, 0, 0, 0.86)", color: "#fff",
    font: "10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace", contain: "content",
  },
  bar: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 },
  button: {
    font: "inherit", color: "inherit", background: "rgba(255, 255, 255, 0.14)", border: "1px solid rgba(255, 255, 255, 0.4)",
    borderRadius: 4, padding: "0 8px", minHeight: 26, cursor: "pointer",
  },
  text: { margin: 0, font: "inherit", whiteSpace: "pre-wrap" },
};

/** The clipboard API needs a secure context; the old way still works where it is missing. */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  area.remove();
  return ok;
}

export default function PerfProbe({ recorder }: { recorder: PerfRecorder }) {
  const text = useRef<HTMLPreElement>(null);
  const control = useRef<{ reset(): void; json(): string } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let stats = new PerfStats();
    let raf = 0, shownAt = -Infinity, frozen: { at: number; json: string } | null = null, frozenMove = -Infinity;
    const vv = window.visualViewport;
    let vvHeight = vv?.height ?? 0;
    const reduced = matchMedia(MQ.reducedMotion);
    const env = (): ProbeEnv => {
      const seqs = recorder.seqs, cv = document.querySelector<HTMLCanvasElement>(".day-hero canvas") ?? document.querySelector<HTMLCanvasElement>(".sf canvas");
      return {
        dpr: devicePixelRatio, viewport: `${innerWidth}x${innerHeight}`, vvHeight: vv ? Math.round(vv.height) : null,
        cores: navigator.hardwareConcurrency || null, reducedMotion: reduced.matches,
        saveData: (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true,
        seq: seqs.findLast((q) => q.priority) ?? seqs.at(-1) ?? null, canvas: cv ? `${cv.width}x${cv.height}` : null, decoder: decoderMode(), ua: navigator.userAgent,
      };
    };
    const view = () => { const s = stats.summary(), e = env(); return { s, e, h: hints(s, e) }; };
    const show = (head: string, v: ReturnType<typeof view>) => { if (text.current) text.current.textContent = panelLines(v.s, v.e, head, v.h).join("\n"); };
    const json = (v: ReturnType<typeof view>) => JSON.stringify({ v: 1, at: new Date().toISOString(), ...v.s, env: v.e, hints: v.h }, null, 1);

    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      stats.events(recorder.drain());
      stats.tick(ts, scrollY);
      const moved = stats.lastMoveAt;
      if (frozen && moved > frozen.at) frozen = null; // scrolling again: live numbers
      if (!frozen && moved > frozenMove && ts - moved > FREEZE_AFTER_MS) {
        const v = view();
        frozenMove = moved;
        frozen = { at: performance.now(), json: json(v) };
        show(`FROZEN ${new Date().toLocaleTimeString("en-GB")} (2 s after scroll)`, v);
      } else if (!frozen && ts - shownAt >= REFRESH_MS) {
        shownAt = ts;
        show("LIVE  scroll slowly, then fast", view());
      }
    };
    const onScroll = () => stats.scrollEvent(performance.now());
    const onResize = () => recorder.sink.mark("resize");
    const onViewport = () => {
      const h = vv?.height ?? 0;
      if (Math.abs(h - vvHeight) < 0.5) return;
      vvHeight = h;
      recorder.sink.mark("viewport", Math.round(h));
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    vv?.addEventListener("resize", onViewport);
    raf = requestAnimationFrame(tick);
    if (text.current) text.current.textContent = "waiting for the first frames…";
    control.current = {
      reset: () => { stats = new PerfStats(); recorder.drain(); frozen = null; frozenMove = -Infinity; shownAt = -Infinity; },
      json: () => frozen?.json ?? json(view()),
    };
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onViewport);
      control.current = null;
    };
  }, [recorder]);

  const copy = () => {
    const data = control.current?.json() ?? "{}";
    const done = (ok: boolean) => { setCopied(ok ? "Copied" : "Copy failed"); setTimeout(() => setCopied(""), 1500); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(data).then(() => done(true), () => done(legacyCopy(data)));
    else done(legacyCopy(data));
  };

  return createPortal(
    <div style={S.panel} data-perf-probe="">
      <div style={S.bar}>
        <b>perf</b>
        <button type="button" style={S.button} onClick={() => control.current?.reset()}>Reset</button>
        <button type="button" style={S.button} onClick={copy}>{copied || "Copy"}</button>
        <button type="button" style={S.button} onClick={() => setHidden((h) => !h)}>{hidden ? "Show" : "Hide"}</button>
      </div>
      <pre ref={text} style={{ ...S.text, display: hidden ? "none" : "block" }} />
    </div>,
    document.body,
  );
}
