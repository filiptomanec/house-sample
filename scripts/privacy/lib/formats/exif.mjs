// EXIF / TIFF and IPTC parsing for the privacy scanner. Everything is bounds-checked: malformed input yields less output, never an exception.

/** @typedef {{ field: string, text: string, offset?: number }} MetaString */
/** @typedef {{ category: string, field: string, offset?: number }} MetaFlag */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 };

const TAG_NAMES = {
  0x010d: "DocumentName", 0x010e: "ImageDescription", 0x010f: "Make", 0x0110: "Model", 0x0131: "Software", 0x013b: "Artist",
  0x013c: "HostComputer", 0x8298: "Copyright", 0x9286: "UserComment", 0x927c: "MakerNote", 0xa420: "ImageUniqueID",
  0xa430: "CameraOwnerName", 0xa431: "BodySerialNumber", 0xa435: "LensSerialNumber", 0x9c9b: "XPTitle", 0x9c9c: "XPComment",
  0x9c9d: "XPAuthor", 0x9c9e: "XPKeywords", 0x9c9f: "XPSubject", 0x8825: "GPSInfo", 0x8769: "ExifIFD", 0xa005: "InteropIFD",
};
/** Tags whose presence with a non-empty value is a finding on its own. */
const PERSONAL_TAGS = new Set([0x010d, 0x010e, 0x010f, 0x0110, 0x013b, 0x013c, 0x8298, 0x9286, 0xa420, 0xa430, 0xa431, 0xa435, 0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f]);

function printableRuns(buf, min = 4) {
  const text = buf.toString("utf8").replace(/[^\p{L}\p{N}\p{P}\p{S} ]+/gu, "\n");
  return text.split("\n").filter((s) => s.length >= min);
}

/**
 * Parse a TIFF structure (as used by EXIF). Returns strings, flags and nested thumbnails.
 * @param {Buffer} buf  buffer starting at the TIFF header
 * @returns {{ strings: MetaString[], flags: MetaFlag[], nested: { name: string, buf: Buffer }[] }}
 */
export function parseTiff(buf, prefix = "exif") {
  /** @type {MetaString[]} */
  const strings = [];
  /** @type {MetaFlag[]} */
  const flags = [];
  const nested = [];
  if (buf.length < 8) return { strings, flags, nested };
  const le = buf[0] === 0x49 && buf[1] === 0x49;
  if (!le && !(buf[0] === 0x4d && buf[1] === 0x4d)) return { strings, flags, nested };
  const u16 = (o) => (o + 2 <= buf.length ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : 0);
  const u32 = (o) => (o + 4 <= buf.length ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : 0);
  if (u16(2) !== 42) return { strings, flags, nested };
  const visited = new Set();

  function readIfd(offset, label, depth) {
    if (depth > 4 || offset < 8 || offset + 2 > buf.length || visited.has(offset)) return 0;
    visited.add(offset);
    const n = Math.min(u16(offset), 2000);
    let thumbOff = 0;
    let thumbLen = 0;
    for (let i = 0; i < n; i++) {
      const e = offset + 2 + i * 12;
      if (e + 12 > buf.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 0) * count;
      const dataOff = size <= 4 ? e + 8 : u32(e + 8);
      const valid = size > 0 && size < 1 << 26 && dataOff + size <= buf.length;
      const name = TAG_NAMES[tag] ?? `0x${tag.toString(16)}`;
      const field = `${prefix}:${label}:${name}`;
      if (tag === 0x8825 && label !== "GPS") {
        flags.push({ category: "meta/gps", field, offset: e });
        if (type === 4) readIfd(u32(e + 8), "GPS", depth + 1);
        continue;
      }
      if ((tag === 0x8769 || tag === 0xa005) && type === 4) {
        readIfd(u32(e + 8), tag === 0x8769 ? "Exif" : "Interop", depth + 1);
        continue;
      }
      if (label === "IFD1" && tag === 0x0201) thumbOff = u32(e + 8);
      if (label === "IFD1" && tag === 0x0202) thumbLen = u32(e + 8);
      if (!valid) continue;
      const data = buf.subarray(dataOff, dataOff + size);
      let text = "";
      if (type === 2) text = data.toString("utf8").replace(/\0+$/, "");
      else if (tag >= 0x9c9b && tag <= 0x9c9f) text = data.toString("utf16le").replace(/\0+$/, "");
      else if (tag === 0x9286 && data.length > 8) {
        const charset = data.subarray(0, 8).toString("latin1");
        let body = data.subarray(8);
        if (charset.startsWith("UNICODE")) {
          if (!le && body.length % 2 === 0) body = Buffer.from(body).swap16();
          text = body.toString("utf16le").replace(/\0+$/, "");
        } else text = body.toString("utf8").replace(/\0+$/, "");
      } else if (tag === 0x927c) {
        for (const s of printableRuns(data, 5)) strings.push({ field, text: s, offset: dataOff });
        continue;
      } else if (label === "GPS") {
        text = "";
      }
      if (text.trim()) strings.push({ field, text, offset: dataOff });
      if (PERSONAL_TAGS.has(tag) && (text.trim() || tag === 0x9286)) flags.push({ category: "meta/personal-field", field, offset: dataOff });
    }
    const next = u32(offset + 2 + n * 12);
    if (label === "IFD1" && thumbOff && thumbLen && thumbOff + thumbLen <= buf.length) {
      nested.push({ name: `${prefix}:thumbnail`, buf: buf.subarray(thumbOff, thumbOff + thumbLen) });
    }
    return next;
  }

  const ifd1 = readIfd(u32(4), "IFD0", 0);
  if (ifd1) readIfd(ifd1, "IFD1", 0);
  return { strings, flags, nested };
}

