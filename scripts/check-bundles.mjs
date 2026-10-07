// After `next build`: three.js (WebGLRenderer) may only be loaded by the model and sun pages, in both languages, and
// no page may pull in anything it should not: external script/style hosts, runtime Google Fonts.
//
//   node scripts/check-bundles.mjs [buildDir]        (default: .next; run after `npm run build`)
//
// For every page the static HTML is read and its client chunks collected (script tags and the flight payload). Chunks
// that only load on demand (dynamic import) are found by following the chunk paths written inside non-shared chunks;
// shared chunks (present on every page: framework, runtime, layout) are not followed, because a runtime may know all chunks.
// Exit code 1 when a rule is broken. The checks live in analyzeBuild(), which scripts/check-bundles.test.ts exercises on fixtures.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LOCALES = ["cs", "en"];
/** Route key -> public slug per language. Kept in step with src/lib/routes.ts by scripts/check-bundles.test.ts. */
export const ROUTES = {
  home: { cs: "", en: "" },
  plan: { cs: "pudorys", en: "floor-plan" },
  plot: { cs: "pozemek", en: "plot" },
  model: { cs: "model", en: "model" },
  sun: { cs: "slunce", en: "sun" },
  energy: { cs: "energie", en: "energy" },
  budget: { cs: "rozpocet", en: "budget" },
  gallery: { cs: "galerie", en: "gallery" },
};
/** The only pages that may load three.js. */
export const THREE_ROUTES = new Set(["model", "sun"]);
/** A string every three.js build contains (error messages and the renderer's type name survive minification). */
export const THREE_SIGNATURE = "WebGLRenderer";
/** Rough budgets in KB of raw JavaScript per page, reported as a warning only. */
export const BUDGET_KB = { plain: 700, three: 2600 };

