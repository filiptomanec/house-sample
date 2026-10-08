// Number, unit, time and money formatting plus Czech typography. One Formatter (and so one set of Intl instances)
// per locale; the standalone functions below delegate to it and take the locale as the last argument.
//
// Rule of the site: every number that reaches the screen goes through here (never toFixed / toLocaleString in components),
// every user-visible string goes through t(), which runs nb() on Czech text.

import { LOCALE_META, type Locale } from "./config";

export const NBSP = "\u{a0}";
export const MINUS = "\u{2212}";
export const EN_DASH = "\u{2013}";

// ------------------------------------------------------------------------------------------- typography

/** Units that stay glued to the number before them. Longest first, so "kWh" is not read as "kW" + "h". */
const UNITS = ["kWh", "kWp", "MWh", "Wh", "Wp", "kW", "MW", "W", "m²", "m³", "mm", "cm", "km", "ha", "m", "kg", "g", "l", "h", "min", "s", "Pa", "Hz", "lx", "lm", "°C", "°", "%", "‰", "Kč", "CZK", "EUR", "€", "ks"];
const UNIT_AFTER_NUMBER = new RegExp(`(\\d) (?=(?:${UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}]))`, "gu");
/** Digit groups written with ordinary spaces: 1 234 567. */
const THOUSANDS = /(?<![\p{N}.,])(\d{1,3})((?: \d{3})+)(?![\p{N}])/gu;
/** A single-letter Czech word (preposition or conjunction) at the end of a line looks wrong. */
const CS_ONE_LETTER = /(?<![\p{L}\p{N}_])([AIKOSUVZaikosuvz]) (?=\S)/gu;
/** Day and month of a Czech date: "15. března". */
const CS_DATE = /(\d{1,2}\.) (?=(?:ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince)(?![\p{L}]))/gu;
/** Numbered items: "č. 5", "str. 12". */
const CS_ABBR_NUMBER = /(?<![\p{L}])(č\.|str\.|obr\.|tab\.) (?=\d)/gu;
/** "240 m n. m.": the abbreviation of "above sea level" stays in one piece (the number is glued to "m" by the unit rule). */
const CS_ASL = /(?<![\p{L}])m n\. m\.(?![\p{L}])/gu;
const EN_ASL = /(?<![\p{L}])m a\.s\.l\.(?![\p{L}])/gu;
/** "7,5 mil. Kč", "120 tis. Kč": the number, the abbreviation and the currency stay together. */
const NUMBER_ABBR = /(\d) (?=(?:mil|mld|tis)\.(?![\p{L}]))/gu;
const ABBR_CURRENCY = /(?<![\p{L}])((?:mil|mld|tis)\.) (?=(?:Kč|CZK|EUR|€)(?![\p{L}]))/gu;
/** Numeric Czech dates: "20. 3." and "20. 3. 2026". */
const CS_NUMERIC_DATE = /(?<![\d.])(\d{1,2}\.) (?=\d{1,2}\.)/gu;
const CS_NUMERIC_DATE_YEAR = /(?<![\d.])(\d{1,2}\.\u{a0}\d{1,2}\.) (?=\d{4}(?!\d))/gu;
/** Dimensions and scales: "23,5 × 12,3", "1 : 100". */
const BETWEEN_NUMBERS = /(?<=\d) ([×:]) (?=\d)/gu;

/**
 * Replaces ordinary spaces with non-breaking ones where a line break would hurt: before units, inside digit groups,
 * around "×" and ":" between numbers, inside "mil. Kč" and the sea-level abbreviation and (Czech only) after single-letter
 * prepositions and conjunctions and inside dates. Idempotent. Plain text, or text with
 * the simple tags of rich.tsx ("<q>…</q>"), which it never splits.
 */
