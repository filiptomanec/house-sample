import { describe, expect, it } from "vitest";
import { Formatter, MINUS, NBSP, VALUE_SLOT, affixes, at, atHours, csTimePreposition, formatEstimate, getFormatter, nb, parseNum, roundSig } from "./format";

const cs = getFormatter("cs");
const en = getFormatter("en");

describe("nb (Czech typography)", () => {
  it("glues single-letter prepositions and conjunctions to the next word", () => {
    expect(nb("dům v zahradě a s terasou")).toBe(`dům v${NBSP}zahradě a${NBSP}s${NBSP}terasou`);
    expect(nb("V domě je k dispozici")).toBe(`V${NBSP}domě je k${NBSP}dispozici`);
  });
  it("does not touch letters inside words", () => {
    expect(nb("pokoj ve zdi")).toBe("pokoj ve zdi");
  });
  it("glues units to the number in both languages", () => {
    expect(nb("plocha 120 m² a 12 kWh")).toBe(`plocha 120${NBSP}m² a${NBSP}12${NBSP}kWh`);
    expect(nb("120 m² of floor", "en")).toBe(`120${NBSP}m² of floor`);
    expect(nb("sklon 12 ° a 30 %")).toBe(`sklon 12${NBSP}° a${NBSP}30${NBSP}%`);
    expect(nb("36 ks po 430 Wp")).toBe(`36${NBSP}ks po 430${NBSP}Wp`);
  });
  it("does not glue a number to a word that merely starts like a unit", () => {
    expect(nb("5 měsíců a 3 hodiny")).toBe(`5 měsíců a${NBSP}3 hodiny`);
  });
  it("keeps digit groups together", () => {
    expect(nb("celkem 1 234 567 Kč")).toBe(`celkem 1${NBSP}234${NBSP}567${NBSP}Kč`);
    expect(nb("rok 2026 a 12 místností")).toBe(`rok 2026 a${NBSP}12 místností`);
  });
  it("keeps day and month of a date together", () => {
    expect(nb("od 15. března do 1. září")).toBe(`od 15.${NBSP}března do 1.${NBSP}září`);
  });
  it("keeps the sea-level abbreviation in one piece", () => {
    expect(nb("240,5 m n. m.")).toBe(`240,5${NBSP}m${NBSP}n.${NBSP}m.`);
    expect(nb("240.5 m a.s.l.", "en")).toBe(`240.5${NBSP}m${NBSP}a.s.l.`);
  });
  it("keeps millions and thousands with the currency", () => {
    expect(nb("7,5 mil. Kč")).toBe(`7,5${NBSP}mil.${NBSP}Kč`);
    expect(nb("120 tis. Kč a 2 mld. Kč")).toBe(`120${NBSP}tis.${NBSP}Kč a${NBSP}2${NBSP}mld.${NBSP}Kč`);
  });
  it("keeps numeric Czech dates together", () => {
    expect(nb("Jaro 20. 3. a léto 21. 6. 2026")).toBe(`Jaro 20.${NBSP}3. a${NBSP}léto 21.${NBSP}6.${NBSP}2026`);
    expect(nb("Spring 20/03", "en")).toBe("Spring 20/03");
  });
  it("keeps dimensions and scales together", () => {
    expect(nb("23,5 × 12,3 m")).toBe(`23,5${NBSP}×${NBSP}12,3${NBSP}m`);
    expect(nb("1 : 100", "en")).toBe(`1${NBSP}:${NBSP}100`);
  });
  it("works through the simple tags of rich text", () => {
    expect(nb("Světlo a stín <q>v kterýkoli den</q>")).toBe(`Světlo a${NBSP}stín <q>v${NBSP}kterýkoli den</q>`);
  });
  it("is idempotent and leaves English prepositions alone", () => {
    const once = nb("v domě 120 m² a 1 234 Kč, 7,5 mil. Kč, 20. 3. 2026, 240 m n. m., 2 × 3, 1 : 50");
    expect(nb(once)).toBe(once);
    expect(nb("a house in a plot", "en")).toBe("a house in a plot");
  });
});

