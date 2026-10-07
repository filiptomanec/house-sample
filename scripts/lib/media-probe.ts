// Reads what the media checks need straight from the bytes (no ImageMagick, no ffprobe): the size, subsampling and metadata
// segments of a JPEG, the size of a PNG, and the structure of an MP4 (codec profile, chroma format, frame count, frame rate,
// audio tracks, metadata boxes, position of the index for fast start). Used by scripts/check-media.ts and the build.

export interface JpegInfo {
  width: number;
  height: number;
  progressive: boolean;
  components: number;
  /** "4:2:0", "4:4:4", ... (luma sampling factors against the chroma ones); null for grey scale. */
  subsampling: string | null;
  /** Metadata segments other than the JFIF header: APP1 (Exif, XMP), APP2 (ICC), APP13, comments, ... */
  metadata: string[];
}

const APP_NAMES: Record<number, string> = { 0xe1: "APP1 (Exif/XMP)", 0xe2: "APP2 (ICC profile)", 0xed: "APP13 (Photoshop)", 0xee: "APP14 (Adobe)", 0xfe: "COM (comment)" };

/** Parses the headers of a baseline or progressive JPEG; throws when the bytes are not a JPEG. */
export function probeJpeg(buf: Buffer): JpegInfo {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG (no SOI marker)");
  const metadata: string[] = [];
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) throw new Error(`bad JPEG marker at byte ${pos}`);
    let marker = buf[pos + 1];
    while (marker === 0xff) marker = buf[++pos + 1]; // fill bytes
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const len = buf.readUInt16BE(pos + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const components = buf[pos + 9];
      const sampling: number[] = [];
      for (let c = 0; c < components; c++) sampling.push(buf[pos + 11 + c * 3]);
      let subsampling: string | null = null;
      if (components >= 3) {
        const [h0, v0] = [sampling[0] >> 4, sampling[0] & 15];
        const [h1, v1] = [sampling[1] >> 4, sampling[1] & 15];
        if (h0 === 2 && v0 === 2 && h1 === 1 && v1 === 1) subsampling = "4:2:0";
        else if (h0 === 2 && v0 === 1 && h1 === 1 && v1 === 1) subsampling = "4:2:2";
        else if (h0 === h1 && v0 === v1) subsampling = "4:4:4";
        else subsampling = `${h0}x${v0}/${h1}x${v1}`;
      }
      return { width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5), progressive: marker === 0xc2, components, subsampling, metadata };
    }
    if (marker === 0xe0) {
      // JFIF is the only application segment a clean file keeps; any other APP0 (e.g. JFXX thumbnail) is data
      const id = buf.toString("latin1", pos + 4, pos + 8);
      if (id !== "JFIF") metadata.push(`APP0 (${id})`);
    } else if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) {
      metadata.push(APP_NAMES[marker] ?? `APP${marker - 0xe0}`);
    }
    pos += 2 + len;
  }
  throw new Error("JPEG without a frame header");
}

/** Width and height of a PNG or JPEG file; null for anything else. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("latin1", 12, 16) === "IHDR") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    try {
      const { width, height } = probeJpeg(buf);
      return { width, height };
    } catch {
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ MP4

export interface TrackInfo {
  handler: string; // "vide", "soun", ...
  timescale: number;
  /** Duration of the media in seconds (sum of the sample durations). */
  durationS: number;
  samples: number;
}

export interface Mp4Info {
  brands: string[];
  /** The index (moov) comes before the media data (mdat): playback can start before the file has been downloaded. */
  fastStart: boolean;
  tracks: TrackInfo[];
  video: {
    width: number;
    height: number;
    codec: string;
    profile: number | null;
    level: number | null;
    /** From the SPS: 1 = 4:2:0. */
    chromaFormat: number | null;
    bitDepth: number | null;
    /** The "compressor name" field of the sample entry: encoders write their own name there ("Lavc libx264"). */
    encoderName: string;
    fps: number;
    frames: number;
    durationS: number;
  } | null;
  /** Boxes that carry metadata (udta, meta, ilst, ...) anywhere in the moov. */
  metadataBoxes: string[];
  /** Creation time of the movie header in seconds since 1904 (0 when none is stored). */
  creationTime: number;
}

