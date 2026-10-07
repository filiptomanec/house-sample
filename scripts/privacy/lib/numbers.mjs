// Numeric fingerprints: numbers (with tolerance), sequences of numbers and clusters of rare numbers.
//
// Denylist shapes (per category):
//   numbers:   [{ value, tol, label, kind?, strength?: "strong"|"weak", keys?: string[] }]
//   sequences: [{ values: number[], tol, label, min?: number }]
//
// Detection rules. Random numbers collide easily in numeric JSON, so a single number is reported only when it is labelled:
//   labelled   a fingerprint found next to a unit or measure word that fits its `kind`
//              (kind "area": 123,4 m2 or "area": 123.4, "length": 12 m, "level": 240 m n. m., "angle": 26 deg, "geo": 49.1 deg, "any")
//              A fingerprint with `keys` needs one of those words in the same field instead of the kind's words.
//   sequence   `min` (default 4) consecutive numbers of a fingerprint sequence, e.g. polygon vertices copied from a drawing
//   cluster    three distinct rare fingerprints (5 or more significant digits) within 30 numeric tokens
// Weak fingerprints (few significant digits) have no use on their own: they are reported only through `keys`.

const UNITS_AFTER = new Set(["m", "mm", "cm", "km", "m2", "m3", "kw", "kwh", "kwp", "wp", "w", "a", "x", "h", "min", "s", "ms", "deg", "czk", "kc", "eur", "usd", "px", "pt", "kg", "g", "l", "pa", "hz", "ha", "sqm"]);

const SUP2 = String.fromCharCode(0xb2);
const SUP3 = String.fromCharCode(0xb3);
const DEG = String.fromCharCode(0xb0);

const AFTER = {
  area: new RegExp(`^\\s{0,2}(?:m2|m${SUP2}|m\\^2|m\\s?2\\b|sqm|sq\\.?\\s?m|ha\\b)`, "i"),
  volume: new RegExp(`^\\s{0,2}(?:m3|m${SUP3}|m\\^3)`, "i"),
  length: new RegExp(`^\\s{0,2}(?:mm\\b|cm\\b|km\\b|m\\b)(?!\\s?(?:2|${SUP2}|3|${SUP3}))`, "i"),
  level: /^\s{0,2}(?:m\s?n\.\s?m|m\s?a\.\s?s\.\s?l|m\b)/i,
  angle: new RegExp(`^\\s{0,2}(?:${DEG}|deg\\b|stup|%)`, "i"),
  geo: new RegExp(`^\\s{0,2}(?:${DEG}|deg\\b)`, "i"),
  any: new RegExp(`^\\s{0,2}(?:m2|m${SUP2}|m3|m${SUP3}|sqm|ha\\b|${DEG}|stup|%|mm\\b|cm\\b|km\\b|m\\b|kwh?\\b|kwp\\b)`, "i"),
};
const BEFORE = {
  area: /(?:area|plocha|plochy|plochu|výměr|vymer|rozlo|footprint|zastav|obestav|úžitn|uzitn)[^\n\d]{0,30}$/i,
  volume: /(?:volume|objem|obestav)[^\n\d]{0,30}$/i,
  length: /(?:length|width|depth|délk|delk|šířk|sirk|hloubk|dimension|rozměr|rozmer|span|perimeter|obvod|outer|vnější|vnejsi)[^\n\d]{0,30}$/i,
  level: /(?:level|elevation|altitude|zero|n\.\s?m|bpv|nadmo|úrov|uroven|ground|terén|teren)[^\n\d]{0,30}$/i,
  angle: /(?:pitch|slope|sklon|azimuth|azimut|bearing|rotation|orientation|orientace|convergence|konvergence|angle|úhel|uhel)[^\n\d]{0,30}$/i,
  geo: /(?:\blat\b|\blon\b|\blng\b|latitude|longitude|zeměpis|zemepis|souřadn|souradn|coord|location|poloha)[^\n\d]{0,30}$/i,
  any: /(?:area|plocha|výměr|vymer|footprint|zastav|built|volume|objem|length|width|délk|šířk|height|výšk|elevation|altitude|offset|origin|rotation|bearing|azimut|zero|center|centre|pozemek)[^\n\d]{0,30}$/i,
};

/** Number of significant digits of a decimal value. */
function sigDigits(v) {
  const s = Math.abs(v).toString().replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  return s.length;
}

export function isStrongValue(v) {
  const a = Math.abs(v);
  const sd = sigDigits(a);
  return sd >= 5 || (sd >= 4 && a >= 10);
}

/** A value that is not (nearly) a multiple of 0.05: round numbers (0.5, 10, 18.25, 0.501) say little. */
const informative = (x) => Math.abs(x * 20 - Math.round(x * 20)) > 0.15;

const isRare = (v) => sigDigits(v) >= 5 && Math.abs(v) >= 10;