const CHUNK_RE = /(?:\/_next\/)?static\/chunks\/[^"'\\\s)(]+?\.js/g;
const normalize = (ref) => decodeURIComponent(ref.replace(/^\/_next\//, ""));

/** Chunk paths ("static/chunks/x.js") mentioned in a text. */
export function chunkRefs(text) {
  const out = new Set();
  for (const m of text.matchAll(CHUNK_RE)) out.add(normalize(m[0]));
  return out;
}

/** Relations of <link> tags that make the browser fetch something (canonical, alternate, manifest, icon are not fetched resources). */
const FETCHING_REL = /\b(stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch)\b/i;

/** External resources a page loads at run time: <script src>, fetching <link href> (not <a>), CSS @import url(). */
export function externalResources(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel=["']([^"']+)["']/i.exec(m[0])?.[1] ?? "";
    const href = /\bhref=["'](https?:\/\/[^"']+)["']/i.exec(m[0])?.[1];
    if (href && FETCHING_REL.test(rel)) out.push(href);
  }
  for (const m of html.matchAll(/@import\s+url\(["']?(https?:\/\/[^)"']+)/gi)) out.push(m[1]);
  return out;
}

/** The html file of a page: <locale>.html for the home page, <locale>/<key>.html for the others (or .../index.html). */
export function findHtml(appDir, locale, key) {
  const candidates = key === "home" ? [`${locale}.html`, `${locale}/index.html`] : [`${locale}/${key}.html`, `${locale}/${key}/index.html`];
  return candidates.map((c) => join(appDir, c)).find((p) => existsSync(p)) ?? null;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/**
 * Inspects a build. Returns { rows, errors, warnings }; a row is one page in one language.
 * @param {string} buildDir the .next directory
 */
export function analyzeBuild(buildDir) {
  const appDir = join(buildDir, "server", "app");
  const errors = [], warnings = [];
  const cache = new Map();
  const read = (chunk) => {
    if (!cache.has(chunk)) { const p = join(buildDir, chunk); cache.set(chunk, existsSync(p) ? readFileSync(p, "utf8") : null); }
    return cache.get(chunk);
  };

  // 1. the chunks named by each page's HTML
  const pages = [];
  for (const locale of LOCALES) {
    for (const key of Object.keys(ROUTES)) {
      const file = findHtml(appDir, locale, key);
      const path = `${locale === "cs" ? "" : "/en"}${ROUTES[key][locale] ? `/${ROUTES[key][locale]}` : ""}` || "/";
      if (!file) { errors.push(`missing HTML for ${locale} ${path} (${key})`); continue; }
      const html = readFileSync(file, "utf8");
      pages.push({ locale, key, path, html, initial: chunkRefs(html) });
    }
  }
  if (!pages.length) {
    const found = walk(appDir).filter((f) => f.endsWith(".html")).map((f) => f.slice(appDir.length + 1));
    errors.length = 0; // one explanation instead of sixteen "missing" lines
    errors.push(`no page HTML found under ${appDir}; HTML files present: ${found.slice(0, 20).join(", ") || "none"}`);
    return { rows: [], errors, warnings };
  }

  // 2. chunks present on every page are shared (framework, runtime, layout): their contents count, their references are not followed
  const shared = new Set([...pages[0].initial].filter((c) => pages.every((p) => p.initial.has(c))));

  const rows = [];
  for (const p of pages) {
    const all = new Set(p.initial), lazy = new Set(), missing = new Set();
    const queue = [...p.initial];
    while (queue.length) {
      const c = queue.pop();
      const text = read(c);
      if (text === null) { missing.add(c); continue; }
      if (shared.has(c)) continue;
      for (const r of chunkRefs(text)) if (!all.has(r)) { all.add(r); lazy.add(r); queue.push(r); }
    }
    const withThree = [...all].filter((c) => (read(c) ?? "").includes(THREE_SIGNATURE));
    const bytes = [...all].reduce((n, c) => n + (read(c)?.length ?? 0), 0);
    rows.push({ ...p, chunks: all.size, lazy: lazy.size, kb: Math.round(bytes / 1024), three: withThree.length > 0, threeIn: withThree, missing: [...missing] });
  }

  // 3. rules
  for (const r of rows) {
    const label = `${r.locale} ${r.path}`;
    const allowed = THREE_ROUTES.has(r.key);
    if (r.three && !allowed) errors.push(`${label}: three.js is reachable (${r.threeIn.slice(0, 2).join(", ")}); only ${[...THREE_ROUTES].join(" and ")} may load it`);
    if (!r.three && allowed) warnings.push(`${label}: no three.js found yet (a placeholder page, or the viewer is loaded in a way this script cannot see)`);
    for (const url of externalResources(r.html)) errors.push(`${label}: loads an external resource at run time: ${url}`);
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.html)) errors.push(`${label}: references Google Fonts (fonts must be self-hosted)`);
    if (r.missing.length) warnings.push(`${label}: ${r.missing.length} chunk(s) named in the page were not found on disk (e.g. ${r.missing[0]})`);
    const budget = allowed ? BUDGET_KB.three : BUDGET_KB.plain;
    if (r.kb > budget) warnings.push(`${label}: ${r.kb} KB of JavaScript is over the ${budget} KB guide for this kind of page`);
  }
  // the two languages of a page should ship (nearly) the same code
  for (const key of Object.keys(ROUTES)) {
    const [a, b] = LOCALES.map((l) => rows.find((r) => r.locale === l && r.key === key));
    if (a && b && Math.abs(a.kb - b.kb) > Math.max(20, a.kb * 0.15)) warnings.push(`${key}: ${a.kb} KB in ${a.locale} but ${b.kb} KB in ${b.locale}`);
  }
  return { rows, errors, warnings };
}

function main(argv) {
  const dir = resolve(argv[2] ?? ".next");
  if (!existsSync(dir)) { console.error(`${dir} not found: run "npm run build" first`); return 1; }
  const { rows, errors, warnings } = analyzeBuild(dir);
  for (const r of rows) {
    const bad = errors.some((e) => e.startsWith(`${r.locale} ${r.path}:`));
    const lazy = r.lazy ? `, ${r.lazy} lazy` : "";
    console.log(`${bad ? "✗" : "✓"} ${r.locale} ${r.path.padEnd(18)} ${String(r.chunks).padStart(3)} chunks${lazy}, ${r.kb} KB${r.three ? ", three.js" : ""}`);
  }
  for (const w of warnings) console.warn(`! ${w}`);
  for (const e of errors) console.error(`✗ ${e}`);
  console.log(errors.length ? `\n${errors.length} problem(s)` : "\nthree.js only on model and sun; no external runtime resources");
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
