import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ROUTE_KEYS, ROUTES as APP_ROUTES } from "../src/lib/routes";
import { LOCALES, ROUTES, THREE_ROUTES, analyzeBuild, backdropPrefixProblems, chunkRefs, externalResources, modelFilesIn, modelSchemas } from "./check-bundles.mjs";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

type Fixture = { html?: Record<string, string[]>; extraHtml?: Record<string, string>; chunks: Record<string, string>; css?: Record<string, string> };

/** A fake .next: every page references the shared chunks plus its own list; `chunks` maps names to contents. */
function build(f: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), "bundles-"));
  dirs.push(dir);
  const put = (rel: string, text: string) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  for (const locale of LOCALES) {
    for (const key of Object.keys(ROUTES)) {
      const rel = key === "home" ? `server/app/${locale}.html` : `server/app/${locale}/${key}.html`;
      const own = f.html?.[key] ?? [];
      const tags = ["a", "b", ...own].map((c) => `<script src="/_next/static/chunks/${c}.js" async></script>`).join("");
      put(rel, `<html><head>${f.extraHtml?.[key] ?? ""}</head><body>${tags}</body></html>`);
    }
  }
  for (const [name, text] of Object.entries(f.chunks)) put(`static/chunks/${name}.js`, text);
  for (const [name, text] of Object.entries(f.css ?? {})) put(`static/chunks/${name}.css`, text);
  return dir;
}
const base = { a: "framework();", b: "layout();" };

describe("chunk references", () => {
  it("reads chunk paths with and without the /_next prefix and decodes them", () => {
    const refs = chunkRefs(`<script src="/_next/static/chunks/abc.js?dpl=1"></script> e.A("static/chunks/d%5Be%5D.js")`);
    expect([...refs].sort()).toEqual(["static/chunks/abc.js", "static/chunks/d[e].js"]);
  });
  it("finds scripts and fetching links, not canonical links or anchors", () => {
    const html = `<link rel="canonical" href="https://x.example/a"><a href="https://github.com/x">x</a>
      <script src="https://cdn.example/a.js"></script><link rel="stylesheet" href="https://fonts.example/c.css"><link rel="preconnect" href="https://p.example">`;
    expect(externalResources(html)).toEqual(["https://cdn.example/a.js", "https://fonts.example/c.css", "https://p.example"]);
  });
});

