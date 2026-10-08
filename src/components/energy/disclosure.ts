"use client";

// Two small behaviours of the tool pages' disclosures and side rails (used by the Energy and Budget pages):
//
// * useOpenWhenWide: groups marked `data-wide-open` are closed in the server HTML (so a phone never receives them open and
//   never sees them snap shut after hydration) and open themselves on a wide screen after mount. The page CSS shows their
//   content on wide screens until then (`:not([data-ready]) details[data-wide-open]::details-content`), so a desktop does not
//   see them jump either.
// * useRailMask: a sticky rail that is taller than the window scrolls on its own; `data-more` tells the CSS to fade its lower
//   edge while there is more below, so the hidden part is never a surprise.

import { useEffect, type RefObject } from "react";

/** Opens `details[data-wide-open]` inside `ref` when `query` matches, then marks `ref` with `data-ready`. Browser only. */
export function useOpenWhenWide(ref: RefObject<HTMLElement | null>, query: string): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (matchMedia(query).matches) root.querySelectorAll<HTMLDetailsElement>("details[data-wide-open]").forEach((d) => (d.open = true));
    root.setAttribute("data-ready", "");
  }, [ref, query]);
}

/** Keeps `data-more` on a scrolling element while part of its content is below the visible area. Browser only. */
export function useRailMask(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const more = el.scrollHeight - el.clientHeight - el.scrollTop > 2;
        el.toggleAttribute("data-more", more);
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("toggle", update, true); // a group opening or closing changes the height of the content
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (ro) {
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    }
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", update);
      el.removeEventListener("toggle", update, true);
      ro?.disconnect();
    };
  }, [ref]);
}
