import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE } from "../lib/site-config";
import { BREAKPOINTS } from "./breakpoints";
import { contrast, deltaE, isOrangeish, lab, parseColorTokens, parseSchemeTokens } from "./color";

const root = join(__dirname, "..");
const tokensCss = readFileSync(join(__dirname, "tokens.css"), "utf8");
const T = parseColorTokens(tokensCss);
const S = parseSchemeTokens(tokensCss);

/** a* and b* of a colour (CIE Lab): its chroma and hue, whatever its lightness. */
const labAB = (hex: string): [number, number] => { const [, a, b] = lab(hex); return [a, b]; };
/** Difference of two hues in degrees (0-180) in the Lab plane. */
const hueGap = (x: string, y: string) => {
  const h = (hex: string) => { const [a, b] = labAB(hex); return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360; };
  const d = Math.abs(h(x) - h(y)) % 360;
  return Math.min(d, 360 - d);
};

const get = (name: string, scheme: "light" | "dark") => {
  const t = T[name];
  if (!t) throw new Error(`token ${name} is not a plain colour in tokens.css`);
  return t[scheme];
};

describe("token file structure", () => {
  it("keeps the two dark blocks (forced and media query) identical", () => {
    expect(S.darkMedia).toEqual(S.dark);
  });
  it("only overrides tokens in the dark blocks that exist in :root", () => {
    expect(Object.keys(S.dark).filter((n) => !(n in S.light))).toEqual([]);
  });
  it("does not alias scheme-dependent tokens with var() in :root (the alias would be fixed at the root and ignore .night)", () => {
    const allowed = new Set(["--font-sans", "--font-mono", "--font-accent", "--gutter-l", "--gutter-r"]);
    expect(Object.entries(S.light).filter(([n, v]) => v.includes("var(") && !allowed.has(n)).map(([n]) => n)).toEqual([]);
  });
  it("gives every colour the dark block overrides a different value from light (no dead overrides)", () => {
    const same = Object.entries(S.dark).filter(([n, v]) => S.light[n] === v).map(([n]) => n);
    expect(same).toEqual([]);
  });
  it("does not use light-dark(), which Lightning CSS would down-level into toggles that ignore .night", () => {
    expect(tokensCss.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("light-dark(");
  });
  it("keeps the scheme-independent tokens out of the dark blocks (mint, media, night band, sky, sun disc)", () => {
    const fixed = /^--(mint|on-mint|on-media|media-|night-|sky-|sun-disc)/;
    expect(Object.keys(S.dark).filter((n) => fixed.test(n))).toEqual([]);
    for (const n of Object.keys(S.light).filter((k) => fixed.test(k))) expect(T[n] ? T[n].light : S.light[n], n).toBeDefined();
  });
  it("has a sky that follows the sun, not the page: the altitude keys exist and the deprecated aliases equal the day sky", () => {
    for (const k of ["day-top", "day-horizon", "low-horizon", "dusk-top", "dusk-horizon", "night-top", "night-horizon", "glow"]) expect(T[`--sky-${k}`], k).toBeDefined();
    expect(S.light["--sky-top"]).toBe(S.light["--sky-day-top"]);
    expect(S.light["--sky-bottom"]).toBe(S.light["--sky-day-horizon"]);
  });
  it("sinks the night band below the dark page and lets the bar and the menu use it", () => {
    const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const night = /(?:^|\})\s*\.night\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const n of ["--bg", "--bg-2", "--surface", "--scrim"]) expect(night, n).toMatch(new RegExp(`${n}:\\s*var\\(--night-`));
    const lum = (hex: string) => contrast(hex, "#000000");
    expect(lum(get("--night-bg", "dark"))).toBeLessThan(lum(get("--bg", "dark")));
    const nav = readFileSync(join(__dirname, "components", "nav.css"), "utf8");
    expect(nav).toMatch(/\.nav\.scheme-dark\[data-solid="true"\]\s*\{[^}]*var\(--night-scrim\)/);
    expect(nav).toMatch(/data-open="true"\]\s*\{[^}]*var\(--night-bg\)/);
  });
});

