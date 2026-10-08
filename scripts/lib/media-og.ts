// The share images (Open Graph 1200 x 630, Twitter 1200 x 600): the og render with the house name composited on it, set like the
// title of the start page. Top left, where the shot list keeps sky for type: a mint dot and a mono label (the hero kicker), then
// the name in two stacked lines in Geist SemiBold (split like the hero title), over a soft dark scrim so white type reads on any
// sky. Every size is relative to the frame, so both formats come from the same layout. ImageMagick arguments only (pure).
import path from "node:path";
import type { ImageSpec } from "./media-plan";

export interface OgText {
  /** The house name in up to two lines ("Dům", "pod ořechem"); an empty second line is skipped. */
  lines: [string, string];
  /** The mono label above the name (set in capitals). */
  label: string;
}

export interface OgStyle {
  /** The mint of the palette (model/style.json `palette.mint`). */
  mint: string;
  /** Geist SemiBold and Geist Mono Medium (TrueType files). */
  sansFont: string;
  monoFont: string;
}

/** The fonts in the geist package (node_modules), relative to the repository root. */
export function ogFonts(root: string): Pick<OgStyle, "sansFont" | "monoFont"> {
  const dir = path.join(root, "node_modules", "geist", "dist", "fonts");
  return { sansFont: path.join(dir, "geist-sans", "Geist-SemiBold.ttf"), monoFont: path.join(dir, "geist-mono", "GeistMono-Medium.ttf") };
}

/** ImageMagick reads `%` sequences and backslash escapes in -annotate text. */
const literal = (s: string): string => s.replaceAll("\\", "\\\\").replaceAll("%", "%%");

/** Reference frame of the layout: sizes below are pixels of a 1200 x 630 card and scale with the frame. */
const BASE = { w: 1200, h: 630 };
const LAYOUT = {
  left: 66,
  labelTop: 70,
  dotRadius: 6,
  labelSize: 18,
  labelTracking: 2.2,
  labelGap: 30,
  nameTop: 112,
  nameSize: 96,
  nameTracking: -4,
  lineStep: 92,
  /** The scrim: a radial darkening centred on the top left corner, reaching this share of the width. */
  scrimReach: 1,
  scrimAlpha: 0.6,
};

/**
 * Arguments of `magick` that turn the render `src` into the share image `dst` of size `spec` (cover-cropped in the middle),
 * with the text composited and every profile and comment stripped (progressive 4:2:0 JPEG).
 */
export function ogCompositeArgs(src: string, dst: string, spec: Pick<ImageSpec, "w" | "h" | "q">, text: OgText, style: OgStyle): string[] {
  const { w, h } = spec;
  const k = Math.min(w / BASE.w, h / BASE.h);
  const px = (v: number): number => Math.round(v * k);
  const L = LAYOUT;
  const reach = Math.round(w * L.scrimReach);
  const dotY = px(L.labelTop + L.labelSize * 0.62);
  const dotX = px(L.left + L.dotRadius + 4);
  const args = [
    src, "-auto-orient", "-alpha", "off", "-depth", "8",
    "-filter", "Lanczos", "-resize", `${w}x${h}^`, "-gravity", "center", "-extent", `${w}x${h}`, "+repage",
    // scrim: centre at the top left corner, transparent at `reach`
    "(", "-size", `${2 * reach}x${2 * reach}`, `radial-gradient:rgba(8,10,12,${L.scrimAlpha})-rgba(8,10,12,0)`, ")",
    "-gravity", "northwest", "-geometry", `-${reach}-${reach}`, "-compose", "over", "-composite",
    "-fill", style.mint, "-draw", `circle ${dotX},${dotY} ${dotX + px(L.dotRadius)},${dotY}`,
    "-font", style.monoFont, "-pointsize", String(px(L.labelSize)), "-kerning", String(L.labelTracking * k), "-fill", "rgba(255,255,255,0.88)",
    "-annotate", `+${px(L.left + L.labelGap)}+${px(L.labelTop)}`, literal(text.label.toLocaleUpperCase("cs")),
    "-font", style.sansFont, "-pointsize", String(px(L.nameSize)), "-kerning", String(L.nameTracking * k), "-fill", "white",
    "-annotate", `+${px(L.left)}+${px(L.nameTop)}`, literal(text.lines[0]),
  ];
  if (text.lines[1]) args.push("-annotate", `+${px(L.left)}+${px(L.nameTop + L.lineStep)}`, literal(text.lines[1]));
  args.push("-strip", "-interlace", "JPEG", "-sampling-factor", "4:2:0", "-quality", String(spec.q), dst);
  return args;
}
