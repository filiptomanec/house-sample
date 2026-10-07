// Colour maths for the design checks (tests and docs): WCAG contrast, hue/saturation, token parsing. Pure, no DOM.

export type RGB = [number, number, number];

export function parseHex(hex: string): RGB {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a)), lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Hue (degrees), saturation and value (both 0-1) in the HSV model. */
export function hsv(hex: string): { h: number; s: number; v: number } {
  const [r, g, b] = parseHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

/** The user's taste: no orange, amber, honey or terracotta. True for any vivid, mid-bright colour with a hue between orange and amber. */
export function isOrangeish(hex: string): boolean {
  const { h, s, v } = hsv(hex);
  return h >= 12 && h <= 52 && s >= 0.35 && v >= 0.35;
}

export type TokenPair = { light: string; dark: string };
export type SchemeTokens = {
  /** Declarations of the plain :root block (light values and all scheme-independent tokens). */
  light: Record<string, string>;
  /** Declarations of the forced dark block (:root[data-theme="dark"], .scheme-dark, .night). */
  dark: Record<string, string>;
  /** Declarations of the dark block inside @media (prefers-color-scheme: dark). */
  darkMedia: Record<string, string>;
};

/** Splits CSS into top-level rules: { selector, body }, where an at-rule's body is its nested CSS. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    let depth = 1, j = open + 1;
    while (depth && j < css.length) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    out.push({ selector: css.slice(i, open).trim(), body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

const declarations = (body: string): Record<string, string> =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, " ")]));

/** Reads the three places where tokens.css declares custom properties (see the header of that file). */
export function parseSchemeTokens(css: string): SchemeTokens {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const top = rules(clean);
  const light = top.find((r) => r.selector === ":root");
  const dark = top.find((r) => r.selector.includes(':root[data-theme="dark"]'));
  const media = top.find((r) => r.selector.startsWith("@media") && r.selector.includes("prefers-color-scheme: dark"));
  const inner = media ? rules(media.body).find((r) => r.selector.startsWith(":root:not")) : undefined;
  if (!light || !dark || !inner) throw new Error("tokens.css: expected a :root block, a forced dark block and a dark media block");
  return { light: declarations(light.body), dark: declarations(dark.body), darkMedia: declarations(inner.body) };
}

/** Colour tokens (plain hex values) with their light and dark value; scheme-independent tokens have the same value twice. */
export function parseColorTokens(css: string): Record<string, TokenPair> {
  const { light, dark } = parseSchemeTokens(css);
  const out: Record<string, TokenPair> = {};
  for (const [name, value] of Object.entries(light)) {
    const d = dark[name] ?? value;
    if (/^#[0-9a-f]{3,6}$/i.test(value) && /^#[0-9a-f]{3,6}$/i.test(d)) out[name] = { light: value, dark: d };
  }
  return out;
}