describe("colour tokens", () => {
  it("defines light and dark values for the core palette", () => {
    for (const n of ["--bg", "--bg-2", "--surface", "--ink", "--ink-2", "--ink-3", "--accent", "--accent-ink", "--focus"]) expect(T[n], n).toBeDefined();
    for (const n of ["--bg", "--ink", "--accent"]) expect(T[n].light).not.toBe(T[n].dark);
  });

  const text = 4.5, graphic = 3;
  const surfaces = ["--bg", "--bg-2", "--surface"];
  // [foreground, background, minimum ratio, what it is]
  const pairs: [string, string, number][] = [
    ...surfaces.flatMap((s) => [["--ink", s, text], ["--ink-2", s, text], ["--ink-3", s, text], ["--accent-ink", s, text], ["--bad", s, text], ["--good", s, text], ["--info", s, text], ["--plan-dim", s, text]] as [string, string, number][]),
    ...surfaces.flatMap((s) => [["--accent", s, graphic], ["--focus", s, graphic], ["--plan-window", s, graphic], ["--plan-door", s, graphic]] as [string, string, number][]),
    ["--ink", "--surface-2", text], ["--ink-2", "--surface-2", text],
    // graphite controls: the track of a switch that is on, the slider fill, the knob on it
    ...surfaces.map((s) => ["--control-on", s, graphic] as [string, string, number]),
    ["--control-knob-on", "--control-on", graphic],
    ["--accent-ink", "--accent-soft", text], ["--ink", "--accent-soft", text],
    ["--on-mint", "--mint", text],
    ["--bg", "--ink", text],                         // label on a graphite button
    ["--ink", "--stage-bg", text],
    ...["--series-load", "--series-pv", "--series-battery", "--series-grid", "--series-heat", "--series-export", "--series-saving"].flatMap((n) => [[n, "--surface", graphic], [n, "--surface-2", graphic]] as [string, string, number][]),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`--cat-${i}`, "--surface", graphic] as [string, string, number]),
    ["--sun-summer", "--surface", graphic], ["--sun-equinox", "--surface", graphic], ["--sun-winter", "--surface", graphic],
    ["--map-plot-line", "--map-plot", graphic], ["--map-setback", "--map-plot", graphic], ["--map-house", "--map-plot", graphic],
    ["--map-tree", "--map-lawn", 1.5], ["--map-contour", "--map-lawn", 1.5],
    // zones carry labels
    ...["--zone-day", "--zone-night", "--zone-service", "--zone-circulation", "--zone-garage", "--zone-terrace"].flatMap((z) => [["--ink", z, text], ["--ink-2", z, text]] as [string, string, number][]),
    // lit and shaded surfaces must be told apart
    ["--sun-lit", "--sun-shade", 4.5],
  ];
  for (const scheme of ["light", "dark"] as const) {
    it(`meets WCAG AA in the ${scheme} scheme (${pairs.length} pairs)`, () => {
      const failures = pairs
        .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(get(fg, scheme), get(bg, scheme)) }))
        .filter((p) => p.ratio < p.min)
        .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}`);
      expect(failures).toEqual([]);
    });
  }

  // the night band always uses the dark ink on its own, deeper surfaces
  const night = ["--night-bg", "--night-bg-2", "--night-surface"];
  const nightPairs: [string, string, number][] = night.flatMap((s) => [
    ["--ink", s, text], ["--ink-2", s, text], ["--ink-3", s, text], ["--accent-ink", s, text], ["--accent", s, graphic], ["--focus", s, graphic],
  ] as [string, string, number][]);
  it(`meets WCAG AA on the night band (${nightPairs.length} pairs)`, () => {
    const failures = nightPairs
      .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(get(fg, "dark"), get(bg, "dark")) }))
      .filter((p) => p.ratio < p.min)
      .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}`);
    expect(failures).toEqual([]);
  });

  it("keeps the plan zones apart in a legend (every pair at least ΔE 6, in both schemes)", () => {
    const zones = ["--zone-day", "--zone-night", "--zone-service", "--zone-circulation", "--zone-garage"];
    for (const scheme of ["light", "dark"] as const) {
      const close = zones.flatMap((a, i) => zones.slice(i + 1).map((b) => ({ a, b, d: deltaE(get(a, scheme), get(b, scheme)) }))).filter((p) => p.d < 6);
      expect(close.map((p) => `${scheme}: ${p.a} ~ ${p.b} (${p.d.toFixed(1)})`)).toEqual([]);
    }
  });

  it("draws charts in one graphite ramp with mint for PV (no new hue: every series is a neutral or a mint)", () => {
    const series = Object.keys(T).filter((n) => /^--(series-|cat-)/.test(n));
    expect(series.length).toBeGreaterThan(8);
    for (const scheme of ["light", "dark"] as const) {
      const pv = get("--series-pv", scheme);
      const offRamp = series.filter((n) => {
        const chroma = Math.hypot(...labAB(get(n, scheme)));
        // a neutral (low chroma) or a colour close to the mint's hue
        return chroma > 12 && hueGap(get(n, scheme), pv) > 25;
      });
      expect(offRamp, scheme).toEqual([]);
    }
  });

  it("has no orange, amber, honey or terracotta anywhere", () => {
    const bad = Object.entries(T).flatMap(([n, v]) => [v.light, v.dark].filter(isOrangeish).map((c) => `${n}: ${c}`));
    expect(bad).toEqual([]);
  });

  it("keeps the browser chrome colours of site-config in step with --bg", () => {
    expect(SITE.chrome.light).toBe(get("--bg", "light"));
    expect(SITE.chrome.dark).toBe(get("--bg", "dark"));
  });
});

