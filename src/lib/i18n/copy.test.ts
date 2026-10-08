// Copy lint: the rules of docs/COPY.md that a machine can check, over both dictionaries (and, for the old house name, over
// the files listed in OLD_NAME_SCOPE). A failure names the key and the rule; fix the text, not the test. When a rule has to
// change, change docs/COPY.md in the same commit.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { Locale } from "./config";
import { MESSAGES, NAMESPACES } from "./messages";
import type { Leaf, Tree } from "./translate";
import { TOOL_KEYS } from "../routes";

const ROOT = join(__dirname, "..", "..", "..");

// ------------------------------------------------------------------------------------------- helpers

const isLeaf = (v: unknown): v is Leaf => typeof v === "string" || (typeof v === "object" && v !== null && "other" in v);

/** Every text of a locale as [key, text]; a plural leaf gives one entry per form ("ns.key#few"). */
function texts(locale: Locale): [string, string][] {
  const walk = (tree: Tree, prefix: string): [string, string][] =>
    Object.entries(tree).flatMap(([k, v]): [string, string][] => {
      if (!isLeaf(v)) return walk(v as Tree, `${prefix}${k}.`);
      return typeof v === "string" ? [[prefix + k, v]] : Object.entries(v).map(([form, s]): [string, string] => [`${prefix}${k}#${form}`, s as string]);
    });
  return NAMESPACES.flatMap((ns) => walk(MESSAGES[ns][locale] as Tree, `${ns}.`));
}
const CS = texts("cs"), EN = texts("en");
const BOTH: [Locale, [string, string][]][] = [["cs", CS], ["en", EN]];
const keyOf = (k: string) => k.split("#")[0];

/** Length as a reader sees it: tags dropped, every placeholder counted as a typical value of eight characters. */
const visibleLength = (s: string) => s.replace(/<\/?[a-z]+>/g, "").replace(/\{\w+\}/g, "12 345 m").length;

// ------------------------------------------------------------------------------------------- the old house name

/** The name the house had before the redesign, in every spelling and Czech case. */
const OLD_NAME = /Dlouh\p{L}* střech|Long Roof|long-roof/iu;

/**
 * Where the old name must not appear. Wave 1 covers the files of the copy package only; at the M1 merge, once every package
 * has renamed its files, the orchestrator replaces this list with FULL_SCOPE.
 */
const OLD_NAME_SCOPE = ["src/lib/i18n", "docs/COPY.md", "docs/README.md", "README.md"];
/** The target scope of the rule (the whole repository text). */
export const FULL_SCOPE = ["src", "model", "scripts", "docs", "README.md"];

const TEXT_FILES = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".py", ".sh", ".css", ".txt", ".yml", ".yaml", ".html", ".svg"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out"]);
const THIS_FILE = relative(ROOT, __filename);

function filesIn(path: string): string[] {
  const abs = join(ROOT, path);
  if (!statSync(abs, { throwIfNoEntry: false })) return [];
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs).flatMap((f) => (SKIP_DIRS.has(f) ? [] : filesIn(join(path, f))));
}

describe("the old house name", () => {
  it("appears nowhere in the scanned files", () => {
    const hits = OLD_NAME_SCOPE.flatMap(filesIn)
      .filter((f) => TEXT_FILES.has(extname(f)) && f !== THIS_FILE)
      .flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n").flatMap((line, i) => (OLD_NAME.test(line) ? [`${f}:${i + 1}`] : [])));
    expect(hits).toEqual([]);
  });
  it("the scope list names existing paths", () => {
    for (const p of [...OLD_NAME_SCOPE, ...FULL_SCOPE]) expect(statSync(join(ROOT, p), { throwIfNoEntry: false }), p).toBeTruthy();
  });
});

describe("the house name lives in the model only", () => {
  const house = JSON.parse(readFileSync(join(ROOT, "model", "house.json"), "utf8")) as { name: Record<Locale, string> };
  it("no dictionary text spells the name of the house (use {house})", () => {
    const names = Object.values(house.name).map((n) => n.toLowerCase());
    for (const [locale, list] of BOTH) {
      for (const [k, s] of list) for (const n of names) expect(s.toLowerCase().includes(n), `${locale} ${k}`).toBe(false);
    }
  });
});

// ------------------------------------------------------------------------------------------- Czech typography and grammar