interface VideoTrackInfo {
  encoderName: string;
  width: number;
  height: number;
  codec: string;
  profile: number | null;
  level: number | null;
  chromaFormat: number | null;
  bitDepth: number | null;
  delta: number;
  timescale: number;
  samples: number;
  durationUnits: number;
}

interface Box {
  type: string;
  start: number; // start of the payload
  end: number;
}

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) throw new Error(`broken MP4 box "${type}" at byte ${pos}`);
    yield { type, start: pos + header, end: pos + size };
    pos += size;
  }
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);
const METADATA_BOXES = new Set(["meta", "ilst", "©too", "XMP_"]);

/** Bit reader for the exp-Golomb fields of an H.264 sequence parameter set. */
class Bits {
  private pos = 0;
  constructor(private readonly b: Buffer) {}
  bit(): number {
    const v = (this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }
  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + this.bit();
    return v;
  }
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0 && zeros < 32) zeros++;
    return 2 ** zeros - 1 + this.bits(zeros);
  }
}

/** profile_idc, level_idc, chroma_format_idc and bit depth of an SPS NAL unit (with its one byte header). */
function parseSps(sps: Buffer): { profile: number; level: number; chromaFormat: number; bitDepth: number } {
  // remove emulation prevention bytes (00 00 03)
  const rbsp: number[] = [];
  for (let i = 1; i < sps.length; i++) {
    if (i >= 3 && sps[i] === 3 && sps[i - 1] === 0 && sps[i - 2] === 0) continue;
    rbsp.push(sps[i]);
  }
  const r = new Bits(Buffer.from(rbsp));
  const profile = r.bits(8);
  r.bits(8);
  const level = r.bits(8);
  r.ue(); // seq_parameter_set_id
  let chromaFormat = 1;
  let bitDepth = 8;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chromaFormat = r.ue();
    if (chromaFormat === 3) r.bit(); // separate_colour_plane_flag
    bitDepth = r.ue() + 8;
  }
  return { profile, level, chromaFormat, bitDepth };
}

