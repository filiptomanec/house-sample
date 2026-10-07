// PDF and source map metadata extraction.
import zlib from "node:zlib";

function printable(buf, min = 5) {
  return buf.toString("utf8").replace(/[^\p{L}\p{N}\p{P}\p{S} ]+/gu, "\n").split("\n").filter((s) => s.length >= min);
}

function decodePdfString(raw) {
  if (raw.startsWith("(")) {
    const body = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c) => {
      if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
      return { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[c] ?? c;
    });
    const bytes = Buffer.from(body, "latin1");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
    return bytes.toString("latin1");
  }
  const hex = raw.slice(1, -1).replace(/\s/g, "");
  const bytes = Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString("utf16le");
  return bytes.toString("latin1");
}

/** @returns {{ strings: any[], flags: any[], nested: any[] }} */
export function parsePdf(buf) {
  const meta = { strings: [], flags: [], nested: [] };
  const text = buf.toString("latin1");
  // Info dictionary entries and other literal metadata keys
  const re = /\/(Author|Creator|Producer|Title|Subject|Keywords|Company|Manager|SourceModified|Lang)\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = decodePdfString(m[2]);
    if (!value.trim()) continue;
    meta.strings.push({ field: `pdf:${m[1]}`, text: value, offset: m.index });
    if (m[1] === "Author" || m[1] === "Company" || m[1] === "Manager") meta.flags.push({ category: "meta/personal-field", field: `pdf:${m[1]}`, offset: m.index });
  }
  const xmp = text.indexOf("<?xpacket");
  if (xmp >= 0) {
    const end = text.indexOf("<?xpacket end", xmp);
    const xml = Buffer.from(text.slice(xmp, end > 0 ? end + 20 : xmp + 65536), "latin1").toString("utf8");
    meta.strings.push({ field: "pdf:xmp", text: xml, offset: xmp, doc: true });
  }
  // Flate streams that decode to text (XMP, fonts' names, text operators)
  const sre = /stream\r?\n/g;
  let count = 0;
  while ((m = sre.exec(text)) !== null && count < 400) {
    const dictStart = Math.max(0, m.index - 300);
    if (!/FlateDecode/.test(text.slice(dictStart, m.index))) continue;
    const end = text.indexOf("endstream", sre.lastIndex);
    if (end < 0) break;
    count++;
    try {
      const out = zlib.inflateSync(buf.subarray(sre.lastIndex, end), { maxOutputLength: 8 * 1024 * 1024 });
      const sample = out.subarray(0, 4096);
      const printableRatio = sample.filter((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)).length / Math.max(1, sample.length);
      if (printableRatio > 0.9) meta.strings.push({ field: "pdf:stream", text: out.toString("latin1"), offset: sre.lastIndex });
    } catch {
      // not a valid flate stream
    }
  }
  for (const s of printable(buf.subarray(0, Math.min(buf.length, 1 << 22)), 8)) {
    if (s.length < 4096) meta.strings.push({ field: "pdf:text", text: s });
  }
  return meta;
}

/** Source map: scan sources, names and embedded sources, never the `mappings` field. */
export function parseSourceMap(jsonText) {
  const meta = { strings: [], flags: [], nested: [] };
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.sources)) return null;
  if (typeof doc.file === "string") meta.strings.push({ field: "map:file", text: doc.file });
  if (typeof doc.sourceRoot === "string" && doc.sourceRoot) meta.strings.push({ field: "map:sourceRoot", text: doc.sourceRoot });
  meta.strings.push({ field: "map:sources", text: doc.sources.filter((s) => typeof s === "string").join("\n") });
  if (Array.isArray(doc.names)) meta.strings.push({ field: "map:names", text: doc.names.filter((s) => typeof s === "string").join("\n") });
  (doc.sourcesContent ?? []).forEach((c, i) => {
    if (typeof c === "string") meta.strings.push({ field: `map:sourcesContent[${i}]`, text: c, doc: true });
  });
  return meta;
}