describe("Czech prepositions before placeholders", () => {
  // "v {time}" reads "v 4:48" where Czech needs "ve 4:48", "z {total}" gives "z 12" where Czech needs "ze 12": the vocalised
  // form depends on the value. Pass the time with its preposition (f.at(), "{atSunset}") or rephrase ("{n} / {total}").
  const PREP = /(^|[\s(>])(?:[vVzZkKsSoOuUaAiI]|[vVzZkK]e) \{/u;
  it("no one-letter word (or ve/ze/ke) stands directly before a placeholder", () => {
    expect(CS.filter(([, s]) => PREP.test(s)).map(([k, s]) => `${k}: ${s}`)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- glossary and voice

type Rule = { locale: Locale; re: RegExp; why: string; allow?: readonly string[] };

/** Terms the glossary (docs/COPY.md) replaces. `allow` lists deprecated keys that keep an old term until they are deleted. */
const BANNED: readonly Rule[] = [
  { locale: "cs", re: /lamelov\p{L}* (?:stěny|stěn\b|zástěn)|zástěn|latě stínění/iu, why: "lamely terasy (one turning louvre wall)" },
  { locale: "cs", re: /kryt\p{L}* stání/iu, why: "the house has no carport" },
  { locale: "cs", re: /obvodov\p{L}* zd/iu, why: "obvodová stěna" },
  { locale: "cs", re: /obytn\p{L}* prostor/iu, why: "obývací pokoj" },
  { locale: "cs", re: /posuvn\p{L}* stěn|zasklen\p{L}* stěn/iu, why: "posuvná prosklená stěna" },
  { locale: "cs", re: /oblet kolem/iu, why: "pleonasm: let kolem domu" },
  { locale: "cs", re: /nosn\p{L}* příč/iu, why: "a příčka is never load-bearing" },
  { locale: "cs", re: /ceník jsou/iu, why: "agreement: ceník je" },
  { locale: "cs", re: /kryt\p{L}* závětří/iu, why: "pleonasm: a závětří is covered" },
  { locale: "cs", re: /(?<!stránk\p{L}{0,2})(?<=[\p{Ll},;:]) Slunc/u, why: "slunce in lower case in running text (Slunce only as the page name)" },
  { locale: "cs", re: /portfolio projekt/iu, why: "portfoliový projekt" },
  { locale: "cs", re: /datově řízen/iu, why: "no data-driven jargon" },
  { locale: "cs", re: /živ\p{L}* plot/iu, why: "one fence system, no hedges", allow: ["plot.legend.hedge"] },
  { locale: "en", re: /set-backs?/i, why: "setback" },
  { locale: "en", re: /\bprimary (?:bedroom|bathroom)/i, why: "main bedroom (UK English)" },
  { locale: "en", re: /\bpictures?\b/i, why: "image" },
  { locale: "en", re: /\bexterior (?:walls?|blinds?|doors?)\b/i, why: "external" },
  { locale: "en", re: /façade/i, why: "facade" },
  { locale: "en", re: /\bhip roof/i, why: "hipped roof" },
  { locale: "en", re: /\bslat(?:ted)? screens?\b/i, why: "louvres" },
  { locale: "en", re: /covered parking/i, why: "the house has no carport" },
  { locale: "en", re: /flight around/i, why: "fly-around" },
  { locale: "en", re: /\bterraces\b/i, why: "the house has one terrace" },
  { locale: "en", re: /\bphotovoltaics\b/i, why: "solar panels (PV in dense tables)" },
  { locale: "en", re: /heat for heating/i, why: "space heating" },
  { locale: "en", re: /\b(?:color|colors|center|centers|liter|liters|gray|favor|behavior)\b/i, why: "UK spelling" },
  { locale: "en", re: /data-driven/i, why: "no data-driven jargon" },
];

describe("glossary", () => {
  for (const rule of BANNED) {
    it(`${rule.locale}: ${rule.re.source} (${rule.why})`, () => {
      const list = rule.locale === "cs" ? CS : EN;
      expect(list.filter(([k, s]) => rule.re.test(s) && !rule.allow?.includes(keyOf(k))).map(([k]) => k)).toEqual([]);
    });
  }
  it("the louvre strings in common.shading only turn (no sliding)", () => {
    for (const [, list] of BOTH) expect(list.filter(([k, s]) => k.startsWith("common.shading.") && /posun|sjet|sjížd|slide/i.test(s)).map(([k]) => k)).toEqual([]);
  });
});

describe("one voice about the method and the fiction", () => {
  // "fictional" belongs to four places: the hero note, the plot box, the About line and the footer (common.fiction is the
  // deprecated footer and menu line)
  const FICTION: Record<Locale, RegExp> = {
    cs: /fiktivn|vymyšlen|smyšlen|neexistuj|jen v počítači/iu,
    en: /fiction|invented|imaginary|made[ -]up|does(?: not|n't) exist|only on screen/i,
  };
  const FICTION_KEYS = ["home.hero.note", "plot.fiction", "home.about.fiction", "footer.fiction", "footer.about.text", "common.fiction"];
  it("the house is called invented only in the hero note, the plot box, the About line and the footer", () => {
    for (const [locale, list] of BOTH) {
      expect(list.filter(([k, s]) => FICTION[locale].test(s) && !FICTION_KEYS.includes(keyOf(k))).map(([k]) => `${locale} ${k}`)).toEqual([]);
    }
  });
  const DATA_MODEL: Record<Locale, RegExp> = { cs: /datov\p{L}* model/giu, en: /\bdata model\b/gi };
  it("the data model is named once, in the About section", () => {
    for (const [locale, list] of BOTH) {
      const hits = list.flatMap(([k, s]) => [...s.matchAll(DATA_MODEL[locale])].map(() => k));
      expect(hits, locale).toEqual(["home.about.lede"]);
    }
  });
});

// ------------------------------------------------------------------------------------------- page frame and headings

describe("tool pages", () => {
  for (const key of TOOL_KEYS) {
    it(`${key} has a two-voice title, a lede and a teaser in both languages`, () => {
      for (const locale of ["cs", "en"] as const) {
        const ns = MESSAGES[key][locale] as Record<string, unknown>;
        for (const part of ["title", "lede", "teaser"]) expect(typeof ns[part], `${locale} ${key}.${part}`).toBe("string");
        const title = ns.title as string;
        // exactly one accent phrase, and a plain part beside it
        expect(title.match(/<q>/g)?.length, `${locale} ${key}.title`).toBe(1);
        expect(/^.+<q>[^<]+<\/q>.*$|^<q>[^<]+<\/q>.+$/.test(title), `${locale} ${key}.title`).toBe(true);
      }
    });
  }
});

describe("markup", () => {
  const TAGS = new Set(["q", "a", "sub", "b"]);
  it("uses only the known tags, each one closed", () => {
    for (const [locale, list] of BOTH) {
      for (const [k, s] of list) {
        const open = [...s.matchAll(/<([a-z]+)>/g)].map((m) => m[1]);
        const close = [...s.matchAll(/<\/([a-z]+)>/g)].map((m) => m[1]);
        for (const tag of open) expect(TAGS.has(tag), `${locale} ${k}: <${tag}>`).toBe(true);
        expect(close.sort(), `${locale} ${k}`).toEqual(open.sort());
      }
    }
  });
  it("Czech and English mark the same accents", () => {
    const en = new Map(EN);
    for (const [k, s] of CS) {
      const count = (t: string) => (t.match(/<q>/g) ?? []).length;
      if (en.has(k)) expect(count(en.get(k)!), k).toBe(count(s));
    }
  });
});

// ------------------------------------------------------------------------------------------- length and numbers

describe("length", () => {
  // only the texts read at a glance have a cap; method notes may be as long as they need to be
  const caps: { test: (k: string) => boolean; max: number; what: string }[] = [
    { test: (k) => k.startsWith("home.hero.") && k !== "home.hero.alt", max: 100, what: "hero line" },
    { test: (k) => k === "home.hero.alt", max: 140, what: "hero alt" },
    { test: (k) => /(^|\.)lede\w*$/.test(keyOf(k)), max: 220, what: "lede" },
    { test: (k) => /^home\.(day\.moments|orbit)\.\w+\.text\w*$/.test(keyOf(k)), max: 150, what: "caption" },
    { test: (k) => /(^|\.)caption\w*$/.test(keyOf(k)), max: 220, what: "caption" },
  ];
  it("keeps hero lines, ledes and captions short", () => {
    for (const [locale, list] of BOTH) {
      for (const [k, s] of list) {
        for (const c of caps) if (c.test(k)) expect(visibleLength(s), `${locale} ${k} (${c.what} ≤ ${c.max})`).toBeLessThanOrEqual(c.max);
      }
    }
  });
});

describe("numbers", () => {
  // Numbers about the house come from the model through {placeholders}. A dictionary may only write the numbers of names
  // (3D, 404, standards, licences), of conventions (±0,000, 1 : {scale}, 90° = open louvres or a quarter turn) and the
  // typical ranges in the energy setting hints and the keyboard steps of the furniture help.
  const ALLOWED = [/\b3D\b/g, /\b404\b/g, /(?:ČSN )?EN(?: ISO)? \d+(?:-\d+)?/g, /ČSN \d+ \d+(?:-\d+)?/g, /OFL \d\.\d/g, /\bCC0\b/g, /±0[.,]000/g, /\b1 : \{/g, /\b90°/g];
  const ALLOWED_KEYS = [/^energy\.settings\.\w+Hint$/, /^plan\.furniture\.keys$/];
  it("no dictionary text holds a number about the house", () => {
    for (const [locale, list] of BOTH) {
      const offenders = list.filter(([k, s]) => !ALLOWED_KEYS.some((re) => re.test(keyOf(k))) && /\d/.test(ALLOWED.reduce((t, re) => t.replace(re, ""), s).replace(/\{\w+\}/g, "")));
      expect(offenders.map(([k, s]) => `${locale} ${k}: ${s}`)).toEqual([]);
    }
  });
});