describe("custom properties", () => {
  function files(dir: string, ext: RegExp): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p, ext) : ext.test(p) ? [p] : [];
    });
  }
  it("every var(--x) used in CSS is declared in a stylesheet or set from TSX (no typos, no leftovers)", () => {
    const css = files(root, /\.css$/).map((f) => ({ f, text: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
    // --font-geist-*: set by next/font on <html>; --bar: the colour hook of .bar i, set inline by the page that draws the bar
    const declared = new Set<string>(["--font-geist-sans", "--font-geist-mono", "--bar"]);
    for (const { text } of css) for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
    // custom properties set inline from components: style={{ "--p": ... }}
    for (const f of files(root, /\.tsx?$/)) for (const m of readFileSync(f, "utf8").matchAll(/["'`](--[\w-]+)["'`]/g)) declared.add(m[1]);
    const missing = css.flatMap(({ f, text }) => [...text.matchAll(/var\(\s*(--[\w-]+)/g)].filter((m) => !declared.has(m[1])).map((m) => `${f.replace(root, "src")}: ${m[1]}`));
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("breakpoints", () => {
  it("are the same in tokens.css and breakpoints.ts", () => {
    for (const [k, v] of Object.entries(BREAKPOINTS)) expect(tokensCss).toContain(`--bp-${k}: ${v}px;`);
  });

  function cssFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
    });
  }
  const allowedMax = new Set<number>(Object.values(BREAKPOINTS));
  const allowedMin = new Set<number>(Object.values(BREAKPOINTS).map((v) => v + 1));

  it("are the only widths used in @media rules of src/styles and src/app", () => {
    const offenders: string[] = [];
    for (const file of [...cssFiles(join(root, "styles")), ...cssFiles(join(root, "app"))]) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/@media[^{]*\{/g)) {
        for (const w of m[0].matchAll(/\(\s*(max|min)-width\s*:\s*([\d.]+)px\s*\)/g)) {
          const px = Number(w[2]);
          if (!(w[1] === "max" ? allowedMax : allowedMin).has(px)) offenders.push(`${file.replace(root, "src")}: ${w[0]}`);
        }
        if (/\bwidth\s*[<>]=?/.test(m[0])) offenders.push(`${file.replace(root, "src")}: range syntax in ${m[0].trim()} (use max-width / min-width)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
