import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "./config";
import { MESSAGES, NAMESPACES, type Namespace } from "./messages";
import { getT } from "./server";
import { createT, type Leaf, type Tree } from "./translate";
import { pluralCategory } from "./plural";
import { NBSP } from "./format";

const isLeaf = (v: unknown): v is Leaf => typeof v === "string" || (typeof v === "object" && v !== null && "other" in v);

function leaves(tree: Tree, prefix = ""): [string, Leaf][] {
  return Object.entries(tree).flatMap(([k, v]) => (isLeaf(v) ? [[prefix + k, v] as [string, Leaf]] : leaves(v as Tree, `${prefix}${k}.`)));
}
const placeholders = (l: Leaf) => [...new Set((typeof l === "string" ? [l] : Object.values(l)).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();

describe("dictionaries", () => {
  it("has the namespaces the architecture names", () => {
    expect([...NAMESPACES].sort()).toEqual(["budget", "common", "energy", "errors", "footer", "gallery", "home", "model", "nav", "plan", "plot", "sun"].sort());
  });

  for (const ns of NAMESPACES) {
    describe(ns, () => {
      const { cs, en } = MESSAGES[ns] as { cs: Tree; en: Tree };
      const csLeaves = leaves(cs), enLeaves = leaves(en);
      it("has the same keys in both languages", () => {
        expect(enLeaves.map(([k]) => k).sort()).toEqual(csLeaves.map(([k]) => k).sort());
      });
      it("has the same placeholders in both languages", () => {
        const enMap = new Map(enLeaves);
        for (const [k, v] of csLeaves) expect(placeholders(enMap.get(k)!), k).toEqual(placeholders(v));
      });
      it("has no empty text and no stray whitespace", () => {
        for (const [k, v] of [...csLeaves, ...enLeaves]) {
          for (const s of typeof v === "string" ? [v] : Object.values(v)) {
            expect(s.trim(), k).toBe(s);
            expect(s.length, k).toBeGreaterThan(0);
          }
        }
      });
      it("uses full plural forms: Czech one/few/other, English one/other", () => {
        for (const [k, v] of csLeaves) if (typeof v !== "string") expect(Object.keys(v).sort(), k).toEqual(["few", "one", "other"]);
        for (const [k, v] of enLeaves) if (typeof v !== "string") expect(Object.keys(v).sort(), k).toEqual(["one", "other"]);
        for (const [k, v] of [...csLeaves, ...enLeaves]) if (typeof v !== "string") expect(placeholders(v), k).toContain("count");
      });
    });
  }

  it("every page namespace has meta title and description (read by buildMetadata)", () => {
    for (const ns of ["home", "plan", "plot", "model", "sun", "energy", "budget", "gallery"] as Namespace[]) {
      for (const l of LOCALES) {
        const t = getT(l);
        expect(t.has(`${ns}.meta.title`), `${ns}.meta.title`).toBe(true);
        expect(t.has(`${ns}.meta.description`), `${ns}.meta.description`).toBe(true);
      }
    }
  });
});

describe("plurals", () => {
  it("Czech: 1, 2-4, 5+ and fractions", () => {
    expect(pluralCategory("cs", 1)).toBe("one");
    expect([2, 3, 4].map((n) => pluralCategory("cs", n))).toEqual(["few", "few", "few"]);
    // 22 is "other" here on purpose: the dictionaries use the three forms the spec names (1 / 2-4 / 5+)
    expect([0, 5, 11, 22, 100, 1.5].map((n) => pluralCategory("cs", n))).toEqual(["other", "other", "other", "other", "other", "other"]);
  });
  it("English: 1 and the rest", () => {
    expect([1, -1].map((n) => pluralCategory("en", n))).toEqual(["one", "one"]);
    expect([0, 2, 5, 1.5].map((n) => pluralCategory("en", n))).toEqual(["other", "other", "other", "other"]);
  });
  it("picks the form and formats the count", () => {
    const cs = getT("cs"), en = getT("en");
    expect(cs("common.count.rooms", { count: 1 })).toBe("1 místnost");
    expect(cs("common.count.rooms", { count: 3 })).toBe("3 místnosti");
    expect(cs("common.count.rooms", { count: 5 })).toBe("5 místností");
    expect(cs("common.count.days", { count: 1200 })).toBe(`1${NBSP}200 dní`);
    expect(en("common.count.rooms", { count: 1 })).toBe("1 room");
    expect(en("common.count.rooms", { count: 2 })).toBe("2 rooms");
  });
});

describe("translator", () => {
  const cs = getT("cs"), en = getT("en");
  // missing messages and parameters are reported with console.warn; keep the test output clean
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("translates by namespace.path", () => {
    expect(cs("nav.items.plan.label")).toBe("Půdorys");
    expect(en("nav.items.plan.label")).toBe("Floor plan");
    expect(cs.locale).toBe("cs");
  });
  it("interpolates strings and numbers (numbers in the locale's format)", () => {
    // numbers are formatted by the locale (so a year must be passed as a string)
    expect(en("footer.rights", { year: "2026", name: "A" })).toBe("© 2026 A");
    expect(en("footer.rights", { year: 2026, name: "A" })).toBe("© 2,026 A");
    expect(cs("common.validation.min", { value: "5 m" })).toBe(`Nejméně 5${NBSP}m.`);
  });
  it("applies Czech non-breaking spaces to the dictionary text", () => {
    expect(cs("nav.items.plan.desc")).toBe(`Místnosti, okna, rozměry a${NBSP}skladby`);
    expect(cs("footer.fiction")).toContain(`a${NBSP}všechny`);
  });
  it("returns the key for a missing message and reports it with has()", () => {
    const partial = createT<unknown>("cs", { common: {} });
    expect(partial.dyn("nav.brand")).toBe("nav.brand");
    expect(cs.has("nav.brand")).toBe(true);
    expect(cs.has("nav.nope")).toBe(false);
    expect(cs.dyn("nav.nope")).toBe("nav.nope");
  });
  it("leaves a placeholder visible when a parameter is missing", () => {
    expect(cs.dyn("footer.rights", { name: "A" })).toBe("© {year} A");
  });
  it("is type-safe: unknown keys and missing parameters do not compile", () => {
    // @ts-expect-error unknown key
    cs("nav.nope");
    // @ts-expect-error parameter `value` is required by the Czech string
    cs("common.validation.min");
    // @ts-expect-error `count` is required by a plural
    cs("common.count.rooms");
    // @ts-expect-error a key without placeholders takes no parameters
    cs("common.close", { x: 1 });
    // @ts-expect-error namespaces are part of the key
    cs("close");
    expect(true).toBe(true);
  });
});
