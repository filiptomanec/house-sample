// The orbit video: the ffmpeg command line and the search for the CRF that lands the file in the wanted size range.
// The frames go in 1:1 (24 fps, no interpolation); H.264 High, yuv420p, BT.709, fast start, no audio, no metadata.
import { SPEC } from "./media-plan";
import type { Mp4Info } from "./media-probe";

export interface CrfSearchOptions {
  start: number;
  /** Search range of the CRF (inclusive). */
  minCrf: number;
  maxCrf: number;
  minBytes: number;
  maxBytes: number;
  targetBytes: number;
  maxTries?: number;
}

export interface CrfSearchResult {
  crf: number;
  bytes: number;
  inRange: boolean;
  tried: { crf: number; bytes: number }[];
}

/**
 * Finds a CRF whose file size is in [minBytes, maxBytes]. The size roughly doubles every 6 CRF steps downwards, so the next
 * try jumps by 6 * log2(size / target); once a too big and a too small CRF are known the search bisects between them. When no
 * CRF fits (the content is too simple or too busy for the range) the one closest to the target size wins.
 */
export async function searchCrf(measure: (crf: number) => Promise<number>, o: CrfSearchOptions): Promise<CrfSearchResult> {
  let big = o.minCrf - 1; // CRFs known to give a file above the range
  let small = o.maxCrf + 1; // CRFs known to give a file below the range
  let crf = Math.min(o.maxCrf, Math.max(o.minCrf, o.start));
  const tried: { crf: number; bytes: number }[] = [];
  let best: { crf: number; bytes: number } | null = null;
  for (let attempt = 0; attempt < (o.maxTries ?? 8); attempt++) {
    const bytes = await measure(crf);
    tried.push({ crf, bytes });
    if (bytes >= o.minBytes && bytes <= o.maxBytes) {
      best = { crf, bytes };
      break;
    }
    if (bytes > o.maxBytes) big = Math.max(big, crf);
    else small = Math.min(small, crf);
    if (big + 1 > small - 1) break; // no CRF left between a too big and a too small one
    let step = Math.round((6 * Math.log2(bytes / o.targetBytes)) || 0);
    if (step === 0) step = bytes > o.targetBytes ? 1 : -1;
    let next = crf + step;
    if (big >= o.minCrf && small <= o.maxCrf) next = Math.floor((big + small) / 2);
    if (next <= big) next = big + 1;
    if (next >= small) next = small - 1;
    if (tried.some((t) => t.crf === next)) break;
    crf = next;
  }
  const closest = tried.reduce((a, b) => (Math.abs(b.bytes - o.targetBytes) < Math.abs(a.bytes - o.targetBytes) ? b : a));
  const pick = best ?? closest;
  return { crf: pick.crf, bytes: pick.bytes, inRange: best !== null, tried };
}

export interface FfmpegVideoArgs {
  /** Input pattern, e.g. "/dir/%04d.png". */
  input: string;
  fps: number;
  frames: number;
  crf: number;
  out: string;
  width?: number;
  height?: number;
}

/**
 * Arguments of the encode. Colour: the frames are sRGB pictures, the video is tagged BT.709 and converted with the BT.709
 * matrix, so a browser shows the colours of the stills (an untagged video would be decoded with a guessed matrix). The scaler
 * runs bit-exact and the metadata is dropped so that the same frames give the same file.
 */
export function ffmpegVideoArgs(a: FfmpegVideoArgs): string[] {
  const w = a.width ?? SPEC.video.w;
  const h = a.height ?? SPEC.video.h;
  const scale = `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int+bitexact:out_color_matrix=bt709:out_range=tv`;
  return [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-framerate", String(a.fps), "-start_number", "0", "-i", a.input,
    "-frames:v", String(a.frames),
    "-vf", `format=gbrp,${scale},format=yuv420p`,
    "-c:v", "libx264", "-preset", SPEC.video.preset, "-profile:v", "high", "-crf", String(a.crf), "-g", String(SPEC.video.gop),
    "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-an", "-movflags", "+faststart",
    // no metadata: no container tags, and no SEI NAL units (x264 would write its version and settings into the stream)
    "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-bsf:v", "filter_units=remove_types=6",
    a.out,
  ];
}

/** What a finished video must be: the codec the browsers all play, the size and the frame count of the sequence. */
export function videoProblems(info: Mp4Info, e: { width: number; height: number; fps: number; frames: number }): string[] {
  const p: string[] = [];
  const v = info.video;
  if (!v) return ["no video track"];
  if (v.codec !== "avc1") p.push(`codec ${v.codec}, expected avc1 (H.264)`);
  if (v.profile !== 100) p.push(`H.264 profile ${v.profile}, expected 100 (High)`);
  if (v.chromaFormat !== 1 || v.bitDepth !== 8) p.push(`pixel format is not 8-bit 4:2:0 (chroma ${v.chromaFormat}, ${v.bitDepth} bit)`);
  if (v.width !== e.width || v.height !== e.height) p.push(`size ${v.width}x${v.height}, expected ${e.width}x${e.height}`);
  if (Math.abs(v.fps - e.fps) > 0.01) p.push(`${v.fps} fps, expected ${e.fps}`);
  if (v.frames !== e.frames) p.push(`${v.frames} frames, expected ${e.frames}`);
  if (!info.fastStart) p.push("the index (moov) is behind the media data: not fast start");
  if (info.tracks.some((t) => t.handler !== "vide")) p.push("the file has an audio or data track");
  if (info.metadataBoxes.length) p.push(`metadata boxes: ${info.metadataBoxes.join(", ")}`);
  if (v.encoderName) p.push(`the sample entry names the encoder ("${v.encoderName}")`);
  if (info.creationTime !== 0) p.push("the movie header carries a creation time");
  return p;
}