export function nb(text: string, locale: Locale = "cs"): string {
  let s = text
    .replace(UNIT_AFTER_NUMBER, `$1${NBSP}`)
    .replace(THOUSANDS, (_m, head: string, tail: string) => head + tail.replaceAll(" ", NBSP))
    .replace(NUMBER_ABBR, `$1${NBSP}`)
    .replace(ABBR_CURRENCY, `$1${NBSP}`)
    .replace(BETWEEN_NUMBERS, `${NBSP}$1${NBSP}`)
    .replace(EN_ASL, `m${NBSP}a.s.l.`);
  if (locale === "cs") {
    s = s
      .replace(CS_ONE_LETTER, `$1${NBSP}`)
      .replace(CS_DATE, `$1${NBSP}`)
      .replace(CS_ABBR_NUMBER, `$1${NBSP}`)
      .replace(CS_NUMERIC_DATE, `$1${NBSP}`)
      .replace(CS_NUMERIC_DATE_YEAR, `$1${NBSP}`)
      .replace(CS_ASL, `m${NBSP}n.${NBSP}m.`);
  }
  return s;
}

// ------------------------------------------------------------------------------------------- prepositions, affixes, estimates

/**
 * Hours before which Czech uses the vocalised preposition "ve": the spoken number starts with a consonant cluster
 * (dvě, tři, čtyři, dvanáct, třináct, čtrnáct, dvacet…). "v 5:10", but "ve 4:48" and "ve 21:03".
 */
const CS_VE_HOURS: ReadonlySet<number> = new Set([2, 3, 4, 12, 13, 14, 20, 21, 22, 23, 24]);

/** "ve" or "v" before a time of day with the given hour (Czech). Prefer Formatter.at(), which also formats the time. */
export const csTimePreposition = (hour: number): "ve" | "v" => (CS_VE_HOURS.has(hour) ? "ve" : "v");

/**
 * Marker for a value slot: fill a template with it and split the result with affixes(). One dictionary template then
 * drives both running text ("7,5 mil. Kč" / "CZK 7.5M") and a stat whose prefix and suffix are styled apart from the number.
 */
export const VALUE_SLOT = "\u{e000}";

/**
 * Prefix and suffix around VALUE_SLOT in a filled template, without the joining spaces:
 * affixes(t("budget.money.million", { value: VALUE_SLOT })) gives { prefix: "", suffix: "mil. Kč" } in Czech and
 * { prefix: "CZK", suffix: "M" } in English. Throws when the slot is missing (a template without the placeholder).
 */
export function affixes(filled: string): { prefix: string; suffix: string } {
  const i = filled.indexOf(VALUE_SLOT);
  if (i < 0) throw new Error(`affixes(): no value slot in "${filled}"`);
  const trim = (s: string) => s.replace(/^[\s\u{a0}\u{202f}]+|[\s\u{a0}\u{202f}]+$/gu, "");
  return { prefix: trim(filled.slice(0, i)), suffix: trim(filled.slice(i + VALUE_SLOT.length)) };
}

/** A value rounded to `sig` significant digits (3 by default): 1 234 567 → 1 230 000, 0,012345 → 0,0123. For estimates. */
export function roundSig(v: number, sig = 3): number {
  if (!Number.isFinite(v) || v === 0) return v;
  return Number(v.toPrecision(Math.min(21, Math.max(1, Math.round(sig)))));
}

/** Fraction digits that show a value rounded to `sig` significant digits without false precision. */
const sigFractionDigits = (v: number, sig: number): number =>
  v === 0 || !Number.isFinite(v) ? 0 : Math.max(0, Math.round(sig) - 1 - Math.floor(Math.log10(Math.abs(v))));

// ------------------------------------------------------------------------------------------- parsing

/**
 * Reads a number typed by the user: decimal comma or point, spaces (also non-breaking) as thousands separators,
 * a hyphen, en dash or real minus sign. Returns null for empty or unreadable text, so callers can tell it apart from 0.
 * With both separators the last one is the decimal one. A lone comma is the decimal separator, except in English
 * where "1,234" and "1,234,567" are thousands.
 */
