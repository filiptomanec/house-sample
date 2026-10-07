// GLB / glTF, STL and ZIP (USDZ) metadata extraction.
import zlib from "node:zlib";
import { MAX_ZIP_ENTRY_BYTES } from "../config.mjs";

function printable(buf, min = 5) {
  return buf.toString("utf8").replace(/[^\p{L}\p{N}\p{P}\p{S} ]+/gu, "\n").split("\n").filter((s) => s.length >= min);
}

/** Split a GLB into its JSON and BIN chunks. Returns null when the container is malformed. */
export function splitGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null;
  let json = null;
  let bin = null;
  let i = 12;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32LE(i);
    const type = buf.readUInt32LE(i + 4);
    const data = buf.subarray(i + 8, Math.min(buf.length, i + 8 + len));
    if (type === 0x4e4f534a && !json) json = data;
    else if (type === 0x004e4942 && !bin) bin = data;
    i += 8 + len + ((4 - (len % 4)) % 4);
  }
  return json ? { json: json.toString("utf8").replace(/[\0 ]+$/, ""), bin } : null;
}

/** Metadata of a glTF document (parsed JSON) and its binary buffer, if any. */
export function gltfMeta(jsonText, bin, label = "gltf") {
  const meta = { strings: [], flags: [], nested: [] };
  meta.strings.push({ field: `${label}:json`, text: jsonText, offset: 0, doc: true });
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch {
    return meta;
  }
  const asset = doc.asset ?? {};
  if (typeof asset.copyright === "string" && asset.copyright.trim()) meta.flags.push({ category: "meta/personal-field", field: `${label}:asset.copyright` });
  for (const kind of ["buffers", "images"]) {
    (doc[kind] ?? []).forEach((item, idx) => {
      const uri = item?.uri;
      if (typeof uri !== "string") return;
      const data = /^data:[^;,]*(?:;[^;,]*)*;base64,(.*)$/s.exec(uri);
      if (data) {
        try {
          meta.nested.push({ name: `${label}:${kind}[${idx}]${item.name ? `/${item.name}` : ""}`, buf: Buffer.from(data[1], "base64"), hint: item.mimeType });
        } catch {
          // ignore undecodable data URI
        }
      } else meta.flags.push({ category: "meta/external-uri", field: `${label}:${kind}[${idx}].uri` });
    });
  }
  if (bin && Array.isArray(doc.images)) {
    doc.images.forEach((img, idx) => {
      if (typeof img?.bufferView !== "number") return;
      const bv = doc.bufferViews?.[img.bufferView];
      if (!bv || typeof bv.byteLength !== "number") return;
      const off = bv.byteOffset ?? 0;
      if (off + bv.byteLength <= bin.length) {
        meta.nested.push({ name: `${label}:images[${idx}]`, buf: bin.subarray(off, off + bv.byteLength), hint: img.mimeType });
      }
    });
  }
  return meta;
}

export function parseGlb(buf) {
  const parts = splitGlb(buf);
  if (!parts) return { strings: [], flags: [{ category: "meta/malformed", field: "glb" }], nested: [] };
  return gltfMeta(parts.json, parts.bin, "glb");
}

/** Binary STL: 80-byte header text. ASCII STL is a text file and is scanned as such. */
export function parseStl(buf) {
  const meta = { strings: [], flags: [], nested: [] };
  const header = buf.subarray(0, 80);
  for (const s of printable(header, 3)) meta.strings.push({ field: "stl:header", text: s, offset: 0 });
  return meta;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Parse a ZIP (also USDZ, DOCX, ...). Returns entry names and comments as strings, the contents of entries as nested buffers.
 */
export function parseZip(buf) {
  const meta = { strings: [], flags: [], nested: [] };
  const eocd = findEocd(buf);
  if (eocd < 0) return meta;
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  const commentLen = buf.readUInt16LE(eocd + 20);
  if (commentLen) meta.strings.push({ field: "zip:comment", text: buf.subarray(eocd + 22, eocd + 22 + commentLen).toString("utf8"), offset: eocd + 22 });
  if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20 && buf.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z64 = Number(buf.readBigUInt64LE(eocd - 20 + 8));
    if (z64 + 56 <= buf.length && buf.readUInt32LE(z64) === 0x06064b50) {
      count = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    let local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const comment = buf.subarray(p + 46 + nameLen + extraLen, p + 46 + nameLen + extraLen + cmtLen).toString("utf8");
    // zip64 extra field
    for (let e = 0; e + 4 <= extra.length; ) {
      const id = extra.readUInt16LE(e);
      const sz = extra.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let o = e + 4;
        if (usize === 0xffffffff && o + 8 <= extra.length) {
          usize = Number(extra.readBigUInt64LE(o));
          o += 8;
        }
        if (csize === 0xffffffff && o + 8 <= extra.length) {
          csize = Number(extra.readBigUInt64LE(o));
          o += 8;
        }
        if (local === 0xffffffff && o + 8 <= extra.length) local = Number(extra.readBigUInt64LE(o));
      } else if (id === 0x7075 || id === 0x6375) {
        for (const s of printable(extra.subarray(e + 4 + 5, e + 4 + sz), 1)) meta.strings.push({ field: "zip:unicode-extra", text: s, offset: p });
      }
      e += 4 + sz;
    }
    meta.strings.push({ field: "zip:entry-name", text: name, offset: p });
    if (comment.trim()) meta.strings.push({ field: "zip:entry-comment", text: comment, offset: p });
    if (/(?:^|\/)__MACOSX\/|(?:^|\/)\.DS_Store$/.test(name)) meta.flags.push({ category: "meta/junk-entry", field: "zip:entry", offset: p });
    if (!name.endsWith("/") && usize <= MAX_ZIP_ENTRY_BYTES && local + 30 <= buf.length && buf.readUInt32LE(local) === 0x04034b50) {
      const dStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(dStart, dStart + csize);
      try {
        if (method === 0) meta.nested.push({ name, buf: raw });
        else if (method === 8) meta.nested.push({ name, buf: zlib.inflateRawSync(raw, { maxOutputLength: MAX_ZIP_ENTRY_BYTES }) });
      } catch {
        meta.flags.push({ category: "meta/malformed", field: "zip:entry", offset: p });
      }
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return meta;
}
