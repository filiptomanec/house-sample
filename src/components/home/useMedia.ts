"use client";
import { useSyncExternalStore } from "react";

/** Live result of a media query; false on the server and during hydration, then the real value. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => matchMedia(query).matches,
    () => false,
  );
}
