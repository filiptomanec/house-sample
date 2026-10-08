"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { MQ } from "@/styles/breakpoints";

/** Blocks that reveal on scroll: `.rv` (fade and rise; headings wipe, figure rows stagger) and `.rv-media` (pictures). */
const SELECTOR = ".rv:not(.in), .rv-media:not(.in)";

/**
 * Reveals blocks as they scroll into view (styles in components/motion.css). A block already on screen when the page
 * mounts gets `.in` only and never animates; a block that scrolls in gets `.in` and `.play`. Everything stays visible
 * without JS and with reduced motion.
 */
export default function Reveal() {
  const path = usePathname();
  useEffect(() => {
    if (matchMedia(MQ.reducedMotion).matches) return;
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    els.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight * 0.95) el.classList.add("in"); });
    root.classList.add("js-reveal");
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in", "play");
      io.unobserve(e.target);
    }), { rootMargin: "0px 0px -10% 0px" });
    els.forEach((el) => { if (!el.classList.contains("in")) io.observe(el); });
    return () => io.disconnect();
  }, [path]);
  return null;
}
