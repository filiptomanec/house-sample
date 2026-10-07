"use client";
import { useSyncExternalStore } from "react";
import { MQ } from "@/styles/breakpoints";

/** True on narrow screens (phones, up to the "sm" breakpoint), so SVG charts can use a narrower viewBox. */
export function useNarrow(query: string = MQ.maxSm) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(query).matches,
    () => false,
  );
}