/** Is the token at [start, end) labelled for the fingerprint's kind (or keys)? */
function labelled(text, start, end, fp) {
  const before = text.slice(Math.max(0, start - 64), start);
  const seg = before.split(/[,;{}[\]\n]/).pop() ?? "";
  if (fp.keys) {
    const lower = seg.toLowerCase();
    return fp.keys.some((k) => lower.includes(k));
  }
  const kind = AFTER[fp.kind] ? fp.kind : "any";
  const after = text.slice(end, end + 14);
  return AFTER[kind].test(after) || BEFORE[kind].test(seg);
}

function unitOrBoundaryAfter(text, end) {
  const m = /^[A-Za-z_]{1,6}/.exec(text.slice(end, end + 6));
  if (!m) return true;
  return UNITS_AFTER.has(m[0].toLowerCase());
}

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);
const THIN = String.fromCharCode(0x2009);
const MINUS = String.fromCharCode(0x2212);
const TOKEN_RE = new RegExp(`(?<![\\p{L}\\p{N}_])[-${MINUS}+]?\\d+(?:[.,]\\d+)*`, "gu");
const GROUPED_RE = new RegExp(`(?<![\\p{L}\\p{N}_])\\d{1,3}(?:[${NBSP}${NNBSP}${THIN} ]\\d{3})+(?:[.,]\\d+)?`, "gu");
const GROUP_SPACE_RE = new RegExp(`[${NBSP}${NNBSP}${THIN} ]`, "g");

/**
 * Extract numeric tokens.
 * @param {string} text
 * @param {"point"|"comma"} mode  point: comma separates numbers; comma: comma is the decimal mark (Czech prose)
 * @returns {{ vals: number[], starts: number[], ends: number[], thousands: { v: number, start: number, end: number }[] }}
 */
export function extractNumbers(text, mode) {
  const vals = [];
  const starts = [];
  const ends = [];
  const thousands = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const s = m[0].replace(MINUS, "-");
    const base = m.index;
    const body = s.replace(/^[-+]/, "");
    const signLen = s.length - body.length;
    if (mode === "comma" && body.includes(",")) {
      // a single decimal-comma number, or grouped thousands
      let v = NaN;
      if (/^\d+,\d+$/.test(body)) v = parseFloat(body.replace(",", "."));
      else if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(body)) v = parseFloat(body.replace(/\./g, "").replace(",", "."));
      else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(body)) v = parseFloat(body.replace(/,/g, ""));
      if (!Number.isNaN(v)) {
        vals.push(v);
        starts.push(base);
        ends.push(base + s.length);
      }
      continue;
    }
    // point mode: commas separate values
    let off = signLen;
    for (const part of body.split(",")) {
      if (/^\d+(?:\.\d+)?$/.test(part)) {
        vals.push(parseFloat(part));
        starts.push(base + off);
        ends.push(base + off + part.length);
      }
      off += part.length + 1;
    }
    if (body.includes(",") && /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(body)) {
      thousands.push({ v: parseFloat(body.replace(/,/g, "")), start: base + signLen, end: base + s.length });
    }
  }
  GROUPED_RE.lastIndex = 0;
  while ((m = GROUPED_RE.exec(text)) !== null) {
    const v = parseFloat(m[0].replace(GROUP_SPACE_RE, "").replace(",", "."));
    if (!Number.isNaN(v)) thousands.push({ v, start: m.index, end: m.index + m[0].length });
  }
  return { vals, starts, ends, thousands };
}

export class NumberIndex {
  /**
   * @param {Record<string, { numbers?: any[], sequences?: any[] }>} categories  denylist categories
   */
  constructor(categories) {
    /** @type {{ v: number, tol: number, cat: string, id: number, kind: string, rare: boolean, keys: string[] | null }[]} */
    this.singles = [];
    this.seqs = [];
    this.seqTol = 0;
    this.windows = new Map();
    let id = 0;
    for (const [cat, body] of Object.entries(categories)) {
      for (const n of body.numbers ?? []) {
        if (typeof n.value !== "number" || !Number.isFinite(n.value)) continue;
        const keys = Array.isArray(n.keys) && n.keys.length ? n.keys.map((k) => String(k).toLowerCase()) : null;
        const strong = n.strength ? n.strength === "strong" : isStrongValue(n.value);
        if (!strong && !keys) continue; // weak numbers have no use on their own
        this.singles.push({ v: Math.abs(n.value), tol: Math.max(n.tol ?? 0.005, 1e-9), cat, id: id++, kind: n.kind ?? "any", rare: isRare(n.value), keys });
      }
      for (const s of body.sequences ?? []) {
        const values = (s.values ?? []).map((x) => Math.abs(Number(x)));
        const min = Math.max(3, s.min ?? 4);
        if (values.length < min || values.some((x) => !Number.isFinite(x))) continue;
        const seq = { values, tol: Math.max(s.tol ?? 0.005, 1e-9), cat, id: this.seqs.length, min };
        this.seqs.push(seq);
        this.seqTol = Math.max(this.seqTol, seq.tol);
      }
    }
    // windows are indexed by the first two values (quantised), so a numeric token meets only a handful of candidates
    this.bucket = Math.max(0.01, this.seqTol * 2);
    for (const seq of this.seqs) {
      for (let i = 0; i + seq.min <= seq.values.length; i++) {
        const w = seq.values.slice(i, i + seq.min);
        if (new Set(w.map((x) => x.toFixed(3))).size < 3) continue;
        if (w.filter(informative).length < 2) continue;
        const key = this._key(Math.floor(w[0] / this.bucket), Math.floor(w[1] / this.bucket));
        let list = this.windows.get(key);
        if (!list) this.windows.set(key, (list = []));
        list.push({ seq, offset: i });
      }
    }
    this.singles.sort((a, b) => a.v - b.v);
    this.maxTol = this.singles.reduce((m, s) => Math.max(m, s.tol), 0);
    this.empty = this.singles.length === 0 && this.windows.size === 0;
  }

