import { afterAll, describe, expect, it } from "vitest";
import { AUTHOR_HANDLE, AUTHOR_NAME, AUTHOR_NOREPLY, NumberIndex, decodeViews, extractNumbers, normalizeText, runGeneric } from "../api.mjs";
import { PLANT, SYNTHETIC_DENYLIST, categoriesOf, cleanupTmp, findingsOf, makeContext, parts, utf16InNoise } from "./helpers";

afterAll(cleanupTmp);

const ctx = makeContext();

describe("normalisation and decoded views", () => {
  it("folds diacritics, case, whitespace, dashes and invisible characters", () => {
    expect(normalizeText("Příliš\u00a0žluťoučký \u2013 KŮŇ").text).toBe("prilis zlutoucky - kun");
    expect(normalizeText("a\u00adb\u200bc").text).toBe("abc");
    expect(normalizeText("Ł ß").text).toBe("l ss");
  });

  it("keeps a position map when lengths differ", () => {
    const { text, map } = normalizeText("x\u00e9\u00dfy");
    expect(text).toBe("xessy");
    expect(map?.[text.indexOf("y")]).toBe(3);
  });

  it("decodes HTML entities, URL escapes and unicode escapes", () => {
    const views = decodeViews("Kon&#283; %C4%9B \\u011b &Zcaron;");
    expect(views).toHaveLength(2);
    expect(views[1].text).toBe("Kon\u011b \u011b \u011b \u017d");
    expect(decodeViews("plain text")).toHaveLength(1);
  });
});

describe("denylist literals", () => {
  const variants = [
    PLANT.place,
    "zorblax village",
    "ZORBLAX-VILLAGE",
    "zorblax_village",
    "zorblax.village",
    "zorblax/village",
    "zorblaxvillage",
    "ZorblaxVillage",
    "zorblax%20village",
    "Zorblax\u00a0Village",
    "Zorblax\\u0020Village",
    "Zorbl\\u0061x Village",
    "&#90;orblax Village",
    "Zorblax&nbsp;Village",
    "Zorblax+Village",
    "\uff3aorblax Village", // full-width letter
  ];
  it.each(variants)("finds %j", (v) => {
    expect(categoriesOf(ctx, `before ${v} after`)).toContain("denylist/place");
  });

  it("finds inflected stems and missing diacritics", () => {
    expect(categoriesOf(ctx, "v obci Quuxvíle a Quuxvili")).toContain("denylist/place");
  });

  it("respects word boundaries for short words", () => {
    expect(categoriesOf(ctx, "a kru stands here")).toContain("denylist/place");
    expect(categoriesOf(ctx, "krumlov and akru")).toEqual([]);
  });

  it("matches case- and diacritics-sensitively in word-cs mode", () => {
    expect(categoriesOf(ctx, "The Wumpa lives")).toContain("denylist/place");
    expect(categoriesOf(ctx, "the wumpa lives, Wumpas too")).toEqual([]);
  });

  it("applies denylist regexes to the normalised text", () => {
    expect(categoriesOf(ctx, `ref ${PLANT.regexHit}`)).toContain("denylist/place");
  });

  it("finds literals in file names and reports no line", () => {
    const f = ctx.scanner.scanText(`dir/${PLANT.slug}.png`, { path: "x", field: "file-name", noisy: true });
    expect(f.map((x) => x.category)).toContain("denylist/domain");
  });

  it("finds UTF-8 and UTF-16LE text inside binary data", () => {
    const noise = Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from(`xx ${PLANT.place} yy`), Buffer.from([0, 0, 7])]);
    expect(categoriesOf(ctx, noise, "blob.bin")).toContain("denylist/place");
    expect(categoriesOf(ctx, utf16InNoise(PLANT.place), "blob.bin")).toContain("denylist/place");
    const odd = Buffer.concat([Buffer.from([9]), utf16InNoise(PLANT.place)]);
    expect(categoriesOf(ctx, odd, "blob.bin")).toContain("denylist/place");
  });

  it("scans UTF-16 text files with a byte order mark", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`hello ${PLANT.place}`, "utf16le")]);
    expect(categoriesOf(ctx, buf, "notes.txt")).toContain("denylist/place");
  });

  it("reports position and a stable hash, not the value", () => {
    const [a] = findingsOf(ctx, `one\n  ${PLANT.place}`);
    expect(a.line).toBe(2);
    expect(a.col).toBe(3);
    expect(a.hash8).toMatch(/^[0-9a-f]{8}$/);
    const [b] = findingsOf(ctx, "x zorblax-village");
    expect(b.hash8).toBe(a.hash8); // one hash per denylist entry, whatever the spelling
    expect(JSON.stringify(a)).not.toMatch(/zorblax/i);
  });

  it("reports each occurrence on a line but not the decoded duplicate", () => {
    const found = findingsOf(ctx, `${PLANT.place} and ${PLANT.place}`);
    expect(found).toHaveLength(2);
    expect(findingsOf(ctx, "Zorblax\\u0020Village")).toHaveLength(1);
  });
});

