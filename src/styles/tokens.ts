// Reading design tokens from JavaScript (canvas, SVG attributes, three.js). Browser only.
// Components never hard-code colours: a canvas asks for "--series-pv" and gets the colour of the current scheme.

/** Resolved value of a custom property on <html>, e.g. "rgb(20, 150, 111)" for a colour. Empty string on the server. */
export function readToken(name: string, el: Element = document.documentElement): string {
  if (typeof document === "undefined") return "";
  // light-dark() is resolved where the property is used, so resolve it through a probe element
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  el.appendChild(probe);
  const value = getComputedStyle(probe).color || getComputedStyle(el).getPropertyValue(name).trim();
  probe.remove();
  return value;
}

/** Several tokens at once: { "--zone-day": "rgb(...)", ... }. */
export function readTokens<N extends string>(names: readonly N[], el?: Element): Record<N, string> {
  return Object.fromEntries(names.map((n) => [n, readToken(n, el)])) as Record<N, string>;
}

/** A length token such as --bp-md as a number of pixels. */
export function readPx(name: string): number {
  if (typeof document === "undefined") return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/** Subscribes to scheme changes (system or the theme switch). Returns the unsubscribe function. */
export function onSchemeChange(cb: () => void): () => void {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => { mq.removeEventListener("change", cb); mo.disconnect(); };
}
