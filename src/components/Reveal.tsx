"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { MQ } from "@/styles/breakpoints";

/** Fades `.rv` blocks in as they scroll into view. Everything stays visible without JS and with reduced motion. */
export default function Reveal() {
  const path = usePathname();
  useEffect(() => {
    if (matchMedia(MQ.reducedMotion).matches) return;
    const root = document.documentElement;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".rv:not(.in)"));
    els.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight * 0.95) el.classList.add("in"); });
    root.classList.add("js-reveal");
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [path]);
  return null;
}
