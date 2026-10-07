// Generic detectors: patterns that indicate private data regardless of the denylist (e-mail, phone, URL, absolute
// paths, parcel numbers, coordinates, identifiers, secrets). Each detector yields matches; the caller turns them into
// findings (category + position + hash), never printing the matched value.
import { ALLOWED_EMAIL_PATTERNS, HOME_DIR_NAMES } from "./config.mjs";

const FILE_EXT_TLDS = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "svg", "ico", "avif", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "map", "md",
  "html", "htm", "txt", "woff", "woff2", "ttf", "otf", "mp4", "webm", "glb", "gltf", "usdz", "stl", "pdf", "zip", "py", "sh", "yml",
  "yaml", "xml", "lock", "bin", "wasm", "exr", "hdr", "ktx2", "mov",
]);

const PLACEHOLDER_USERS = new Set([
  "runner", "shared", "user", "username", "name", "you", "yourname", "your-name", "example", "me", "guest", "default", "public",
  "localhost", "<name>", "<user>", "home", "x", "xxx", "foo", "bar", "web_user",
]);

/** @returns {boolean} true when the e-mail address is allowed everywhere */
export function emailAllowed(addr) {
  const a = addr.toLowerCase();
  if (a === "git@github.com") return true;
  return ALLOWED_EMAIL_PATTERNS.some((re) => re.test(a));
}

