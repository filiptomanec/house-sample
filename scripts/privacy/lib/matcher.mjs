// Literal matching: variants of each denylist literal are compiled into one Aho-Corasick automaton that runs over the
// normalised text. Boundary rules depend on the literal's mode.
import { normalizeLiteral } from "./normalize.mjs";

/** Separators used to build variants of multi-word literals (slugs, paths, URL-encoded forms, camel case via ""). */
const SEPS = ["", " ", "-", "_", ".", "/", "\\", "%20", "+", "--", "__", ":", ",", "·", "%2f", "%2d", "%5f"];

const ALNUM = /[\p{L}\p{N}]/u;
const isAlnum = (ch) => ch !== undefined && ch !== "" && ALNUM.test(ch);

/**
 * Accepted literal forms:
 *   "text"                        auto mode (substring when the squashed text has >= 6 characters, whole word otherwise)
 *   { v, mode }                   mode: "sub" | "word" | "prefix" | "exact" | "word-cs"
 *     sub      substring anywhere (stems, e.g. inflected place names)
 *     word     whole word
 *     prefix   left boundary only
 *     exact    only the normalised literal itself (no separator variants), substring
 *     word-cs  case- and diacritics-sensitive whole word on the raw text
 * @param {string | { v: string, mode?: string }} spec
 */
export function parseLiteralSpec(spec) {
  if (typeof spec === "string") return { v: spec, mode: "auto" };
  if (spec && typeof spec.v === "string") return { v: spec.v, mode: spec.mode || "auto" };
  throw new Error("invalid literal entry");
}

/** @returns {{ patterns: string[], mode: string, canon: string, cs: RegExp | null }} */
export function compileLiteral(spec) {
  const { v, mode: requested } = parseLiteralSpec(spec);
  if (requested === "word-cs") {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { patterns: [], mode: "word-cs", canon: v, cs: new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "gu") };
  }
  const n = normalizeLiteral(v);
  const tokens = n.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length) return { patterns: [], mode: "sub", canon: "", cs: null };
  const squashed = tokens.join("").length;
  let mode = requested;
  if (mode === "auto") mode = squashed >= 6 ? "sub" : "word";
  const set = new Set([n]);
  if (mode !== "exact") {
    if (tokens.length === 1) set.add(tokens[0]);
    else if (tokens.every((t) => /^\d+$/.test(t))) {
      // numeric identifiers (parcel numbers): glued digits would match any longer number, so only real separators
      for (const sep of ["/", "-", " / ", " - "]) set.add(tokens.join(sep));
    } else for (const sep of SEPS) set.add(tokens.join(sep));
  }
  return { patterns: [...set].filter((p) => p.length > 0), mode, canon: tokens.join(" "), cs: null };
}

class AhoCorasick {
  constructor() {
    /** @type {Map<number, number>[]} */
    this.next = [new Map()];
    this.fail = [0];
    /** @type {({ payload: number, len: number }[] | null)[]} */
    this.out = [null];
  }

  add(pattern, payload) {
    let n = 0;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern.charCodeAt(i);
      let m = this.next[n].get(c);
      if (m === undefined) {
        m = this.next.length;
        this.next.push(new Map());
        this.fail.push(0);
        this.out.push(null);
        this.next[n].set(c, m);
      }
      n = m;
    }
    (this.out[n] ??= []).push({ payload, len: pattern.length });
  }

  build() {
    const queue = [];
    for (const v of this.next[0].values()) queue.push(v);
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const [c, v] of this.next[u]) {
        let f = this.fail[u];
        while (f && !this.next[f].has(c)) f = this.fail[f];
        const t = this.next[f].get(c);
        this.fail[v] = t !== undefined && t !== v ? t : 0;
        const inherited = this.out[this.fail[v]];
        if (inherited) this.out[v] = (this.out[v] ?? []).concat(inherited);
        queue.push(v);
      }
    }
  }

  /** Calls cb(endExclusive, payload, len) for every match. */
  search(text, cb) {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      while (n && !this.next[n].has(c)) n = this.fail[n];
      n = this.next[n].get(c) ?? 0;
      const out = this.out[n];
      if (out) for (const o of out) cb(i + 1, o.payload, o.len);
    }
  }
}

export class LiteralMatcher {
  /** @param {{ category: string, spec: any }[]} entries */
  constructor(entries) {
    this.entries = [];
    this.ac = new AhoCorasick();
    this.csEntries = [];
    for (const e of entries) {
      let c;
      try {
        c = compileLiteral(e.spec);
      } catch {
        continue;
      }
      const idx = this.entries.length;
      this.entries.push({ category: e.category, mode: c.mode, canon: c.canon });
      if (c.cs) this.csEntries.push({ idx, re: c.cs });
      for (const p of c.patterns) this.ac.add(p, idx);
    }
    this.ac.build();
  }

  get size() {
    return this.entries.length;
  }

  /**
   * Matches on a normalised text. Returns non-overlapping matches (longest first at equal start).
   * @param {string} norm
   * @returns {{ start: number, end: number, entry: number }[]}
   */
  scanNormalized(norm) {
    const found = [];
    this.ac.search(norm, (end, entry, len) => {
      const start = end - len;
      const mode = this.entries[entry].mode;
      if (mode === "word") {
        if (isAlnum(norm[start - 1]) || isAlnum(norm[end])) return;
      } else if (mode === "prefix") {
        if (isAlnum(norm[start - 1])) return;
      }
      found.push({ start, end, entry });
    });
    return dedupeOverlaps(found);
  }

  /** Case-sensitive whole-word matches on raw text. */
  scanRaw(raw) {
    const found = [];
    for (const { idx, re } of this.csEntries) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(raw)) !== null) {
        found.push({ start: m.index, end: m.index + m[0].length, entry: idx });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    return found;
  }
}

/** Keep the longest of overlapping matches. */
function dedupeOverlaps(matches) {
  if (matches.length < 2) return matches;
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start < lastEnd) {
      // overlapping: keep the longer one
      const prev = kept[kept.length - 1];
      if (m.end - m.start > prev.end - prev.start) {
        kept[kept.length - 1] = m;
        lastEnd = m.end;
      }
      continue;
    }
    kept.push(m);
    lastEnd = m.end;
  }
  return kept;
}
