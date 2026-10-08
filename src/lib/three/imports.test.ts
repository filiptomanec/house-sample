// three.js belongs to the Model and Sun routes only (docs/THREE-API.md principle 9, checked in the bundle by
// scripts/check-bundles.mjs). This test guards the source: nothing outside the engine and those two routes imports three.js
// at runtime, and the engine modules that pages may import for their data do not import it at all.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(__dirname, "..", "..");
const THREE_PACKAGES = /["'](three|three\/[^"']*|three-mesh-bvh|n8ao|postprocessing)["']/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}
const rel = (p: string) => relative(src, p).split(sep).join("/");
const all = files(src).map((f) => ({ file: rel(f), text: readFileSync(f, "utf8") }));

/** Static runtime imports (not `import type`) of a module specifier matching `re`. */
const runtimeImports = (text: string, re: RegExp): string[] =>
  [...text.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+(["'][^"']+["'])/gm)].map((m) => m[1]).filter((s) => re.test(s));

/** Where three.js may be imported: the engine, its React shell and the two pages that use it. */
const allowed = (file: string) =>
  file.startsWith("lib/three/") || file.startsWith("components/three/") || file.startsWith("components/model/") || file.startsWith("components/sun/")
  || file.startsWith("app/[locale]/model/") || file.startsWith("app/[locale]/sun/");

/** The engine modules that need no three.js: pages may import their runtime code anywhere. */
const PURE = ["frame", "views", "style", "context", "glb", "tier", "webgl", "theme", "orbit", "walkCollision"];

describe("three.js stays on the Model and Sun routes", () => {
  it("is imported at runtime only by the engine, its shell, and the Model and Sun components", () => {
    const offenders = all.filter(({ file, text }) => !allowed(file) && runtimeImports(text, THREE_PACKAGES).length).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("the pure engine modules do not import three.js statically", () => {
    for (const name of PURE) {
      const f = all.find((x) => x.file === `lib/three/${name}.ts`);
      expect(f, name).toBeDefined();
      expect(runtimeImports(f!.text, THREE_PACKAGES), name).toEqual([]);
    }
  });

  it("the pure engine modules import only each other, the kernel and data (nothing that loads three.js)", () => {
    const heavy = ["viewer", "house", "interior", "terrain", "surroundings", "vegetation", "blinds", "extBlinds", "pv", "walk", "sunAnalysis", "dispose", "furniture", "roomTags", "sky", "meshBuilder", "outdoor", "merge", "garageDoor", "sunPath"];
    for (const name of PURE) {
      const f = all.find((x) => x.file === `lib/three/${name}.ts`)!;
      for (const spec of runtimeImports(f.text, /["']\.\/[^"']+["']/)) {
        expect(heavy.includes(spec.slice(3, -1)), `${name} imports ${spec}`).toBe(false);
      }
    }
  });

  it("pages outside the two routes import engine code only from the pure modules or as types", () => {
    const offenders: string[] = [];
    for (const { file, text } of all) {
      if (allowed(file) || file.endsWith(".test.ts")) continue;
      for (const spec of runtimeImports(text, /["']@\/(lib|components)\/three\//)) {
        const name = spec.replace(/["']/g, "").split("/").pop()!;
        if (!PURE.includes(name) && name !== "three") offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only the Model and Sun routes load the 3D stage", () => {
    const users = all.filter(({ file, text }) => !file.startsWith("components/three/") && /from\s+["']@\/components\/three\/Stage["']/.test(text)).map((f) => f.file);
    for (const f of users) expect(f.startsWith("components/model/") || f.startsWith("components/sun/") || f.startsWith("app/[locale]/model/") || f.startsWith("app/[locale]/sun/"), f).toBe(true);
  });
});
