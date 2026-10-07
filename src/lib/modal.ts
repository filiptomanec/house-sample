// Helpers for overlays that take over the screen (menu, lightbox): the page behind them must be
// unreachable by Tab, VoiceOver and clicks while they are open.

const KEEP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NEXT-ROUTE-ANNOUNCER"]);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Makes every direct child of <body> that is not (and does not contain) one of `keep` inert. Returns the undo. */
export function inertOutside(keep: (Element | null | undefined)[]): () => void {
  const kept = keep.filter((k): k is Element => !!k);
  const changed: HTMLElement[] = [];
  for (const el of Array.from(document.body.children)) {
    if (!(el instanceof HTMLElement) || KEEP_TAGS.has(el.tagName) || el.inert) continue;
    if (kept.some((k) => k === el || el.contains(k))) continue;
    el.inert = true;
    changed.push(el);
  }
  return () => changed.forEach((el) => { el.inert = false; });
}

/**
 * Keeps Tab / Shift+Tab cycling inside `roots` (taken in the given order). Call from a keydown handler.
 * Focus is moved explicitly, so buttons are reachable in Safari too (it skips them on Tab by default).
 */
export function trapTab(e: KeyboardEvent, roots: (Element | null | undefined)[]) {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey) return;
  const items = roots.flatMap((r) => (r ? Array.from(r.querySelectorAll<HTMLElement>(FOCUSABLE)) : []))
    .filter((el) => el.getClientRects().length > 0);
  if (!items.length) return;
  e.preventDefault();
  const n = items.length, i = items.indexOf(document.activeElement as HTMLElement);
  items[i === -1 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
}