describe("generic detectors", () => {
  const cats = (text: string, name = "a.ts") => categoriesOf(ctx, text, name).filter((c) => c.startsWith("generic/"));

  it("flags e-mail addresses except noreply and reserved domains", () => {
    expect(cats(`mail ${parts.email("someone", "mail-host.net")}`)).toContain("generic/email");
    expect(cats(`mail ${parts.email("12345+name", ["users", "noreply", "github", "com"].join("."))}`)).toEqual([]);
    expect(cats(`Co-Authored-By: Claude <${parts.email("noreply", "anthropic.com")}>`)).toEqual([]);
    expect(cats(`a ${parts.email("x", "example.com")} b ${parts.email("y", "site.test")}`)).toEqual([]);
    expect(cats("image@2x.png and pkg@1.2.3")).toEqual([]);
  });

  it("flags phone numbers with a country code and national numbers next to a phone word", () => {
    expect(cats(`call ${parts.phone()}`)).toContain("generic/phone");
    expect(cats(["tel:", "777", "123", "456"].join(" "))).toContain("generic/phone");
    expect(cats("color: rgb(244 241 232 / 0.8); width: 100 200 300")).toEqual([]);
  });

  it("flags URLs unless the host is allowed", () => {
    expect(cats(`see ${parts.url("evil-host.io")}`)).toContain("generic/url");
    expect(cats(`see ${parts.url("nextjs.org")} and ${parts.url("host.test")}`)).toEqual([]);
    expect(cats("fetch(`http://localhost:3400${path}`)")).toEqual([]);
    expect(cats(`${parts.url("github.com")}`.replace("/page", `/${AUTHOR_HANDLE}/house-sample`))).toEqual([]);
    expect(cats(`${parts.url("github.com")}`.replace("/page", `/${AUTHOR_HANDLE}/other-repo`))).toContain("generic/url");
    expect(cats(`${parts.url("github.com")}`.replace("/page", "/vercel/geist-font"))).toEqual([]);
  });

  it("allows any ordinary host in documentation files but not credentials", () => {
    expect(cats(`see ${parts.url("some-docs.io")}`, "docs/a.md")).toEqual([]);
    expect(cats(`see ${parts.url(["user:pw", "some-docs.io"].join("@"))}`, "docs/a.md")).toContain("generic/url-credentials");
  });

  it("flags absolute paths with a user name and home-folder paths", () => {
    expect(cats(`const p = "${parts.userPath("someone")}"`)).toContain("generic/abs-path");
    expect(cats(`cwd ${["C:", "Users", "someone", "x"].join("\\")}`)).toContain("generic/abs-path");
    expect(cats(`/Us${"ers"}/<name>/x and /Us${"ers"}/runner/work`)).toEqual([]);
    expect(cats(`cd ~/${"Down" + "loads"}/thing`)).toContain("generic/home-path");
  });

  it("flags parcel, cadastre and house number patterns", () => {
    expect(cats(["pozemek", "parc.", "č.", "123/4"].join(" "))).toContain("generic/parcel");
    expect(cats(["stavba", "č.", "p.", "55"].join(" "))).toContain("generic/house-number");
    expect(cats(["k.", "ú.", "Nějakéměsto"].join(" "))).toContain("generic/cadastre");
  });

  it("flags coordinates in several notations", () => {
    expect(cats(`pos ${parts.latlon()}`)).toContain("generic/latlon");
    expect(cats(`"lat": ${["49", "123456"].join(".")}`)).toContain("generic/latlon");
    expect(cats(["49°7′", "24″N"].join(""))).toContain("generic/latlon");
    expect(cats([["1123456", "78"].join("."), ["543210", "12"].join(".")].join(" "))).toContain("generic/grid-coordinates");
    expect(cats('"lat": 49.2, "lon": 16.6')).toEqual([]);
  });

  it("flags tokens, keys, uuids and ids", () => {
    expect(cats(`const t = "${parts.token()}"`)).toContain("generic/token");
    expect(cats(parts.pem())).toContain("generic/token");
    expect(cats(`id ${["123e4567", "e89b", "42d3", "a456", "426614174000"].join("-")}`)).toContain("generic/uuid");
    expect(cats(`rč ${["745112", "0006"].join("/")}`)).toContain("generic/national-id"); // valid checksum
    expect(cats(`rč ${["745112", "0007"].join("/")}`)).toEqual([]);
    expect(cats("process.env.API_KEY and password: string")).toEqual([]);
  });

  it("keeps ordinary code and prose quiet", () => {
    const sample = [
      "export const roofPitch = 33.0; // degrees",
      "const [a, b] = items.at(-1) ?? [0, 0];",
      "Plocha pozemku je 1 234 m² a dům má 5 místností.",
      "v1.2.3 build 20260101 #ff00aa rgb(1 2 3)",
      '{"x": [1.234, 5.678, 9.1011], "y": 3}',
      "see .env.local and TimerNode.LOCAL, then args.local ? 1 : 2",
      "m[ 10 ] = 0.5 * m[ 10 ] + 0.5 * m[ 11 ]; i = (f[a>>2]|0)+1794895138|0;",
      `${"x".repeat(1600)};${["b", "asm", "sk"].join(".")}).apply(null)`,
      "export const wall = [0.5, 10, 0.5, 11, 14, 0.5];",
    ].join("\n");
    expect(cats(sample)).toEqual([]);
  });

  it("runGeneric exposes positions without values", () => {
    const g = runGeneric(`x ${parts.phone()}`, { allowlist: { hostAllowed: () => false, urlAllowed: () => false } });
    expect(g[0]).toMatchObject({ category: "generic/phone", index: 2 });
  });
});

