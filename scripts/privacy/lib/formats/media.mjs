// MP4 / QuickTime metadata extraction (boxes under moov: udta, meta, ilst, keys, loci, XMP uuid). Sample data (mdat) is skipped.
import { xmpFlags } from "./exif.mjs";

const C = String.fromCharCode(0xa9); // the (c) sign that prefixes QuickTime text atoms
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "udta", "edts", "dinf", "moof", "traf", "mvex", "ilst", "tref", "gmhd", "meco", "stbl"]);
const BINARY = new Set([
  "mdat", "mvhd", "tkhd", "mdhd", "vmhd", "smhd", "hmhd", "nmhd", "dref", "stsd", "stts", "stss", "ctts", "stsc", "stsz", "stz2", "stco",
  "co64", "sdtp", "elst", "trex", "mfhd", "tfhd", "tfdt", "trun", "sidx", "ftyp", "styp", "mehd", "stps", "sgpd", "sbgp", "senc", "saiz", "saio",
]);
const GPS_ATOMS = new Set([`${C}xyz`, "loci", "xyz "]);
const PERSONAL_ATOMS = new Set([
  `${C}ART`, `${C}aut`, `${C}wrt`, `${C}cpy`, "cprt", `${C}cmt`, "desc", "ldes", `${C}own`, `${C}prd`, `${C}mak`, `${C}mod`, `${C}grp`,
  `${C}src`, `${C}ope`, `${C}prf`, `${C}req`, `${C}inf`, `${C}url`, `${C}nrt`, `${C}com`, "auth", "perf", "titl", "dscp", "yrrc",
]);
const XMP_UUID = "be7acfcb97a942e89c71999491e3afac";

function printable(buf, min = 5) {
  return buf.toString("utf8").replace(/[^\p{L}\p{N}\p{P}\p{S} ]+/gu, "\n").split("\n").filter((s) => s.length >= min);
}

function atomText(payload) {
  if (payload.length >= 16 && payload.subarray(4, 8).toString("latin1") === "data") return payload.subarray(16).toString("utf8").replace(/\0+$/, "");
  if (payload.length >= 4) {
    const n = payload.readUInt16BE(0);
    if (n > 0 && n <= payload.length - 4) return payload.subarray(4, 4 + n).toString("utf8").replace(/\0+$/, "");
  }
  return printable(payload, 1).join(" ");
}

/** @returns {{ strings: any[], flags: any[], nested: any[] }} */
export function parseMp4(buf) {
  const meta = { strings: [], flags: [], nested: [] };
  const flag = (category, field, offset) => meta.flags.push({ category, field, offset });
  const str = (field, text, offset, doc = false) => {
    if (text && text.trim()) meta.strings.push({ field, text, offset, doc });
  };

  function walk(start, end, parent, depth) {
    if (depth > 10) return;
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const type = buf.subarray(i + 4, i + 8).toString("latin1");
      let hdr = 8;
      if (size === 1) {
        if (i + 16 > end) break;
        size = Number(buf.readBigUInt64BE(i + 8));
        hdr = 16;
      } else if (size === 0) size = end - i;
      if (size < hdr || i + size > end) size = end - i;
      if (size < hdr) break;
      const pStart = i + hdr;
      const pEnd = i + size;
      const payload = buf.subarray(pStart, pEnd);
      const where = `mp4:${parent ? `${parent}/` : ""}${type}`;
      if (type === "mdat") {
        // sample data: skipped
      } else if (type === "meta") {
        // FullBox (4 bytes of version and flags) in ISO files; QuickTime files have none
        const looksBox = (o) => o + 8 <= pEnd && /^[ -~]{4}$/.test(buf.subarray(o + 4, o + 8).toString("latin1"));
        const inner = looksBox(pStart) ? pStart : pStart + 4;
        walk(inner, pEnd, `${parent}/meta`, depth + 1);
      } else if (type === "keys") {
        const n = payload.length >= 8 ? payload.readUInt32BE(4) : 0;
        let o = 8;
        for (let k = 0; k < n && o + 8 <= payload.length; k++) {
          const ks = payload.readUInt32BE(o);
          if (ks < 8 || o + ks > payload.length) break;
          const key = payload.subarray(o + 8, o + ks).toString("utf8");
          str(`${where}:key`, key, pStart + o);
          if (/location|gps|iso6709/i.test(key)) flag("meta/gps", `${where}:${key.length}`, pStart + o);
          o += ks;
        }
      } else if (type === "uuid") {
        const id = payload.subarray(0, 16).toString("hex");
        if (id === XMP_UUID) {
          const xml = payload.subarray(16).toString("utf8");
          str("mp4:xmp", xml, pStart, true);
          meta.flags.push(...xmpFlags(xml));
        } else for (const s of printable(payload.subarray(16), 6)) str(`${where}:uuid`, s, pStart);
      } else if (type === "hdlr") {
        // handler name follows 24 fixed bytes
        str(where, payload.subarray(24).toString("utf8").replace(/\0+$/, ""), pStart + 24);
      } else if (CONTAINERS.has(type)) {
        walk(pStart, pEnd, type === "ilst" ? `${parent}/ilst` : type, depth + 1);
      } else if (parent.endsWith("ilst")) {
        // metadata item: type is the item name, payload holds a data box
        const text = atomText(payload);
        str(`${where}`, text, pStart);
        if (GPS_ATOMS.has(type)) flag("meta/gps", where, pStart);
        else if (PERSONAL_ATOMS.has(type) && text.trim()) flag("meta/personal-field", where, pStart);
      } else if (parent.endsWith("udta")) {
        const text = atomText(payload);
        str(where, text, pStart);
        if (GPS_ATOMS.has(type)) flag("meta/gps", where, pStart);
        else if (PERSONAL_ATOMS.has(type) && text.trim()) flag("meta/personal-field", where, pStart);
        else if (type === "XMP_") {
          const xml = payload.toString("utf8");
          str("mp4:xmp", xml, pStart, true);
          meta.flags.push(...xmpFlags(xml));
        }
      } else if (type === "xml ") {
        str(where, payload.subarray(4).toString("utf8"), pStart, true);
      } else if (!BINARY.has(type) && payload.length < 262144) {
        for (const s of printable(payload, 6)) str(where, s, pStart);
      }
      i += size;
    }
  }

  walk(0, buf.length, "", 0);
  return meta;
}