describe("parseNum", () => {
  it("reads comma or point decimals and spaced thousands", () => {
    expect(parseNum("12,5")).toBe(12.5);
    expect(parseNum("12.5")).toBe(12.5);
    expect(parseNum(`26${NBSP}000`)).toBe(26000);
    expect(parseNum(" 1 000 000 ")).toBe(1e6);
    expect(parseNum("12,")).toBe(12);
    expect(parseNum(",5")).toBe(0.5);
  });
  it("reads a hyphen or a real minus", () => {
    expect(parseNum("-5")).toBe(-5);
    expect(parseNum(`${MINUS}5`)).toBe(-5);
  });
  it("returns null for empty or unreadable text instead of 0", () => {
    for (const t of ["", " ", "-", ",", ".", "1,2,3", "abc", "12 Kč", "1e5"]) expect(parseNum(t), t).toBeNull();
  });
  it("reads both separators: the last one is the decimal one", () => {
    expect(parseNum("1.234,5")).toBe(1234.5);
    expect(parseNum("1,234.5", "en")).toBe(1234.5);
  });
  it("treats a comma as thousands in English only when it looks like thousands", () => {
    expect(parseNum("1,234", "en")).toBe(1234);
    expect(parseNum("1,234,567", "en")).toBe(1234567);
    expect(parseNum("1,5", "en")).toBe(1.5);
    expect(parseNum("1,234", "cs")).toBe(1.234);
  });
});

describe("number formatting", () => {
  it("uses the separators of each language", () => {
    expect(cs.num(26000)).toBe(`26${NBSP}000`);
    expect(cs.num(1234567.891, 2)).toBe(`1${NBSP}234${NBSP}567,89`);
    expect(cs.num(12.5, 0, 2)).toBe("12,5");
    expect(en.num(1234567.891, 2)).toBe("1,234,567.89");
    expect(en.num(12.5, 0, 2)).toBe("12.5");
  });
  it("writes a real minus and drops the sign of a rounded zero", () => {
    expect(cs.num(-0.9, 2)).toBe(`${MINUS}0,90`);
    expect(en.num(-5)).toBe(`${MINUS}5`);
    expect(cs.num(-0.2)).toBe("0");
    expect(cs.num(-0.001, 2)).toBe("0,00");
  });
  it("shows a dash for missing values", () => {
    expect(cs.num(NaN)).toBe("–");
    expect(cs.num(Infinity)).toBe("–");
    expect(cs.clock(NaN)).toBe("–");
  });
  it("reuses one Intl instance per locale and digit setting", () => {
    expect(getFormatter("cs")).toBe(getFormatter("cs"));
    expect(getFormatter("cs")).not.toBe(getFormatter("en"));
    expect(getFormatter("cs")).toBeInstanceOf(Formatter);
  });
  it("formats and parses back what it writes", () => {
    for (const v of [0, 12.5, -3.25, 1234.5, 1e6 + 0.5]) {
      expect(parseNum(cs.num(v, 0, 2), "cs")).toBe(v);
      expect(parseNum(en.num(v, 0, 2), "en")).toBe(v);
    }
  });
});