describe("analyzeBuild", () => {
  it("passes when three.js is only on model and sun", () => {
    const dir = build({ html: { model: ["m"], sun: ["s"] }, chunks: { ...base, m: "x WebGLRenderer y", s: "WebGLRenderer" } });
    const r = analyzeBuild(dir);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(LOCALES.length * Object.keys(ROUTES).length);
    expect(r.rows.filter((x) => x.three).map((x) => x.key).sort()).toEqual(["model", "model", "sun", "sun"]);
  });

  it("fails when a 2D page loads three.js, in either language", () => {
    const dir = build({ html: { plan: ["p"], model: ["m"], sun: ["m"] }, chunks: { ...base, p: "WebGLRenderer", m: "WebGLRenderer" } });
    const r = analyzeBuild(dir);
    expect(r.errors.filter((e) => e.includes("three.js is reachable")).map((e) => e.split(":")[0]).sort()).toEqual(["cs /pudorys", "en /en/floor-plan"]);
  });

  it("finds three.js behind a dynamic import of a page-specific chunk", () => {
    const dir = build({ html: { energy: ["e"] }, chunks: { ...base, e: 'load("static/chunks/viewer.js")', viewer: "WebGLRenderer" } });
    expect(analyzeBuild(dir).errors.some((e) => e.startsWith("cs /energie") && e.includes("three.js"))).toBe(true);
  });

  it("does not follow references inside shared chunks (a runtime may list every chunk)", () => {
    const dir = build({ chunks: { a: 'all("static/chunks/viewer.js")', b: "layout();", viewer: "WebGLRenderer" } });
    expect(analyzeBuild(dir).errors).toEqual([]);
  });

  it("warns, but does not fail, when model and sun have no three.js yet", () => {
    const r = analyzeBuild(build({ chunks: base }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.includes("no three.js found yet"))).toHaveLength(4);
  });

  it("fails when a page is missing", () => {
    const dir = build({ chunks: base });
    rmSync(join(dir, "server/app/en/budget.html"));
    expect(analyzeBuild(dir).errors).toEqual(["missing HTML for en /en/budget (budget)"]);
  });

  it("fails on runtime Google Fonts and external scripts", () => {
    const dir = build({
      extraHtml: { gallery: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><script src="https://cdn.example/x.js"></script>' },
      chunks: base,
    });
    const msgs = analyzeBuild(dir).errors.join("\n");
    expect(msgs).toContain("fonts.googleapis.com");
    expect(msgs).toContain("cdn.example");
    expect(msgs).toContain("Google Fonts");
  });

  it("explains an empty build", () => {
    const dir = mkdtempSync(join(tmpdir(), "bundles-"));
    dirs.push(dir);
    mkdirSync(join(dir, "server/app/x"), { recursive: true });
    writeFileSync(join(dir, "server/app/x/y.html"), "");
    expect(analyzeBuild(dir).errors[0]).toContain("x/y.html");
  });
});

describe("built CSS", () => {
  it("finds rules with -webkit-backdrop-filter but no backdrop-filter, also inside @media", () => {
    const css = ".ok{-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}/* .x{ */@media (min-width:1px){.bad[data-a=true]{color:red;-webkit-backdrop-filter:blur(9px)}}.off{-webkit-backdrop-filter:none}.plain{backdrop-filter:blur(1px)}";
    expect(backdropPrefixProblems(css)).toEqual([".bad[data-a=true]", ".off"]);
  });
  it("fails the build check for such a rule and names the file and the selector", () => {
    const dir = build({ chunks: base, css: { good: ".a{backdrop-filter:blur(1px);-webkit-backdrop-filter:blur(1px)}", bad: ".nav{-webkit-backdrop-filter:blur(18px)}" } });
    const errors = analyzeBuild(dir, { modelSchemas: {} }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bad.css");
    expect(errors[0]).toContain(".nav");
  });
});

describe("model data in client chunks", () => {
  const schemas = modelSchemas();
  const [file, id] = Object.entries(schemas)[0];
  it("reads the schema id of every model file", () => {
    expect(Object.keys(schemas).length).toBeGreaterThan(0);
    for (const [f, s] of Object.entries(schemas)) {
      expect(f).toMatch(/^model\/[^/]+\.json$/);
      expect(f).not.toMatch(/\.schema\.json$/);
      expect(typeof s).toBe("string");
    }
  });
  it("recognises bundled JSON in both forms a bundler writes, but not the zod schema or a message", () => {
    expect(modelFilesIn(`e.exports=JSON.parse('{"schema":"${id}","x":1}')`, schemas)).toEqual([file]);
    expect(modelFilesIn(`e.exports={schema:"${id}",x:1}`, schemas)).toEqual([file]);
    expect(modelFilesIn(`e.exports=JSON.parse("{\\"schema\\":\\"${id}\\"}")`, schemas)).toEqual([file]);
    expect(modelFilesIn(`schema:a.z.literal("${id}"),m('Field "schema" is not "${id}"')`, schemas)).toEqual([]);
  });
  it("warns (does not fail) per page, and once for a shared chunk", () => {
    const json = `e.exports={schema:"${id}"}`;
    const page = analyzeBuild(build({ html: { energy: ["e"] }, chunks: { ...base, e: json } }), { modelSchemas: schemas });
    expect(page.errors).toEqual([]);
    expect(page.warnings.filter((w) => w.includes(file)).map((w) => w.split(":")[0]).sort()).toEqual(["cs /energie", "en /en/energy"]);
    const shared = analyzeBuild(build({ chunks: { a: json, b: "layout();" } }), { modelSchemas: schemas });
    expect(shared.errors).toEqual([]);
    expect(shared.warnings.filter((w) => w.includes(file))).toHaveLength(1);
    expect(shared.warnings.find((w) => w.includes(file))).toMatch(/^every page/);
  });
});

describe("route table", () => {
  it("is in step with src/lib/routes.ts (keys, order, slugs)", () => {
    expect(Object.keys(ROUTES)).toEqual([...ROUTE_KEYS]);
    for (const key of ROUTE_KEYS) expect(ROUTES[key]).toEqual(APP_ROUTES[key].slugs);
  });
  it("lets exactly the heavy routes (the 3D pages) load three.js", () => {
    expect([...THREE_ROUTES].sort()).toEqual(ROUTE_KEYS.filter((k) => APP_ROUTES[k].heavy).sort());
  });
});
