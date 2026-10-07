// Content dispatch: decides how a buffer is scanned (text, image, video, model, archive, PDF, source map, raw binary).
import path from "node:path";
import { MAX_FILE_BYTES, MAX_ZIP_DEPTH, TEXT_EXT } from "./config.mjs";
import { parseSourceMap, parsePdf } from "./formats/docs.mjs";
import { parseTiff } from "./formats/exif.mjs";
import { parseGif, parseJpeg, parsePng, parseWebp } from "./formats/images.mjs";
import { parseMp4 } from "./formats/media.mjs";
import { gltfMeta, parseGlb, parseStl, parseZip } from "./formats/models.mjs";

const NOT_LATIN = new RegExp(`[^ -~${String.fromCharCode(0xa0)}-${String.fromCharCode(0x24f)}]+`, "g");
const BINARY_GENERIC_SKIP = new Set(["generic/entropy", "generic/uuid", "generic/phone", "generic/ip", "generic/mac-address", "generic/grid-coordinates", "generic/national-id", "generic/iban", "generic/bank-account", "generic/domain", "generic/hostname"]);

const ext = (p) => path.extname(p).slice(1).toLowerCase();

/** Identify a buffer by magic bytes, then by extension. */
export function sniff(buf, name = "") {
  const e = ext(name);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 6 && buf.toString("latin1", 0, 4) === "GIF8") return "gif";
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp") return "mp4";
  if (buf.length >= 12 && buf.readUInt32LE(0) === 0x46546c67) return "glb";
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return "zip";
  if (buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-") return "pdf";
  if (buf.length >= 8 && ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0 && buf[3] === 0x2a))) return "tiff";
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return "utf16";
  if (e === "stl") return buf.toString("latin1", 0, 5) === "solid" && buf.toString("latin1", 0, 512).includes("facet") ? "text" : "stl";
  if (TEXT_EXT.has(e) || /^(?:license|licence|readme|dockerfile|makefile)$/i.test(path.basename(name))) return "text";
  if (buf.subarray(0, 8000).includes(0)) return "binary";
  return "text";
}

/** Text of a buffer for the "readable" part of binary content: non-Latin characters become line breaks. */
function readable(text) {
  return text.replace(NOT_LATIN, "\n");
}

/** Scan arbitrary bytes as strings: UTF-8 and UTF-16LE (both alignments). */
function scanBinaryStrings(scanner, buf, loc, findings) {
  const base = { ...loc, noisy: true, binary: true };
  const skip = BINARY_GENERIC_SKIP;
  const run = (text, view) => {
    for (const f of scanner.scanText(readable(text), { ...base, field: `${loc.field ?? "bytes"}:${view}`, skip })) {
      findings.push({ ...f, line: undefined, col: undefined, offset: f.offset });
    }
  };
  run(buf.toString("utf8"), "utf8");
  if (buf.indexOf(0) !== -1) {
    run(buf.toString("utf16le"), "utf16le");
    if (buf.length > 1) run(buf.subarray(1, buf.length - ((buf.length - 1) % 2)).toString("utf16le"), "utf16le+1");
  }
}

/** Convert parser output (strings, flags, nested) into findings. */
function applyMeta(scanner, meta, loc, depth, findings, stats) {
  for (const s of meta.strings) {
    const found = scanner.scanText(s.text, { ...loc, field: s.field, noisy: !s.doc });
    for (const f of found) {
      if (s.doc) findings.push(f);
      else findings.push({ ...f, line: undefined, col: undefined, offset: s.offset ?? f.offset });
    }
  }
  for (const fl of meta.flags) {
    findings.push({ category: fl.category, path: loc.path, source: loc.source ?? "tree", field: fl.field, offset: fl.offset, hash8: scanner.hash8(`${fl.category}:${fl.field}`) });
  }
  if (depth < MAX_ZIP_DEPTH) {
    for (const n of meta.nested) {
      findings.push(...scanContent(scanner, n.buf, { ...loc, path: `${loc.path}!${n.name}` }, depth + 1, stats));
    }
  }
}