/**
 * Parse IPTC-IIM records (the payload of Photoshop resource 0x0404).
 * @returns {MetaString[]}
 */
export function parseIptc(buf, prefix = "iptc") {
  const out = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    if (buf[i] !== 0x1c) {
      i++;
      continue;
    }
    const rec = buf[i + 1];
    const ds = buf[i + 2];
    let len = buf.readUInt16BE(i + 3);
    let start = i + 5;
    if (len & 0x8000) {
      const n = len & 0x7fff;
      if (n > 4 || start + n > buf.length) break;
      len = 0;
      for (let k = 0; k < n; k++) len = len * 256 + buf[start + k];
      start += n;
    }
    if (start + len > buf.length) break;
    const text = buf.subarray(start, start + len).toString("utf8");
    if (text.trim()) out.push({ field: `${prefix}:${rec}:${ds}`, text, offset: start });
    i = start + len;
  }
  return out;
}

/** Parse Photoshop 8BIM resource blocks (JPEG APP13 payload after "Photoshop 3.0\0"). */
export function parsePhotoshop(buf) {
  const strings = [];
  const flags = [];
  let i = 0;
  while (i + 12 <= buf.length && buf.subarray(i, i + 4).toString("latin1") === "8BIM") {
    const id = buf.readUInt16BE(i + 4);
    const nameLen = buf[i + 6];
    let p = i + 7 + nameLen;
    if ((1 + nameLen) % 2 === 1) p++;
    if (p + 4 > buf.length) break;
    const size = buf.readUInt32BE(p);
    p += 4;
    if (p + size > buf.length) break;
    const data = buf.subarray(p, p + size);
    if (id === 0x0404) {
      flags.push({ category: "meta/iptc", field: "iptc", offset: p });
      strings.push(...parseIptc(data));
    } else if (id !== 0x0408 && id !== 0x040f && id !== 0x0409 && id !== 0x040c) {
      for (const s of printableRuns(data, 5)) strings.push({ field: `photoshop:0x${id.toString(16)}`, text: s, offset: p });
    }
    i = p + size + (size % 2);
  }
  return { strings, flags };
}

/** Flags for an XMP packet (text). */
export function xmpFlags(xml) {
  const flags = [];
  const rules = [
    [/exif:GPS\w+|GPSLatitude|GPSLongitude/i, "meta/gps"],
    [/<dc:creator|<dc:rights|xmpRights:|photoshop:(?:Credit|AuthorsPosition|CaptionWriter|City|State|Country|Source)|Iptc4xmpCore:(?:Location|CreatorContactInfo)|<dc:contributor|exif:CameraOwnerName|aux:SerialNumber/i, "meta/personal-field"],
  ];
  for (const [re, category] of rules) {
    const m = re.exec(xml);
    if (m) flags.push({ category, field: "xmp", offset: m.index });
  }
  return flags;
}