/** Parses the structure of an MP4 file; throws when it is not one. */
export function probeMp4(buf: Buffer): Mp4Info {
  const info: Mp4Info = { brands: [], fastStart: false, tracks: [], video: null, metadataBoxes: [], creationTime: 0 };
  let moovAt = -1;
  let mdatAt = -1;
  let sawFtyp = false;
  const videoTracks: VideoTrackInfo[] = [];

  const walkTrack = (trak: Box): void => {
    let handler = "";
    let timescale = 0;
    let samples = 0;
    let durationUnits = 0;
    let firstDelta = 0;
    let width = 0;
    let height = 0;
    let codec = "";
    let profile: number | null = null;
    let level: number | null = null;
    let chromaFormat: number | null = null;
    let bitDepth: number | null = null;
    let encoderName = "";
    const walk = (start: number, end: number): void => {
      for (const b of boxes(buf, start, end)) {
        if (METADATA_BOXES.has(b.type)) info.metadataBoxes.push(b.type);
        if (CONTAINERS.has(b.type)) walk(b.start, b.end);
        else if (b.type === "tkhd") {
          const v = buf[b.start];
          const off = b.start + (v === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 2 + 2 + 2 + 2 + 36;
          width = buf.readUInt32BE(off) / 65536;
          height = buf.readUInt32BE(off + 4) / 65536;
        } else if (b.type === "mdhd") {
          timescale = buf.readUInt32BE(b.start + (buf[b.start] === 1 ? 20 : 12));
        } else if (b.type === "hdlr") handler = buf.toString("latin1", b.start + 8, b.start + 12);
        else if (b.type === "stts") {
          const n = buf.readUInt32BE(b.start + 4);
          for (let i = 0; i < n; i++) {
            const count = buf.readUInt32BE(b.start + 8 + i * 8);
            const delta = buf.readUInt32BE(b.start + 12 + i * 8);
            if (i === 0) firstDelta = delta;
            durationUnits += count * delta;
          }
        } else if (b.type === "stsz") samples = buf.readUInt32BE(b.start + 8);
        else if (b.type === "stsd") {
          for (const e of boxes(buf, b.start + 8, b.end)) {
            codec = e.type;
            if (e.type === "avc1" || e.type === "avc3") {
              const nameLen = Math.min(31, buf[e.start + 42]);
              encoderName = buf.toString("latin1", e.start + 43, e.start + 43 + nameLen);
              for (const c of boxes(buf, e.start + 78, e.end)) {
                if (c.type !== "avcC") continue;
                const nSps = buf[c.start + 5] & 0x1f;
                if (nSps > 0) {
                  const len = buf.readUInt16BE(c.start + 6);
                  const sps = parseSps(buf.subarray(c.start + 8, c.start + 8 + len));
                  ({ profile, level, chromaFormat, bitDepth } = sps);
                }
              }
            }
          }
        }
      }
    };
    walk(trak.start, trak.end);
    info.tracks.push({ handler, timescale, durationS: timescale ? durationUnits / timescale : 0, samples });
    if (handler === "vide") videoTracks.push({ encoderName, width, height, codec, profile, level, chromaFormat, bitDepth, delta: firstDelta, timescale, samples, durationUnits });
  };

  for (const top of boxes(buf, 0, buf.length)) {
    if (top.type === "ftyp") {
      sawFtyp = true;
      info.brands.push(buf.toString("latin1", top.start, top.start + 4));
      for (let p = top.start + 8; p + 4 <= top.end; p += 4) info.brands.push(buf.toString("latin1", p, p + 4));
    } else if (top.type === "moov") {
      moovAt = top.start;
      for (const b of boxes(buf, top.start, top.end)) {
        if (b.type !== "udta" && METADATA_BOXES.has(b.type)) info.metadataBoxes.push(b.type);
        if (b.type === "mvhd") {
          const v = buf[b.start];
          info.creationTime = v === 1 ? Number(buf.readBigUInt64BE(b.start + 4)) : buf.readUInt32BE(b.start + 4);
        } else if (b.type === "trak") walkTrack(b);
        else if (b.type === "udta") {
          // ffmpeg always writes an empty `meta` (a handler and an empty `ilst`); that holds no data, anything else does
          for (const u of boxes(buf, b.start, b.end)) {
            if (u.type !== "meta") info.metadataBoxes.push(`udta/${u.type}`);
            else
              for (const m of boxes(buf, u.start + 4, u.end)) {
                const harmless = m.type === "hdlr" || m.type === "free" || (m.type === "ilst" && m.end === m.start);
                if (!harmless) info.metadataBoxes.push(`udta/meta/${m.type}`);
              }
          }
        }
      }
    } else if (top.type === "mdat" && mdatAt < 0) mdatAt = top.start;
  }
  if (!sawFtyp || moovAt < 0) throw new Error("not an MP4 (no ftyp or moov box)");
  info.fastStart = mdatAt < 0 || moovAt < mdatAt;
  const vt = videoTracks[0];
  if (vt) {
    info.video = {
      width: vt.width,
      height: vt.height,
      codec: vt.codec,
      profile: vt.profile,
      level: vt.level,
      chromaFormat: vt.chromaFormat,
      bitDepth: vt.bitDepth,
      encoderName: vt.encoderName,
      fps: vt.delta ? vt.timescale / vt.delta : 0,
      frames: vt.samples,
      durationS: vt.timescale ? vt.durationUnits / vt.timescale : 0,
    };
  }
  return info;
}

/**
 * Overwrites the "compressor name" of the video sample entries with zeros (in place, same length, so no offset moves) and
 * returns how many entries it changed. That field is the only place left where ffmpeg writes the name of the encoder.
 */
export function blankEncoderName(buf: Buffer): number {
  let changed = 0;
  const walk = (start: number, end: number, depth: string[]): void => {
    for (const b of boxes(buf, start, end)) {
      if (depth.length < 5 && b.type === ["moov", "trak", "mdia", "minf", "stbl"][depth.length]) walk(b.start, b.end, [...depth, b.type]);
      else if (depth.length === 5 && b.type === "stsd") {
        for (const e of boxes(buf, b.start + 8, b.end)) {
          if ((e.type === "avc1" || e.type === "avc3") && buf[e.start + 42] > 0) {
            buf.fill(0, e.start + 42, e.start + 74);
            changed++;
          }
        }
      }
    }
  };
  walk(0, buf.length, []);
  return changed;
}