  _key(a, b) {
    return a * 1000003 + b;
  }

  /** Singles whose value is within tolerance of v. */
  _lookup(v) {
    const out = [];
    const lo = v - this.maxTol;
    let a = 0;
    let b = this.singles.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (this.singles[mid].v < lo) a = mid + 1;
      else b = mid;
    }
    for (let i = a; i < this.singles.length && this.singles[i].v <= v + this.maxTol; i++) {
      const s = this.singles[i];
      if (Math.abs(s.v - v) <= s.tol) out.push(s);
    }
    return out;
  }

  /**
   * @param {string} text
   * @returns {{ category: string, index: number, length: number, value: string, kind: string }[]}
   */
  scan(text) {
    if (this.empty) return [];
    const out = [];
    const seen = new Set();
    const modes = /\d,\d/.test(text) ? ["point", "comma"] : ["point"];
    for (const mode of modes) {
      const { vals, starts, ends, thousands } = extractNumbers(text, mode);
      this._scanSingles(text, vals, starts, ends, thousands, out, seen);
      this._scanSequences(vals, starts, ends, out, seen);
    }
    return out;
  }

  _scanSingles(text, vals, starts, ends, thousands, out, seen) {
    const hits = []; // rare hits for clustering
    const consider = (v, s, e, tok) => {
      for (const fp of this._lookup(Math.abs(v))) {
        if (!unitOrBoundaryAfter(text, e)) continue;
        const isLabelled = labelled(text, s, e, fp);
        const key = `${fp.id}:${s}`;
        if (seen.has(key)) continue;
        if (isLabelled) {
          seen.add(key);
          out.push({ category: `denylist/${fp.cat}`, index: s, length: e - s, value: `n${fp.id}`, kind: "labelled" });
        }
        if (fp.rare && !fp.keys && tok >= 0) hits.push({ tok, id: fp.id, cat: fp.cat, s, e, reported: isLabelled });
      }
    };
    for (let i = 0; i < vals.length; i++) consider(vals[i], starts[i], ends[i], i);
    for (const t of thousands) consider(t.v, t.start, t.end, -1);
    // clusters: three distinct rare fingerprints within 30 tokens, none of them already reported
    hits.sort((a, b) => a.tok - b.tok);
    let i = 0;
    while (i < hits.length) {
      const win = [hits[i]];
      let j = i + 1;
      while (j < hits.length && hits[j].tok - hits[i].tok <= 30) win.push(hits[j++]);
      const ids = new Set(win.map((h) => h.id));
      if (ids.size >= 3 && !win.some((h) => h.reported)) {
        const key = `cl:${win[0].s}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ category: `denylist/${win[0].cat}`, index: win[0].s, length: win[win.length - 1].e - win[0].s, value: `cluster:${[...ids].sort().join(",")}`, kind: "cluster" });
        }
        i = j;
      } else i++;
    }
  }

  _scanSequences(vals, starts, ends, out, seen) {
    if (!this.windows.size) return;
    const reportedAt = new Map(); // seq id -> last token index reported
    const q = (v) => Math.floor(Math.abs(v) / this.bucket);
    for (let i = 0; i + 1 < vals.length; i++) {
      const a = q(vals[i]);
      const b = q(vals[i + 1]);
      for (let da = -1; da <= 1; da++) {
        for (let db = -1; db <= 1; db++) {
          const list = this.windows.get(this._key(a + da, b + db));
          if (!list) continue;
          for (const { seq, offset } of list) {
            if (i + seq.min > vals.length) continue;
            let ok = true;
            for (let t = 0; t < seq.min; t++) {
              if (Math.abs(Math.abs(vals[i + t]) - seq.values[offset + t]) > seq.tol) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            const last = reportedAt.get(seq.id);
            if (last !== undefined && i - last < 40) {
              reportedAt.set(seq.id, i);
              continue;
            }
            reportedAt.set(seq.id, i);
            const sk = `sq:${seq.id}:${starts[i]}`;
            if (seen.has(sk)) continue;
            seen.add(sk);
            out.push({ category: `denylist/${seq.cat}`, index: starts[i], length: ends[i + seq.min - 1] - starts[i], value: `s${seq.id}`, kind: "sequence" });
          }
        }
      }
    }
  }
}