export function parseNum(text: string, locale: Locale = "cs"): number | null {
  let s = text.replace(/[\s\u{a0}\u{202f}]/gu, "").replace(/[\u{2212}\u{2013}]/gu, "-");
  if (!s) return null;
  const commas = s.split(",").length - 1, dots = s.split(".").length - 1;
  if (commas && dots) {
    const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const group = dec === "," ? "." : ",";
    if (s.split(dec).length > 2) return null;
    s = s.split(group).join("").replace(dec, ".");
  } else if (commas) {
    if (locale === "en" && /^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replaceAll(",", "");
    else if (commas === 1) s = s.replace(",", ".");
    else return null;
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// ------------------------------------------------------------------------------------------- formatter

export type MoneyOptions = { digits?: number; compact?: boolean };

const pad2 = (n: number) => String(n).padStart(2, "0");

export class Formatter {
  readonly locale: Locale;
  private readonly tag: string;
  private readonly numbers = new Map<string, Intl.NumberFormat>();
  private readonly currencies = new Map<string, Intl.NumberFormat>();
  private lists?: Intl.ListFormat;

  constructor(locale: Locale) {
    this.locale = locale;
    this.tag = LOCALE_META[locale].intl;
  }

  private nf(min: number, max: number) {
    const k = `${min}:${max}`;
    let f = this.numbers.get(k);
    if (!f) this.numbers.set(k, (f = new Intl.NumberFormat(this.tag, { minimumFractionDigits: min, maximumFractionDigits: max })));
    return f;
  }

  /** Real minus sign, no sign on a negative that rounds to zero. */
  private fixSign(s: string): string {
    if (!s.startsWith("-") && !s.startsWith(MINUS)) return s;
    return /[1-9]/.test(s) ? MINUS + s.slice(1) : s.slice(1);
  }

  /** Locale number: grouping with non-breaking spaces (cs) or commas (en), decimal comma or point. "–" for NaN and infinities. */
  num(v: number, minDigits = 0, maxDigits = minDigits): string {
    if (!Number.isFinite(v)) return EN_DASH;
    return this.fixSign(this.nf(minDigits, Math.max(minDigits, maxDigits)).format(v));
  }

  /** Whole number. */
  int(v: number): string { return this.num(v, 0, 0); }

  /** Number followed by a unit in one non-breaking piece ("12,5 kWh"); degrees and percent have their own helpers. */
  unit(v: number, symbol: string, minDigits = 0, maxDigits = minDigits): string {
    return `${this.num(v, minDigits, maxDigits)}${NBSP}${symbol}`;
  }

  /** 12,3 m² */
  area(v: number, digits = 1): string { return this.unit(v, "m²", digits); }
  /** 12,3 m³ */
  volume(v: number, digits = 1): string { return this.unit(v, "m³", digits); }
  /** 3,45 m */
  length(v: number, digits = 2): string { return this.unit(v, "m", digits); }

  /** Angle in degrees without a space: 12°. */
  degrees(v: number, digits = 0): string { return `${this.num(v, digits)}°`; }

  /** Percent value (12.5 means 12,5 %); a space before the sign in Czech, none in English. */
  percent(v: number, digits = 0): string { return `${this.num(v, digits)}${this.locale === "cs" ? NBSP : ""}%`; }

  /** Time of day from minutes since midnight: 7:05, 13:30. 24-hour clock in both languages. */
  clock(minutes: number): string {
    if (!Number.isFinite(minutes)) return EN_DASH;
    const total = Math.round(minutes);
    return `${Math.floor(total / 60)}:${pad2(((total % 60) + 60) % 60)}`;
  }

  /** Time of day from decimal hours (6.5 → 6:30). */
  clockHours(hours: number): string { return this.clock(hours * 60); }

  /**
   * Time of day with its preposition, from minutes since midnight: "ve 4:48", "v 5:10", "ve 21:03" in Czech (the
   * vocalised "ve" before 2, 3, 4, 12, 13, 14 and 20–24 o'clock), "at 4:48" in English. Dictionaries write "{atSunset}",
   * never "v {sunset}" (src/lib/i18n/copy.test.ts forbids a one-letter preposition before a placeholder).
   */
  at(minutes: number): string {
    if (!Number.isFinite(minutes)) return EN_DASH;
    const hour = Math.floor(Math.round(minutes) / 60);
    const prep = this.locale === "cs" ? csTimePreposition(hour) : "at";
    return `${prep}${NBSP}${this.clock(minutes)}`;
  }

  /** at() from decimal hours (4.8 → "ve 4:48"). */
  atHours(hours: number): string { return this.at(hours * 60); }

  /** An estimate: the number rounded to `sig` significant digits (3 by default) and shown without false precision. */
  estimate(v: number, sig = 3): string {
    const r = roundSig(v, sig);
    return this.num(r, 0, sigFractionDigits(r, sig));
  }

  /** Duration from decimal hours: "2 h 15 min" / "45 min". */
  duration(hours: number): string {
    if (!Number.isFinite(hours)) return EN_DASH;
    const total = Math.round(hours * 60), h = Math.floor(total / 60), m = total % 60;
    if (!h) return `${m}${NBSP}min`;
    return m ? `${h}${NBSP}h${NBSP}${m}${NBSP}min` : `${h}${NBSP}h`;
  }

  /** Czech crowns: "1 234 Kč" / "CZK 1,234"; `compact` gives "1,2 mil. Kč" / "CZK 1.2M". */
  money(v: number, opts: MoneyOptions = {}): string {
    if (!Number.isFinite(v)) return EN_DASH;
    const { digits = 0, compact = false } = opts;
    if (compact) {
      // Intl compact notation differs between engines ("M" vs "m"), which breaks hydration: spell it out ourselves.
      const abs = Math.abs(v);
      const [div, cs, en] = abs >= 1e6 ? [1e6, "mil.", "M"] : abs >= 1e3 ? [1e3, "tis.", "k"] : [1, "", ""];
      const n = this.num(v / div, div === 1 ? digits : Math.max(digits, 1));
      return this.locale === "cs" ? `${n}${NBSP}${cs ? cs + NBSP : ""}Kč` : `CZK${NBSP}${n}${en}`;
    }
    const k = `${digits}:${compact}`;
    let f = this.currencies.get(k);
    if (!f) {
      this.currencies.set(k, (f = new Intl.NumberFormat(this.tag, {
        style: "currency", currency: "CZK", currencyDisplay: this.locale === "cs" ? "symbol" : "code",
        minimumFractionDigits: compact ? 0 : digits, maximumFractionDigits: compact ? Math.max(digits, 1) : digits,
        ...(compact ? { notation: "compact" as const, compactDisplay: "short" as const } : {}),
      })));
    }
    return nb(this.fixSign(f.format(v)).replace(/\s/g, NBSP), this.locale);
  }

  /** Range with an en dash and the unit written once: "12–15 m²". Give `fmt` for custom values (money, clock). */
  range(a: number, b: number, o: { digits?: number; unit?: string; fmt?: (v: number) => string } = {}): string {
    const fmt = o.fmt ?? ((v: number) => this.num(v, o.digits ?? 0));
    return `${fmt(a)}${EN_DASH}${fmt(b)}${o.unit ? NBSP + o.unit : ""}`;
  }

  /** "a, b a c" / "a, b and c". */
  list(items: readonly string[]): string {
    this.lists ??= new Intl.ListFormat(this.tag, { style: "long", type: "conjunction" });
    return nb(this.lists.format(items), this.locale);
  }
}

const formatters = new Map<Locale, Formatter>();

/** The cached Formatter of a locale. */
export function getFormatter(locale: Locale): Formatter {
  let f = formatters.get(locale);
  if (!f) formatters.set(locale, (f = new Formatter(locale)));
  return f;
}

// ------------------------------------------------------------------------------------------- standalone functions

export const formatNum = (v: number, minDigits = 0, maxDigits = minDigits, locale: Locale = "cs") => getFormatter(locale).num(v, minDigits, maxDigits);
export const clock = (minutes: number, locale: Locale = "cs") => getFormatter(locale).clock(minutes);
export const degrees = (v: number, digits = 0, locale: Locale = "cs") => getFormatter(locale).degrees(v, digits);
export const area = (v: number, digits = 1, locale: Locale = "cs") => getFormatter(locale).area(v, digits);
export const money = (v: number, locale: Locale = "cs", opts?: MoneyOptions) => getFormatter(locale).money(v, opts);
export const range = (a: number, b: number, locale: Locale = "cs", o?: Parameters<Formatter["range"]>[2]) => getFormatter(locale).range(a, b, o);
/** Time of day with its preposition: "ve 21:03" / "at 21:03" (see Formatter.at). */
export const at = (minutes: number, locale: Locale = "cs") => getFormatter(locale).at(minutes);
/** at() from decimal hours. */
export const atHours = (hours: number, locale: Locale = "cs") => getFormatter(locale).atHours(hours);
/** An estimate rounded to `sig` significant digits (3 by default): formatEstimate(1234567) → "1 230 000". */
export const formatEstimate = (value: number, opts: { sig?: number; locale?: Locale } = {}) => getFormatter(opts.locale ?? "cs").estimate(value, opts.sig ?? 3);