function shannon(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER_VALUE = /(?:process\.env|your[_-]?|example|changeme|placeholder|xxxx|\*{4}|<[^>]+>|\$\{|undefined|true|false|null|redacted|secret\b)/i;

// Czech national identification number: YYMMDD/SSSC, 10 digits divisible by 11 (or 9 digits for years before 1954).
function validBirthNumber(digits) {
  if (digits.length !== 10 && digits.length !== 9) return false;
  let yy = +digits.slice(0, 2);
  let mm = +digits.slice(2, 4);
  const dd = +digits.slice(4, 6);
  if (digits.length === 10) {
    if (+digits % 11 !== 0 && !(+digits.slice(0, 9) % 11 === 10 && digits[9] === "0")) return false;
    yy += yy < 54 ? 2000 : 1900;
  } else yy += 1900;
  if (mm > 70) mm -= 70;
  else if (mm > 50) mm -= 50;
  else if (mm > 20 && yy >= 2004) mm -= 20;
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

const CZ_BANK_CODES = new Set(["0100", "0300", "0600", "0710", "0800", "2010", "2060", "2070", "2100", "2200", "2220", "2250", "2260", "2275", "2600", "2700", "3030", "3050", "3060", "3500", "4000", "4300", "5500", "5800", "6000", "6100", "6200", "6210", "6300", "6700", "6800", "7910", "7940", "7950", "7960", "7970", "7980", "7990", "8030", "8040", "8060", "8090", "8150", "8200", "8215", "8220", "8230", "8240", "8250", "8255", "8265", "8270", "8280", "8290"]);

function inRange(v, lo, hi) {
  return v >= lo && v <= hi;
}

function parseNum(s) {
  return Math.abs(parseFloat(s.replace(",", ".")));
}

/**
 * Detector table. `check(m, ctx, text)` returns false to drop a match or a string (the value to hash) to keep it.
 * `ctx` carries: { allowlist, kind } where kind is "docs" for documentation files.
 */
export const DETECTORS = [
  {
    category: "generic/email",
    re: /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    check: (m) => {
      const tld = m[0].slice(m[0].lastIndexOf(".") + 1).toLowerCase();
      if (FILE_EXT_TLDS.has(tld)) return false; // image@2x.png, name@1.0.css
      return emailAllowed(m[0]) ? false : m[0].toLowerCase();
    },
  },
  {
    category: "generic/url",
    re: /\b(?:https?|ftp|wss?|sftp|ssh|git\+https?):\/\/[^\s"'`<>()[\]{}\\^|]+/gi,
    check: (m, ctx) => {
      const raw = m[0].replace(/[.,;:!?*_~]+$/, "");
      const hm = /^[a-z+]+:\/\/(?:[^/@\s]*@)?([^/:?#\s$]+)/i.exec(raw);
      if (!hm) return false; // dynamic host (template literal)
      let u = null;
      try {
        u = new URL(raw.replace(/^git\+/, ""));
      } catch {
        // unparsable (template placeholders in the port or path): judge by the host alone
      }
      if (u && (u.username || u.password)) return false; // reported by generic/url-credentials
      const host = (u ? u.hostname : hm[1]).toLowerCase();
      const pathname = u ? u.pathname : "";
      return ctx.allowlist.hostAllowed(host, pathname, ctx) ? false : host;
    },
  },
  {
    category: "generic/url-credentials",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:"'`<>]+:[^\s/@"'`<>]+@[^\s/"'`<>]+/gi,
    check: (m) => (/^[a-z]+:\/\/[^/]*\$\{|<[^>]+>@/i.test(m[0]) ? false : m[0].toLowerCase()),
  },
  {
    category: "generic/domain",
    re: /(?<![\w@./:-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:cz|sk|com|org|eu)(?![\w-])(?!\()/gi,
    check: (m, ctx, text) => {
      const host = m[0].toLowerCase();
      // minified bundles produce short property chains that look like hosts: skip very long lines
      const ls = text.lastIndexOf("\n", m.index) + 1;
      let le = text.indexOf("\n", m.index);
      if (le < 0) le = text.length;
      if (le - ls > 1500) return false;
      // a name followed by a dot and an identifier is a property chain in code, not a host
      if (text[m.index + m[0].length] === "." && /[a-z]/i.test(text[m.index + m[0].length + 1] ?? "")) return false;
      return ctx.allowlist.hostAllowed(host, "", ctx) ? false : host;
    },
  },
  {
    category: "generic/ip",
    re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.]*\d)/g,
    check: (m) => {
      const o = m[0].split(".").map(Number);
      if (o[0] === 127 || o[0] === 0 || o[0] === 10 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31)) return false;
      if (o[0] === 169 && o[1] === 254) return false;
      if (o[0] === 255 || o.every((x) => x === o[0])) return false;
      if (o[0] >= 224) return false; // multicast and reserved: version-like strings
      return m[0];
    },
  },
  {
    category: "generic/phone",
    // international format with separators, or a contiguous number with the Czech or Slovak country code
    re: /(?<![\w.,/+*-])(?:\+\d{1,3}(?:[ .\u00a0-]\d{2,4}){3,4}|(?:\+|00)42[01]\d{9})(?![\w.,/-]*\d)/g,
    check: (m) => {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) return false;
      if (/^(\d)\1+$/.test(digits)) return false;
      return digits;
    },
  },
  {
    // bare national format (777 123 456) only next to a phone word: three-digit groups are common in CSS and tables
    category: "generic/phone",
    re: /(?:tel(?:efon)?|phone|mob(?:il)?|gsm|fax|call|volejte|zavolejte)\b[^\n\d]{0,12}((?<!\d[ \u00a0])[1-9]\d{2}[ \u00a0.-]\d{3}[ \u00a0.-]\d{3})(?![\w.,/-]*\d)/gi,
    check: (m) => m[1].replace(/\D/g, ""),
  },
  {
    category: "generic/phone",
    re: /\btel:[+\d][\d\s().-]{6,}/gi,
    check: (m) => m[0].replace(/\D/g, ""),
  },
  {
    category: "generic/abs-path",
    re: /(?<![\w.-])\/(?:Users|home)\/([A-Za-z0-9._-]+)/g,
    reBinary: /\/(?:Users|home)\/([A-Za-z0-9._-]+)/g,
    check: (m) => (PLACEHOLDER_USERS.has(m[1].toLowerCase()) || !/[A-Za-z0-9]/.test(m[1]) ? false : m[0].toLowerCase()),
  },
  {
    category: "generic/abs-path",
    re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}([A-Za-z0-9._ -]+)/g,
    check: (m) => (PLACEHOLDER_USERS.has(m[1].trim().toLowerCase()) || !/[A-Za-z0-9]/.test(m[1]) ? false : m[0].toLowerCase()),
  },
  {
    category: "generic/abs-path",
    re: /(?<![\w.-])\/(?:private\/(?:tmp|var)|var\/folders|tmp\/claude[\w-]*)\/[\w.-]*/g,
    check: (m) => m[0].toLowerCase(),
  },
  {
    category: "generic/home-path",
    re: new RegExp(`(?:~|\\$HOME|%USERPROFILE%)[\\\\/](?:${HOME_DIR_NAMES.join("|")})\\b[\\\\/]?[\\w .-]*`, "g"),
    check: (m) => m[0].toLowerCase(),
  },
  {
    category: "generic/parcel",
    re: /\b(?:parc(?:\.|ela|elní|ely)?\s*(?:č(?:\.|íslo)?\s*)?\d{1,5}(?:\s?\/\s?\d{1,3})?|p\.\s?č\.\s?\d{1,5}(?:\s?\/\s?\d{1,3})?|st\.\s?parc\.?\s*(?:č\.\s*)?\d{1,5}|(?<![\p{L}\p{N}])č\.\s?parc\.?\s*\d{1,5})/giu,
    check: (m) => (/^parcel\s+\d+$/i.test(m[0]) ? false : m[0].toLowerCase()),
  },
  {
    category: "generic/cadastre",
    re: /(?:\bk\.\s?ú\.\s+\p{Lu}[\p{L}-]+|katastrální\s+území\s+\p{Lu}[\p{L}-]+|\bLV\s?(?:č\.\s?)?\d{2,6}\b|\blist\s+vlastnictví\s+(?:č\.\s?)?\d+)/gu,
    check: (m) => m[0].toLowerCase(),
  },
  {
    category: "generic/house-number",
    re: /(?<![\p{L}\p{N}])(?:č\.\s?p\.?\s?\d{1,5}|čp\.?\s?\d{1,5}|číslo\s+popisné\s+\d{1,5}|č\.\s?ev\.\s?\d{1,5}|c\.\s?p\.\s?\d{1,5})/giu,
    check: (m) => m[0].toLowerCase(),
  },
  {
    category: "generic/national-id",
    re: /(?<![\d/])\d{6}\s?\/\s?\d{3,4}(?![\d/])/g,
    check: (m) => {
      const digits = m[0].replace(/\D/g, "");
      return validBirthNumber(digits) ? digits : false;
    },
  },
  {
    category: "generic/iban",
    re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g,
    check: (m) => {
      const c = m[0].replace(/ /g, "");
      if (c.length < 15 || c.length > 34 || !/\d{8}/.test(c) || !/^(?:CZ|SK|DE|AT|PL|GB|FR|IT|ES|NL|BE|HU)/.test(c)) return false;
      return c;
    },
  },
  {
    category: "generic/bank-account",
    re: /(?<![\d/-])(?:\d{1,6}-)?\d{2,10}\s?\/\s?(\d{4})(?!\d)/g,
    check: (m) => (CZ_BANK_CODES.has(m[1]) && m[0].replace(/\D/g, "").length >= 8 ? m[0].replace(/\s/g, "") : false),
  },
  {
    category: "generic/grid-coordinates",
    // S-JTSK (X ~ 0.9-1.3 million, Y ~ 0.4-0.9 million) or UTM 33/34 N (northing ~5.3-5.7 million) pairs, either order
    re: /(?<![\d.])(-?\d{6,7}(?:[.,]\d+)?)[^\d\n]{1,24}?(-?\d{6,7}(?:[.,]\d+)?)(?![\d])/g,
    check: (m) => {
      const a = parseNum(m[1]);
      const b = parseNum(m[2]);
      const jtsk = (x, y) => inRange(x, 9e5, 1.3e6) && inRange(y, 4e5, 9.5e5);
      const utm = (n, e) => inRange(n, 5.3e6, 5.7e6) && inRange(e, 1e5, 9e5);
      return jtsk(a, b) || jtsk(b, a) || utm(a, b) || utm(b, a) ? `${Math.round(a)}:${Math.round(b)}` : false;
    },
  },
  {
    category: "generic/latlon",
    re: /\b(?:lat(?:itude)?|lon(?:g(?:itude)?)?|lng)\b["']?\s*[:=]\s*["']?(-?\d{1,3}\.\d{3,})/gi,
    check: (m) => m[1],
  },
  {
    category: "generic/latlon",
    re: /(?<![\d.])(-?\d{1,3}\.\d{3,})\s*[,;/]\s*(-?\d{1,3}\.\d{3,})(?![\d])/g,
    check: (m) => {
      const a = parseNum(m[1]);
      const b = parseNum(m[2]);
      const lat = (x) => inRange(x, 45, 56);
      const lon = (x) => inRange(x, 8, 26);
      return (lat(a) && lon(b)) || (lon(a) && lat(b)) ? `${a}:${b}` : false;
    },
  },
  {
    category: "generic/latlon",
    re: /\d{1,3}\s?°\s?\d{1,2}\s?['′’]\s?\d{1,2}(?:[.,]\d+)?\s?(?:["″”]|'')?\s?[NSEW]\b|\d{1,3}[.,]\d{3,}\s?°\s?[NSEWnsew]\b/g,
    check: (m) => m[0].replace(/\s/g, ""),
  },
  {
    category: "generic/uuid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    check: (m) => m[0].toLowerCase(),
  },
  {
    category: "generic/mac-address",
    re: /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi,
    check: (m) => (/^(?:00[:-]){5}00$|^(?:ff[:-]){5}ff$/i.test(m[0]) ? false : m[0].toLowerCase()),
  },
  {
    category: "generic/hostname",
    re: /(?<![\w./-])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\.local\b(?!\.\w)(?![\w-])/g,
    check: (m) => (/^(?:localhost|foo|example|host|machine|my)\.local$/i.test(m[0]) ? false : m[0].toLowerCase()),
  },
  // ---- secrets
  { category: "generic/token", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, check: (m) => m[0] },
  { category: "generic/token", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bnpm_[A-Za-z0-9]{36}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bsb(?:p|_secret)_[A-Za-z0-9_]{30,}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\bvercel_blob_rw_[A-Za-z0-9_]{20,}\b/g, check: (m) => m[0] },
  { category: "generic/token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, check: (m) => m[0] },
  {
    category: "generic/token",
    re: /\b(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|pwd|authorization|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=.~]{16,})/gi,
    check: (m) => {
      const v = m[1];
      if (PLACEHOLDER_VALUE.test(v) || /^[A-Za-z.]+$/.test(v) || !/\d/.test(v) || !/[A-Za-z]/.test(v)) return false;
      return shannon(v) >= 3.3 ? v : false;
    },
  },
  {
    category: "generic/entropy",
    re: /[A-Za-z0-9+/_-]{40,}={0,2}/g,
    check: (m, ctx, text) => {
      const s = m[0];
      if (/^[0-9a-f]+$/i.test(s) || /^[A-Za-z]+$/.test(s)) return false;
      if (!(/[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s))) return false;
      if ((s.match(/\//g) ?? []).length >= 3 || (s.match(/-/g) ?? []).length >= 3) return false;
      const before = text.slice(Math.max(0, m.index - 16), m.index);
      if (/(?:sha\d{3}-|base64,|integrity["']?\s*[:=]\s*["']?)$/i.test(before)) return false;
      return shannon(s) >= 4.6 ? s : false;
    },
  },
];

/**
 * Run all detectors on one text.
 * @param {string} text
 * @param {{ allowlist: any, kind?: string, skip?: Set<string>, binary?: boolean }} ctx
 * @returns {{ category: string, index: number, length: number, value: string }[]}
 */
export function runGeneric(text, ctx) {
  const out = [];
  for (const d of DETECTORS) {
    if (ctx.skip?.has(d.category)) continue;
    const re = ctx.binary && d.reBinary ? d.reBinary : d.re;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const v = d.check(m, ctx, text);
      if (v) out.push({ category: d.category, index: m.index, length: m[0].length, value: v });
    }
  }
  return out;
}
