// After `next build`: three.js (WebGLRenderer) may only be loaded by the model and sun pages, in both languages, and
// no page may pull in anything it should not: external script/style hosts, runtime Google Fonts. The built CSS must
// keep the unprefixed backdrop-filter wherever it has the -webkit- one.
//
//   node scripts/check-bundles.mjs [buildDir]        (default: .next; run after `npm run build`)
//
// For every page the static HTML is read and its client chunks collected (script tags and the flight payload). Chunks
// that only load on demand (dynamic import) are found by following the chunk paths written inside non-shared chunks;
// shared chunks (present on every page: framework, runtime, layout) are not followed, because a runtime may know all chunks.
//
// Errors (exit code 1): three.js outside model and sun, an external runtime resource, Google Fonts, a missing page, a
// CSS rule with -webkit-backdrop-filter but no backdrop-filter (the CSS minifier can drop the unprefixed property, and
// then only Safari blurs). Warnings: JavaScript over the size guide, model data (model/*.json) in client chunks.
// The checks live in analyzeBuild(), which scripts/check-bundles.test.ts exercises on fixtures.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const LOCALES = ["cs", "en"];
/** Route key -> public slug per language. Kept in step with src/lib/routes.ts by scripts/check-bundles.test.ts. */
export const ROUTES = {
  home: { cs: "", en: "" },
  model: { cs: "model", en: "model" },
  plan: { cs: "pudorys", en: "floor-plan" },
  plot: { cs: "pozemek", en: "plot" },
  sun: { cs: "slunce", en: "sun" },
  energy: { cs: "energie", en: "energy" },
  budget: { cs: "rozpocet", en: "budget" },
  gallery: { cs: "galerie", en: "gallery" },
};
/** The only pages that may load three.js: the routes marked `heavy` in src/lib/routes.ts (checked by the test). */
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

// ------------------------------------------------------------------------------------------------------------- CSS

/** Declaration blocks of a stylesheet with the selector (or at-rule prelude) in front of each; comments removed. */
function cssBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/** Lower-case property names declared in a block body ("a:b;c:d" -> ["a", "c"]). */
const cssProps = (body) => body.split(";").map((d) => d.slice(0, d.indexOf(":")).trim().toLowerCase()).filter(Boolean);

/**
 * Selectors of the rules that set -webkit-backdrop-filter without the unprefixed backdrop-filter. Such a rule blurs in
 * Safari only (or, with "none", leaves Chromium's blur from another rule in place).
 */
export function backdropPrefixProblems(css) {
  return cssBlocks(css)
    .filter(({ body }) => { const p = cssProps(body); return p.includes("-webkit-backdrop-filter") && !p.includes("backdrop-filter"); })
    .map(({ selector }) => selector || "(no selector)");
}

// ------------------------------------------------------------------------------------------------------- model data

const DEFAULT_MODEL_DIR = fileURLToPath(new URL("../model/", import.meta.url));

/**
 * The model files and their schema ids ({ "model/house.json": "house/1", ... }), read from the model directory. Every
 * model file names its schema in a top-level "schema" field; a bundled copy of the file keeps that pair.
 */
export function modelSchemas(dir = DEFAULT_MODEL_DIR) {
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json") && !n.endsWith(".schema.json")).sort()) {
    try {
      const schema = JSON.parse(readFileSync(join(dir, f), "utf8"))?.schema;
      if (typeof schema === "string") out[`model/${f}`] = schema;
    } catch { /* not a model file */ }
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Model files whose data a chunk contains: a "schema" key followed by the file's schema id, as a bundler writes it
 * (JSON.parse('{"schema":"house/1",...}') or {schema:"house/1",...}). The zod schema (schema: z.literal("house/1")) and
 * messages that quote the id do not match.
 */
export function modelFilesIn(text, schemas) {
  const q = `\\\\?["']`;
  return Object.entries(schemas)
    .filter(([, id]) => new RegExp(`${q}?schema${q}?\\s*:\\s*${q}${escapeRe(id)}${q}`).test(text))
    .map(([file]) => file);
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
 * @param {{ modelSchemas?: Record<string, string> }} [options] model files to look for (default: read from model/)
 */
export function analyzeBuild(buildDir, options = {}) {
  const schemas = options.modelSchemas ?? modelSchemas();
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
    const model = [...new Set([...all].filter((c) => !shared.has(c)).flatMap((c) => modelFilesIn(read(c) ?? "", schemas)))].sort();
    rows.push({ ...p, chunks: all.size, lazy: lazy.size, kb: Math.round(bytes / 1024), three: withThree.length > 0, threeIn: withThree, model, missing: [...missing] });
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
    if (r.model.length) warnings.push(`${label}: client JavaScript contains ${r.model.join(", ")}; pass derived values from a server component instead`);
  }
  // model data in a chunk that every page loads: a client component of the layout imports the model (or site-config)
  const sharedModel = [...new Set([...shared].flatMap((c) => modelFilesIn(read(c) ?? "", schemas)))].sort();
  if (sharedModel.length) warnings.push(`every page: a shared client chunk contains ${sharedModel.join(", ")}; never import the model or site-config into a client component of the layout`);

  // built CSS: every -webkit-backdrop-filter needs the unprefixed property next to it
  for (const file of walk(join(buildDir, "static")).filter((f) => f.endsWith(".css")).sort()) {
    for (const sel of backdropPrefixProblems(readFileSync(file, "utf8"))) {
      errors.push(`${relative(buildDir, file)}: "${sel.slice(0, 80)}" has -webkit-backdrop-filter without backdrop-filter (only Safari would blur)`);
    }
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
  console.log(errors.length ? `\n${errors.length} problem(s)` : "\nthree.js only on model and sun; no external runtime resources; backdrop-filter unprefixed everywhere");
  return errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv));