describe("units, angles, clock, money, ranges", () => {
  it("area, volume, length keep the unit with the number", () => {
    expect(cs.area(123.456)).toBe(`123,5${NBSP}m²`);
    expect(en.area(123.456, 2)).toBe(`123.46${NBSP}m²`);
    expect(cs.volume(7)).toBe(`7,0${NBSP}m³`);
    expect(cs.length(3.4)).toBe(`3,40${NBSP}m`);
  });
  it("degrees have no space, percent follows the language", () => {
    expect(cs.degrees(192)).toBe("192°");
    expect(en.degrees(-12.34, 1)).toBe(`${MINUS}12.3°`);
    expect(cs.percent(12.5, 1)).toBe(`12,5${NBSP}%`);
    expect(en.percent(12.5, 1)).toBe("12.5%");
  });
  it("clock is 24-hour, from minutes or decimal hours", () => {
    expect(cs.clock(7 * 60 + 5)).toBe("7:05");
    expect(cs.clock(13 * 60 + 30)).toBe("13:30");
    expect(cs.clock(24 * 60)).toBe("24:00");
    expect(en.clockHours(6.5)).toBe("6:30");
    expect(cs.clock(59.6)).toBe("1:00");
  });
  it("duration", () => {
    expect(cs.duration(2.25)).toBe(`2${NBSP}h${NBSP}15${NBSP}min`);
    expect(cs.duration(0.75)).toBe(`45${NBSP}min`);
    expect(cs.duration(3)).toBe(`3${NBSP}h`);
  });
  it("money in crowns", () => {
    expect(cs.money(1234567)).toBe(`1${NBSP}234${NBSP}567${NBSP}Kč`);
    expect(en.money(1234567)).toBe(`CZK${NBSP}1,234,567`);
    expect(cs.money(-1500)).toBe(`${MINUS}1${NBSP}500${NBSP}Kč`);
    expect(cs.money(1234567.5, { digits: 2 })).toBe(`1${NBSP}234${NBSP}567,50${NBSP}Kč`);
  });
  it("compact money", () => {
    expect(cs.money(1_200_000, { compact: true })).toMatch(/^1,2.mil\..Kč$/);
    expect(en.money(1_200_000, { compact: true })).toMatch(/^CZK.1\.2M$/);
  });
  it("range uses an en dash and writes the unit once", () => {
    expect(cs.range(12, 15, { unit: "m²" })).toBe(`12–15${NBSP}m²`);
    expect(en.range(1.5, 2.5, { digits: 1 })).toBe("1.5–2.5");
    expect(cs.range(8 * 60, 18 * 60, { fmt: (v) => cs.clock(v) })).toBe("8:00–18:00");
  });
  it("list joins with the language's conjunction", () => {
    expect(cs.list(["a", "b", "c"])).toMatch(/^a, b a.c$/);
    expect(en.list(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("time with its preposition", () => {
  const cs = getFormatter("cs"), en = getFormatter("en");
  it("uses the vocalised 've' before 2, 3, 4, 12, 13, 14 and 20-24 o'clock", () => {
    expect(cs.at(4 * 60 + 48)).toBe(`ve${NBSP}4:48`);
    expect(cs.at(5 * 60 + 10)).toBe(`v${NBSP}5:10`);
    expect(cs.at(12 * 60 + 55)).toBe(`ve${NBSP}12:55`);
    expect(cs.at(19 * 60 + 40)).toBe(`v${NBSP}19:40`);
    expect(cs.atHours(21.05)).toBe(`ve${NBSP}21:03`);
    expect(at(0, "cs")).toBe(`v${NBSP}0:00`);
  });
  it("covers every hour of the day", () => {
    const ve = [2, 3, 4, 12, 13, 14, 20, 21, 22, 23];
    for (let h = 0; h < 24; h++) expect(cs.at(h * 60 + 30).split(NBSP)[0], String(h)).toBe(ve.includes(h) ? "ve" : "v");
    for (let h = 0; h < 24; h++) expect(csTimePreposition(h)).toBe(ve.includes(h) ? "ve" : "v");
  });
  it("takes the hour after rounding (1:59.6 is 2:00)", () => {
    expect(cs.at(119.6)).toBe(`ve${NBSP}2:00`);
  });
  it("is 'at' in English and a dash for a missing time", () => {
    expect(en.at(21 * 60 + 3)).toBe(`at${NBSP}21:03`);
    expect(atHours(6.5, "en")).toBe(`at${NBSP}6:30`);
    expect(cs.at(NaN)).toBe("–");
  });
});

describe("estimates and affixes", () => {
  it("rounds to significant digits", () => {
    expect(roundSig(1234567)).toBe(1230000);
    expect(roundSig(-1234567, 2)).toBe(-1200000);
    expect(roundSig(0.012345)).toBe(0.0123);
    expect(roundSig(999.6)).toBe(1000);
    expect(roundSig(0)).toBe(0);
    expect(roundSig(NaN)).toBeNaN();
  });
  it("formats an estimate without false precision", () => {
    expect(formatEstimate(1234567)).toBe(`1${NBSP}230${NBSP}000`);
    expect(formatEstimate(1234567, { locale: "en" })).toBe("1,230,000");
    expect(formatEstimate(12.345, { sig: 3 })).toBe("12,3");
    expect(formatEstimate(0.012345, { locale: "en" })).toBe("0.0123");
    expect(formatEstimate(12.0, { sig: 3 })).toBe("12");
  });
  it("splits a filled template into prefix and suffix", () => {
    expect(affixes(`${VALUE_SLOT}${NBSP}mil.${NBSP}Kč`)).toEqual({ prefix: "", suffix: `mil.${NBSP}Kč` });
    expect(affixes(`CZK ${VALUE_SLOT}M`)).toEqual({ prefix: "CZK", suffix: "M" });
    expect(() => affixes("no slot")).toThrow();
  });
});
