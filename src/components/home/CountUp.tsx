"use client";
import { useEffect, useRef } from "react";
import { useFormat } from "@/lib/i18n/client";
import { MQ } from "@/styles/breakpoints";

const DURATION_MS = 1400;
/** Ease-out of the fourth order: fast start, slow landing. */
const ease = (k: number) => 1 - (1 - k) ** 4;

/**
 * A number that counts up once when it scrolls into view. The server markup and a page without JavaScript, with reduced
 * motion, or already in view on load show the final value. The text node is updated in place (no re-render per frame); while it
 * counts the span carries `data-counting` (tabular digits, so the width does not jitter; proportional again at rest).
 */
export default function CountUp({ to, decimals = 0 }: { to: number; decimals?: number }) {
  const f = useFormat();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const text = el?.firstChild;
    if (!el || !text || matchMedia(MQ.reducedMotion).matches) return;
    if (el.getBoundingClientRect().top < innerHeight) return; // already in view: keep the final value
    const final = text.nodeValue;
    text.nodeValue = f.num(0, decimals);
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      el.dataset.counting = "";
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / DURATION_MS);
        text.nodeValue = k < 1 ? f.num(to * ease(k), decimals) : final;
        if (k < 1) raf = requestAnimationFrame(step);
        else delete el.dataset.counting;
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); text.nodeValue = final; delete el.dataset.counting; };
  }, [to, decimals, f]);
  return <span ref={ref}>{f.num(to, decimals)}</span>;
}