/**
 * Scan a buffer.
 * @param {import("./scanner.mjs").Scanner} scanner
 * @param {Buffer} buf
 * @param {{ path: string, source?: string, field?: string }} loc
 * @param {number} depth
 * @param {{ files: number, bytes: number, skipped: number }} [stats]
 * @returns {import("./scanner.mjs").Finding[]}
 */
export function scanContent(scanner, buf, loc, depth = 0, stats = undefined) {
  const findings = [];
  if (stats) {
    stats.files++;
    stats.bytes += buf.length;
  }
  if (buf.length > MAX_FILE_BYTES) {
    if (stats) stats.skipped++;
    return findings;
  }
  const kind = sniff(buf, loc.path.split("!").pop() ?? loc.path);
  const here = { ...loc };
  try {
    switch (kind) {
      case "jpeg":
        applyMeta(scanner, parseJpeg(buf), here, depth, findings, stats);
        break;
      case "png":
        applyMeta(scanner, parsePng(buf), here, depth, findings, stats);
        break;
      case "webp":
        applyMeta(scanner, parseWebp(buf), here, depth, findings, stats);
        break;
      case "gif":
        applyMeta(scanner, parseGif(buf), here, depth, findings, stats);
        break;
      case "tiff": {
        const t = parseTiff(buf, "tiff");
        applyMeta(scanner, t, here, depth, findings, stats);
        break;
      }
      case "mp4":
        applyMeta(scanner, parseMp4(buf), here, depth, findings, stats);
        break;
      case "glb":
        applyMeta(scanner, parseGlb(buf), here, depth, findings, stats);
        break;
      case "zip":
        applyMeta(scanner, parseZip(buf), here, depth, findings, stats);
        break;
      case "pdf":
        applyMeta(scanner, parsePdf(buf), here, depth, findings, stats);
        break;
      case "stl":
        applyMeta(scanner, parseStl(buf), here, depth, findings, stats);
        break;
      case "utf16": {
        const le = buf[0] === 0xff;
        const body = le ? buf.subarray(2) : Buffer.from(buf.subarray(2)).swap16();
        findings.push(...scanner.scanText(body.toString("utf16le"), here));
        break;
      }
      case "binary":
        scanBinaryStrings(scanner, buf, here, findings);
        break;
      default:
        scanTextBuffer(scanner, buf, here, depth, findings, stats);
    }
  } catch {
    // a parser failure must not hide the content: fall back to the raw strings
    scanBinaryStrings(scanner, buf, here, findings);
  }
  return findings;
}

function scanTextBuffer(scanner, buf, loc, depth, findings, stats) {
  const text = buf.toString("utf8");
  const e = ext(loc.path.split("!").pop() ?? loc.path);
  if (e === "map") {
    const meta = parseSourceMap(text);
    if (meta) {
      applyMeta(scanner, meta, loc, depth, findings, stats);
      return;
    }
  }
  if (e === "gltf") {
    applyMeta(scanner, gltfMeta(text, null, "gltf"), loc, depth, findings, stats);
    return;
  }
  findings.push(...scanner.scanText(text, loc));
  if (e === "svg" || e === "svgz-text") {
    const flagIf = (re, field) => {
      const m = re.exec(text);
      if (m) findings.push({ category: "meta/editor-data", path: loc.path, source: loc.source ?? "tree", field, offset: m.index, hash8: scanner.hash8(`meta/editor-data:${field}`) });
    };
    flagIf(/sodipodi:docname\s*=/, "svg:docname");
    flagIf(/inkscape:export-filename\s*=/, "svg:export-filename");
    flagIf(/<dc:creator|<cc:license[^>]*>[\s\S]{0,200}<dc:|<dc:rights/, "svg:rdf-creator");
  }
}
