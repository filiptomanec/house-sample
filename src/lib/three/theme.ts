// Reading the design tokens and the colour scheme from the page, so the 3D scene follows the site's theme (the system
// preference and the manual `data-theme` switch). No three.js; browser only (every function is safe on the server).

/** Value of a CSS custom property on the document element, or `fallback` when it is missing or the page has no DOM. */
export function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Is the page in dark mode? The manual switch (`data-theme`) wins over the system preference. */
export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "dark") return true;
  if (forced === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Calls back when the colour scheme of the page changes (system preference or `data-theme`). Returns the unsubscribe function. */
export function onSchemeChange(cb: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => { mq?.removeEventListener("change", cb); mo.disconnect(); };
}

/** Does the visitor ask for less motion? */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
