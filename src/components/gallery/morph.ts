// Shared-element morph between a tile and the lightbox with the View Transitions API; a plain swap where it is unsupported
// or the visitor prefers reduced motion. Browser only.
const NAME = "gal-hero";

const supported = (): boolean =>
  typeof document !== "undefined" && typeof document.startViewTransition === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs `update` (a synchronous state change, e.g. inside flushSync) with a morph from or to the thumbnail `thumb`. */
export function morph(update: () => void, thumb: HTMLElement | null | undefined, direction: "open" | "close"): void {
  if (!supported()) { update(); return; }
  if (direction === "open" && thumb) {
    thumb.style.viewTransitionName = NAME;
    const o = document.startViewTransition(() => { thumb.style.viewTransitionName = ""; update(); });
    // a skipped transition (closed again at once) rejects its promises: that is expected, not an error
    void o.ready.catch(() => {}); void o.updateCallbackDone.catch(() => {}); void o.finished.catch(() => {});
    return;
  }
  // closing: morph back only into a thumbnail that is already decoded, otherwise just cross-fade
  const t = document.startViewTransition(() => {
    update();
    const img = thumb as HTMLImageElement | null | undefined;
    if (img && img.complete && img.naturalWidth) img.style.viewTransitionName = NAME;
  });
  void t.ready.catch(() => {}); void t.updateCallbackDone.catch(() => {});
  void t.finished.catch(() => {}).finally(() => { if (thumb) thumb.style.viewTransitionName = ""; });
}

/** The name the lightbox image carries so that the morph has a partner. */
export const HERO_NAME = NAME;