describe("author allowlist", () => {
  const denyAuthor = { version: 1, categories: { person: { literals: [{ v: AUTHOR_NAME.split(" ")[1], mode: "sub" }] } } };
  const actx = makeContext({ denylistData: denyAuthor });
  it("allows the author in named files and in public handles, nowhere else", () => {
    expect(categoriesOf(actx, `Copyright ${AUTHOR_NAME}`, "LICENSE")).toEqual([]);
    expect(categoriesOf(actx, `Copyright ${AUTHOR_NAME}`, "src/lib/i18n/cs.ts")).toEqual([]);
    expect(categoriesOf(actx, `\u00a9 ${AUTHOR_NAME}`, "src/components/layout/Footer.tsx")).toEqual([]);
    expect(categoriesOf(actx, `"author": "${AUTHOR_NAME}"`, "package.json")).toEqual([]);
    expect(categoriesOf(actx, `author: "${AUTHOR_NAME}"`, "src/lib/site-config.ts")).toEqual([]);
    expect(categoriesOf(actx, `Author: ${AUTHOR_NAME}`, "src/app/page.tsx")).toContain("denylist/person");
    expect(categoriesOf(actx, `Author: ${AUTHOR_NAME}`, "docs/ARCHITECTURE.md")).toContain("denylist/person");
    expect(categoriesOf(actx, `Jane ${AUTHOR_NAME.split(" ")[1]} wrote it`, "README.md")).toContain("denylist/person");
    expect(categoriesOf(actx, `Co-authored by <${AUTHOR_NOREPLY}>`, "notes.txt")).toEqual([]);
    expect(categoriesOf(actx, `${["https", "://github.com/"].join("")}${AUTHOR_HANDLE}/house-sample`, "src/x.ts")).toEqual([]);
  });

  it("honours local allowlist entries by path, category and hash8", () => {
    const [f] = findingsOf(ctx, PLANT.place, "docs/a.md");
    const actx2 = makeContext({ allowlistData: { findings: [{ path: "docs/**", category: "denylist/place", hash8: f.hash8 }] } });
    expect(categoriesOf(actx2, PLANT.place, "docs/a.md")).toEqual([]);
    expect(categoriesOf(actx2, PLANT.place, "src/a.ts")).toContain("denylist/place");
  });
});

