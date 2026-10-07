// Text normalisation and decoded "views" of a text.
//
// normalizeText():  NFKD, strip combining marks, lower case, whitespace and dashes folded, invisible characters dropped.
//                   Returns the normalised string and (only when lengths differ) a map from normalised index to original index.
// decodeViews():    the raw text plus, when needed, a view with HTML entities, URL escapes and \uXXXX escapes decoded.

const EXTRA_FOLD = new Map([
  ["ł", "l"], ["đ", "d"], ["ø", "o"], ["æ", "ae"], ["œ", "oe"], ["ß", "ss"], ["þ", "th"], ["ð", "d"], ["ı", "i"], ["ħ", "h"],
]);
const DROP_RE = /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff\u180e]/;
const DASH_RE = /[‐-―−﹘﹣－]/;
const WS_RE = /\s/;
const MARK_RE = /\p{M}/gu;
const ASCII_RE = /^[\x00-\x7f]*$/;

const foldCache = new Map();

/** Fold one code point (as a string) to its normalised form (possibly empty or several characters). */
function foldChar(ch) {
  let r = foldCache.get(ch);
  if (r !== undefined) return r;
  if (DROP_RE.test(ch)) r = "";
  else if (WS_RE.test(ch)) r = " ";
  else if (DASH_RE.test(ch)) r = "-";
  else {
    let s = ch.normalize("NFKD").replace(MARK_RE, "").toLowerCase().normalize("NFKD").replace(MARK_RE, "");
    r = "";
    for (const c of s) r += EXTRA_FOLD.get(c) ?? (DROP_RE.test(c) ? "" : WS_RE.test(c) ? " " : c);
  }
  if (foldCache.size < 20000) foldCache.set(ch, r);
  return r;
}

/**
 * Normalise a text. `map` is null when the normalised text has the same length and index mapping as the input.
 * @param {string} s
 * @returns {{ text: string, map: Uint32Array | null }}
 */
export function normalizeText(s) {
  if (ASCII_RE.test(s)) {
    // identity mapping: lower-case and fold control whitespace 1:1
    return { text: s.toLowerCase().replace(/[\t\n\r\f\v]/g, " "), map: null };
  }
  const parts = [];
  let map = new Uint32Array(s.length + 16);
  let n = 0;
  let identity = true;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const len = ch.length;
    const f = foldChar(ch);
    if (f.length !== len) identity = false;
    if (n + f.length >= map.length) {
      const bigger = new Uint32Array(map.length * 2 + f.length);
      bigger.set(map);
      map = bigger;
    }
    for (let k = 0; k < f.length; k++) map[n++] = i;
    parts.push(f);
    i += len;
  }
  const text = parts.join("");
  if (identity && text.length === s.length) return { text, map: null };
  return { text, map: map.subarray(0, n) };
}

/** Normalise a short literal (no map needed). */
export function normalizeLiteral(s) {
  return normalizeText(s).text.trim();
}

/** Map an index of a normalised text back to an index in the original text. */
export function originalIndex(map, i) {
  if (!map) return i;
  if (i >= map.length) return map.length ? map[map.length - 1] + 1 : 0;
  return map[i];
}

// ------------------------------------------------------------------ decoders

const NAMED_ENTITIES = (() => {
  const m = new Map(Object.entries({
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", shy: "\u00ad", ndash: "–", mdash: "—",
    hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·",
    // Latin Extended-A characters used in Czech and neighbouring languages
    Aogon: "Ą", aogon: "ą", Cacute: "Ć", cacute: "ć", Ccaron: "Č", ccaron: "č", Dcaron: "Ď", dcaron: "ď", Eogon: "Ę",
    eogon: "ę", Ecaron: "Ě", ecaron: "ě", Lstrok: "Ł", lstrok: "ł", Nacute: "Ń", nacute: "ń", Ncaron: "Ň", ncaron: "ň",
    Rcaron: "Ř", rcaron: "ř", Sacute: "Ś", sacute: "ś", Scaron: "Š", scaron: "š", Tcaron: "Ť", tcaron: "ť", Uring: "Ů",
    uring: "ů", Zacute: "Ź", zacute: "ź", Zcaron: "Ž", zcaron: "ž", Zdot: "Ż", zdot: "ż",
  }));
  // Latin-1 block (160..255) by entity name
  const latin1 = ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro " +
    "para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute " +
    "Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute " +
    "THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde " +
    "ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml").split(" ");
  latin1.forEach((name, i) => m.set(name, String.fromCharCode(160 + i)));
  return m;
})();

const HTML_TRIGGER = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/i;
const URL_TRIGGER = /%[0-9a-f]{2}/i;
const UNI_TRIGGER = /\\{1,3}u[0-9a-f]{4}|\\u\{[0-9a-f]{1,6}\}|\\x[0-9a-f]{2}|\\[0-7]{3}/i;

export function htmlDecode(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,9});/gi, (m, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES.get(body) ?? m;
  });
}

export function urlDecode(s) {
  return s.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // invalid UTF-8: decode byte by byte as UTF-8 with replacement
      const bytes = Buffer.from(run.replace(/%/g, ""), "hex");
      return bytes.toString("utf8");
    }
  });
}

export function unescapeDecode(s) {
  return s
    .replace(/\\{1,3}u([0-9a-f]{4})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (m, h) => {
      const cp = parseInt(h, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/\\x([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([0-7]{3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)));
}

/**
 * Decoded views of a text. The first view is always the raw text. A second view (all decoders applied, up to two rounds)
 * is added only when at least one escape trigger is present and the decoding changes the text.
 * @param {string} raw
 * @returns {{ name: string, text: string }[]}
 */
export function decodeViews(raw) {
  const views = [{ name: "raw", text: raw }];
  if (!(HTML_TRIGGER.test(raw) || URL_TRIGGER.test(raw) || UNI_TRIGGER.test(raw))) return views;
  let t = raw;
  for (let round = 0; round < 2; round++) {
    const before = t;
    if (HTML_TRIGGER.test(t)) t = htmlDecode(t);
    if (URL_TRIGGER.test(t)) t = urlDecode(t);
    if (UNI_TRIGGER.test(t)) t = unescapeDecode(t);
    if (t === before) break;
  }
  if (t !== raw) views.push({ name: "decoded", text: t });
  return views;
}

// ------------------------------------------------------------------ positions

/** Offsets at which each line starts. */
export function lineStarts(text) {
  const starts = [0];
  let i = -1;
  while ((i = text.indexOf("\n", i + 1)) !== -1) starts.push(i + 1);
  return starts;
}

/** 1-based line and column of an offset, given lineStarts(). */
export function lineCol(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}