describe("numeric fingerprints", () => {
  const num = (text: string, name = "a.md") => findingsOf(ctx, text, name).filter((f) => f.category === "denylist/plot");

  it("finds a labelled number in all notations", () => {
    for (const t of ["Plocha je 1 234,5 m²", "area 1234.5 m2", "Plocha: 1\u00a0234,5\u00a0m²", "plocha 1,234.5 m2", "plocha 1234,5 m²", '{"floorArea": 1234.5}', "Plocha 1234,52 m²", "výměra 1234.46 m2"]) {
      expect(num(t), t).toHaveLength(1);
    }
  });

  it("ignores the same number without a matching label or unit", () => {
    for (const t of ["font-size: 1234.5px;", '{"width": 1234.5}', "score 1234.5", "at 1234.5 ms"]) expect(num(t), t).toHaveLength(0);
  });

  it("respects the tolerance", () => {
    expect(num("plocha 1234.56 m2")).toHaveLength(0);
    expect(num("plocha 1236 m2")).toHaveLength(0);
  });

  it("matches keyed fingerprints only next to their key", () => {
    expect(num('{"ridge": 9.87, "other": 9.87}')).toHaveLength(1);
    expect(num("ridge height 9,87 m")).toHaveLength(1);
    expect(num("height 9.87")).toHaveLength(0);
  });

  it("finds sequences of consecutive numbers and rounded copies", () => {
    expect(num("[1.11,2.22,3.33,4.44,5.55,6.66]", "a.json")).toHaveLength(1);
    expect(num("[0, 1.11, 2.22, 3.33, 4.44]", "a.json")).toHaveLength(1);
    expect(num("x=1.11 y=2.22 z=3.33 w=4.44", "a.json")).toHaveLength(1);
    expect(num("1.11 2.22 3.33", "a.json")).toHaveLength(0); // only three
    expect(num("1.11, 9.99, 3.33, 4.44, 5.55", "a.json")).toHaveLength(0);
  });

  it("finds a cluster of three rare numbers close together", () => {
    expect(num("a 5432.1 b 6543.21 c 7654.321 d")).toHaveLength(1);
    expect(num("a 5432.1 b 6543.21 d")).toHaveLength(0);
  });

  it("does not trigger on large numeric JSON with random numbers", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const rows = Array.from({ length: 4000 }, () => `{"G":${(rnd() * 900).toFixed(2)},"T":${(rnd() * 30).toFixed(2)},"area":${(rnd() * 30).toFixed(2)}}`);
    expect(num(`[${rows.join(",")}]`, "data.json")).toHaveLength(0);
  });

  it("extractNumbers understands separators", () => {
    const point = extractNumbers("1,2,3 4.5", "point");
    expect(point.vals).toEqual([1, 2, 3, 4.5]);
    const comma = extractNumbers("12,5 and 2.365,8 and 1,234.5", "comma");
    expect(comma.vals).toEqual([12.5, 2365.8, 1234.5]);
  });

  it("builds an index from the synthetic denylist", () => {
    const idx = new NumberIndex(SYNTHETIC_DENYLIST.categories);
    expect(idx.empty).toBe(false);
    expect(new NumberIndex({}).empty).toBe(true);
  });
});
