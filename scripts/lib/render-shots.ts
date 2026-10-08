// Shots of the render inputs: time and sun, lamp levels, blinds, louvres, gates and garage door, cameras for stills, the day
// sequence (landscape and its own portrait camera), the orbit (per-variant elevation, lens and fit, caption windows), the
// compare pair and the Open Graph image. Everything is derived from model/render.json and the world data.
import {
  absoluteCamera, fieldOfView, insideFrame, project, resolveCamera, type CameraDefaults, type ResolvedCamera,
} from "./render-camera";
import { blindStates, screenStates, type BlindDetails, type BlindItem, type ScreenItem } from "./render-equipment";
import { facingAzimuth, type Feature } from "./render-features";
import { scheduleLevel } from "./render-lights";
import {
  LEVEL_BELOW_M, type BlindsRequest, type CameraSpec, type GatesRequest, type LightsRequest, type RenderConfig, type ScreensRequest, type Vec3,
} from "./render-schema";
import type {
  BlindState, DayFrame, GateState, LightLevels, OrbitCaption, OrbitFrame, OrbitVariant, Shot, StillShot, SunInfo, SunScreen, TimeInfo,
} from "./render-types";
import { localToUtc, sunPhase, sunVector } from "./solar";

const RAD = Math.PI / 180;
const mod360 = (a: number): number => ((a % 360) + 360) % 360;

/** A sun implementation: position at a UTC instant. Azimuth clockwise from true north; elevations in degrees. */
export interface SunProvider {
  name: string;
  position(utcMs: number, latDeg: number, lonDeg: number): { azimuthDeg: number; elevationDeg: number; elevationGeomDeg: number };
}

export interface ShotContext {
  cfg: RenderConfig;
  lat: number;
  lon: number;
  tz: string;
  bearingDeg: number;
  sun: SunProvider;
  blinds: { rule: { closeAboveIrradiance: number }; details: Pick<BlindDetails, "autoDrop" | "maxDrop" | "cutoffMarginDeg" | "closedSlatAngleDeg" | "slatPitch" | "slatWidth">; items: BlindItem[] };
  screens: ScreenItem[];
  camera: CameraDefaults;
  bbox: { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number };
  /** Points of the house silhouette (roof-plane corners and the outline at the floor): what the orbit keeps in the frame. */
  silhouette: Vec3[];
  /** Roofs that can cover a camera: the outline at the eave `[x0, y0, x1, y1]` and the height of the eave edge. */
  roofs: { eaveRect: [number, number, number, number]; eaveHeight: number }[];
  /** Height of the graded terrain (the kernel's `groundAt`, with the house's slabs). */
  groundAt: (x: number, y: number) => number;
  /** Resolves a feature word (render-features.ts); null when the model has no such feature. */
  feature: (word: string) => Feature | null;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export function timeInfo(ctx: ShotContext, date: string, local: string): { info: TimeInfo; utcMs: number } {
  const lt = localToUtc(date, local, ctx.tz);
  return { info: { date, local, iso: lt.iso, utc: lt.utcIso, utcOffsetMinutes: lt.utcOffsetMinutes }, utcMs: lt.utcMs };
}

export function sunAt(ctx: ShotContext, utcMs: number): SunInfo {
  const p = ctx.sun.position(utcMs, ctx.lat, ctx.lon);
  const azHouse = mod360(p.azimuthDeg - ctx.bearingDeg);
  return {
    azimuthTrueDeg: p.azimuthDeg,
    azimuthHouseDeg: azHouse,
    elevationDeg: p.elevationDeg,
    elevationGeomDeg: p.elevationGeomDeg,
    direction: sunVector(azHouse, p.elevationDeg),
    phase: sunPhase(p.elevationDeg),
    blender: { sunElevationRad: p.elevationDeg * RAD, sunRotationRad: azHouse * RAD },
  };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function lightLevels(ctx: ShotContext, request: LightsRequest, elevationDeg: number): LightLevels {
  if (typeof request === "object") return { mode: "custom", interior: request.interior, exterior: request.exterior };
  if (request === "on") return { mode: "on", interior: 1, exterior: 1 };
  if (request === "off") return { mode: "off", interior: 0, exterior: 0 };
  const s = ctx.cfg.lights.schedule;
  return { mode: "auto", interior: r3(scheduleLevel(s.interior, elevationDeg)), exterior: r3(scheduleLevel(s.exterior, elevationDeg)) };
}

/** A camera of render.json resolved against the terrain (aboveGround, level) into the output object. */
export function cameraOf(ctx: ShotContext, spec: CameraSpec, size: readonly [number, number]): ResolvedCamera {
  const abs = absoluteCamera(spec, ctx.groundAt, LEVEL_BELOW_M);
  return resolveCamera(abs, size, ctx.camera, ctx.groundAt(abs.position[0], abs.position[1]));
}

/**
 * Is the ray from `from` towards `dir` (unit vector) stopped by a roof that covers `from`? The underside of a roof is never lower
 * than its eave edge, so the ray gets out only when it crosses the eave outline below the eave height.
 */
export function roofBlocks(roofs: ShotContext["roofs"], from: Vec3, dir: Vec3): boolean {
  const horiz = Math.hypot(dir[0], dir[1]);
  for (const r of roofs) {
    const [x0, y0, x1, y1] = r.eaveRect;
    if (from[0] < x0 || from[0] > x1 || from[1] < y0 || from[1] > y1 || from[2] >= r.eaveHeight) continue;
    if (horiz < 1e-9) return true;
    // horizontal distance at which the ray leaves the eave outline
    let t = Infinity;
    if (dir[0] > 1e-9) t = Math.min(t, (x1 - from[0]) / dir[0]);
    if (dir[0] < -1e-9) t = Math.min(t, (x0 - from[0]) / dir[0]);
    if (dir[1] > 1e-9) t = Math.min(t, (y1 - from[1]) / dir[1]);
    if (dir[1] < -1e-9) t = Math.min(t, (y0 - from[1]) / dir[1]);
    // t is the parameter along the unit vector; the height gained over it is t * dir[2]
    if (from[2] + t * dir[2] >= r.eaveHeight) return true;
  }
  return false;
}

export function sunScreenOf(ctx: ShotContext, cam: ResolvedCamera, size: readonly [number, number], sun: SunInfo): SunScreen | null {
  if (sun.elevationDeg < -0.5) return null;
  const p = project(cam, size, sun.direction, true);
  if (!p) return null;
  const inFrame = insideFrame(p);
  return { x: r3(p.x), y: r3(p.y), inFrame, visible: inFrame && sun.elevationDeg > 0 && !roofBlocks(ctx.roofs, cam.position, sun.direction) };
}

/** The moving parts of a shot (defaults: gates and garage door closed, louvres `auto`). */
interface StateRequest {
  gates?: GatesRequest;
  garageDoor?: number;
  screens?: ScreensRequest;
}

const gateState = (g: GatesRequest | undefined): GateState => ({ driveway: g?.driveway ?? 0, walkway: g?.walkway ?? 0 });

/** Blinds, louvres, gates and garage door of a moment. */
function stateAt(ctx: ShotContext, sun: SunInfo, blinds: BlindsRequest, s: StateRequest) {
  return {
    blinds: blindStates(ctx.blinds.items, ctx.blinds.rule, ctx.blinds.details, sun, blinds) as BlindState[],
    gates: gateState(s.gates),
    garageDoor: s.garageDoor ?? 0,
    screens: screenStates(ctx.screens, sun, s.screens ?? "auto"),
  };
}

interface ShotArgs extends StateRequest {
  id: string;
  file: string;
  size: [number, number];
  date: string;
  local: string;
  camera: CameraSpec;
  lights: LightsRequest;
  blinds: BlindsRequest;
  subjects?: string[];
}

export function makeShot(ctx: ShotContext, a: ShotArgs): Shot {
  const t = timeInfo(ctx, a.date, a.local);
  const sun = sunAt(ctx, t.utcMs);
  const camera = cameraOf(ctx, a.camera, a.size);
  const st = stateAt(ctx, sun, a.blinds, a);
  return {
    id: a.id,
    file: a.file,
    size: a.size,
    time: t.info,
    camera,
    sun,
    lights: lightLevels(ctx, a.lights, sun.elevationDeg),
    blinds: st.blinds,
    sunScreen: sunScreenOf(ctx, camera, a.size, sun),
    gates: st.gates,
    garageDoor: st.garageDoor,
    screens: st.screens,
    subjects: a.subjects ?? [],
  };
}

export function buildStills(ctx: ShotContext): StillShot[] {
  return ctx.cfg.stills.map((s) => ({
    ...makeShot(ctx, {
      id: s.id, file: `stills/${s.id}`, size: s.size, date: s.date ?? ctx.cfg.date, local: s.time, camera: s.camera, lights: s.lights, blinds: s.blinds,
      gates: s.gates, garageDoor: s.garageDoor, screens: s.screens, subjects: s.subjects,
    }),
    label: s.label,
    alt: s.alt,
    category: s.category,
    ...(s.notes ? { notes: s.notes } : {}),
  }));
}

/** Expands `[{from, to, stepMin}]` into sorted unique "HH:MM" strings (both ends included). */
export function expandRanges(ranges: readonly { from: string; to: string; stepMin: number }[]): string[] {
  const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const set = new Set<number>();
  for (const r of ranges) for (let m = toMin(r.from); m <= toMin(r.to); m += r.stepMin) set.add(m);
  return [...set].sort((x, y) => x - y).map((m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
}

export function buildDay(ctx: ShotContext) {
  const d = ctx.cfg.day;
  const date = d.date ?? ctx.cfg.date;
  const camera = cameraOf(ctx, d.camera, d.size);
  const portraitCamera = cameraOf(ctx, d.portrait.camera, d.portrait.size);
  const times = expandRanges(d.ranges);
  if (!times.includes(d.stillTime)) throw new Error(`day.stillTime ${d.stillTime} is not one of the day times`);
  const frames: DayFrame[] = times.map((local, index) => {
    const t = timeInfo(ctx, date, local);
    const sun = sunAt(ctx, t.utcMs);
    const id = local.replace(":", "");
    const st = stateAt(ctx, sun, d.blinds, d);
    return {
      index,
      id,
      file: `day/${id}`,
      time: t.info,
      sun,
      lights: lightLevels(ctx, d.lights, sun.elevationDeg),
      blinds: st.blinds,
      sunScreen: sunScreenOf(ctx, camera, d.size, sun),
      gates: st.gates,
      garageDoor: st.garageDoor,
      screens: st.screens,
      portrait: { file: `day/portrait/${id}`, sunScreen: sunScreenOf(ctx, portraitCamera, d.portrait.size, sun) },
    };
  });
  return {
    date,
    size: d.size,
    camera,
    /** The phone version: rendered with its own camera at its own size (not a crop), same times and states. */
    portrait: { size: d.portrait.size, camera: portraitCamera },
    stillTime: d.stillTime,
    subjects: d.subjects ?? [],
    frames,
  };
}

// ------------------------------------------------------------------------------------------------ orbit

type Orbit = RenderConfig["orbit"];

/** Camera azimuth (house frame, degrees from the target) of frame `i`. */
export function orbitAngle(o: Orbit, i: number): number {
  return mod360(o.startAzimuthDeg + ((o.direction === "clockwise" ? 1 : -1) * 360 * i) / o.frameCount);
}

/** Elevation of the camera at an azimuth: the variant's elevation plus the smooth lifts of render.json (periodic, so the loop closes). */
export function orbitElevation(o: Orbit, baseDeg: number, angleDeg: number): number {
  let el = baseDeg;
  for (const l of o.lifts ?? []) {
    const d = azimuthGap(angleDeg, l.azimuthDeg);
    if (d < l.halfWidthDeg && l.elevationDeg > baseDeg) el += (l.elevationDeg - baseDeg) * Math.cos((Math.PI * d) / (2 * l.halfWidthDeg)) ** 2;
  }
  return el;
}

/** Camera position of frame `i` for the horizontal distance `radius` (the breathing terms are periodic in the frame number). */
function orbitPosition(o: Orbit, elevationDeg: number, target: Vec3, radius: number, i: number): { position: Vec3; angleDeg: number; elevationDeg: number } {
  const n = o.frameCount;
  const angle = orbitAngle(o, i);
  const a = angle * RAD;
  const el = orbitElevation(o, elevationDeg, angle);
  const r = radius * (1 + o.breathing.radiusFraction * Math.cos((4 * Math.PI * i) / n));
  const z = target[2] + radius * Math.tan(el * RAD) + o.breathing.heightM * Math.sin((4 * Math.PI * i) / n);
  return { position: [target[0] + r * Math.sin(a), target[1] + r * Math.cos(a), z], angleDeg: angle, elevationDeg: el };
}

/** Largest change of the orbit distance per degree of azimuth (m): the camera dollies in and out gently. */
export const ORBIT_RADIUS_SLOPE = 0.1;

export interface OrbitLens {
  size: [number, number];
  focalMm: number;
  margin: number;
  elevationDeg: number;
}

/**
 * Does the house (its silhouette points) stay inside the frame (shrunk by the margin) at frame `i` for this radius, and the `extra`
 * points (the features whose caption shows in that frame) inside the frame itself?
 */
export function orbitFitsAt(ctx: ShotContext, lens: OrbitLens, target: Vec3, radius: number, i: number, extra: readonly Vec3[] = []): boolean {
  const pos = orbitPosition(ctx.cfg.orbit, lens.elevationDeg, target, radius, i).position;
  const cam = resolveCamera({ position: pos, target, focalMm: lens.focalMm }, lens.size, ctx.camera);
  for (const c of ctx.silhouette) if (!insideFrame(project(cam, lens.size, c), lens.margin)) return false;
  for (const c of extra) if (!insideFrame(project(cam, lens.size, c))) return false;
  return true;
}

/** Smallest horizontal distance at which the building (and `extra`) fits at frame `i` (bisection; fitting is monotone in the distance). */
export function fitRadiusAt(ctx: ShotContext, lens: OrbitLens, target: Vec3, i: number, extra: readonly Vec3[] = []): number {
  let lo = 1, hi = 800;
  if (!orbitFitsAt(ctx, lens, target, hi, i, extra)) throw new Error("the orbit cannot fit the building even at 800 m: check focalMm and elevationDeg");
  for (let k = 0; k < 48; k++) {
    const mid = (lo + hi) / 2;
    if (orbitFitsAt(ctx, lens, target, mid, i, extra)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Periodic gaussian smoothing of a closed series (sigma in samples). */
export function smoothClosed(values: readonly number[], sigma: number): number[] {
  const n = values.length;
  const half = Math.ceil(3 * sigma);
  const w: number[] = [];
  for (let k = -half; k <= half; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0);
  return values.map((_, i) => {
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += w[k + half] * values[(((i + k) % n) + n) % n];
    return acc / sum;
  });
}

/**
 * Horizontal distance of every frame of a closed orbit: the building fits (with the margin) at every frame, so does the feature of
 * every caption while it shows (`extra(i)`: the pool in front of the house), and the distance follows the shape of the building
 * smoothly (closer to the short sides), so the apparent size stays nearly constant.
 */
export function orbitRadii(ctx: ShotContext, lens: OrbitLens, target: Vec3, extra: (i: number) => readonly Vec3[] = () => []): number[] {
  const n = ctx.cfg.orbit.frameCount;
  const fit = Array.from({ length: n }, (_, i) => fitRadiusAt(ctx, lens, target, i, extra(i)));
  // a slope-limited envelope over the fit (the distance changes by at most ORBIT_RADIUS_SLOPE per degree of azimuth), rounded
  // with a light periodic smoothing: a long side or a caption feature pushes the camera out only locally; a last global factor
  // makes sure the fit holds at every frame
  const step = 360 / n;
  const env = fit.map((_, i) => Math.max(...fit.map((f, j) => f - ORBIT_RADIUS_SLOPE * step * Math.min(Math.abs(i - j), n - Math.abs(i - j)))));
  const smooth = smoothClosed(env, n / 48);
  const k = Math.max(1, ...fit.map((f, i) => f / smooth[i]));
  const slack = ctx.cfg.orbit.radiusSlack;
  return smooth.map((r) => Math.ceil(r * k * slack * 1000) / 1000);
}

/** Smallest angular distance between two azimuths, degrees. */
export const azimuthGap = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Caption windows: for each feature, the frames whose camera azimuth is within `halfWindowDeg` of the azimuth the feature faces
 * (`facingAzimuth`: the facing of a facade element or roof plane, the direction of an area from the orbit target). The web
 * shows a caption by the same rule from `startAzimuthDeg`, `direction` and the model.
 */
export function orbitCaptions(ctx: ShotContext, target: Vec3): OrbitCaption[] {
  const o = ctx.cfg.orbit;
  const out: OrbitCaption[] = [];
  for (const word of o.captions.features) {
    const f = ctx.feature(word);
    if (!f) throw new Error(`render.json orbit.captions: the model has no feature "${word}"`);
    const az = r3(facingAzimuth(f, target));
    const frames: number[] = [];
    for (let i = 0; i < o.frameCount; i++) if (azimuthGap(orbitAngle(o, i), az) <= o.captions.halfWindowDeg + 1e-9) frames.push(i);
    out.push({ feature: word, azimuthDeg: az, point: f.center, normal: f.normal, frames });
  }
  // in the order the camera meets them (a window that wraps past frame 0 counts from its start)
  const startOf = (c: OrbitCaption): number => {
    if (!c.frames.length) return Infinity;
    const set = new Set(c.frames);
    let s = c.frames[0];
    if (set.has(0) && set.has(o.frameCount - 1)) s = c.frames.find((f, k) => k > 0 && f - c.frames[k - 1] > 1) ?? 0;
    return s;
  };
  return out.sort((a, b) => startOf(a) - startOf(b));
}

export function buildOrbit(ctx: ShotContext) {
  const o = ctx.cfg.orbit;
  const date = o.date ?? ctx.cfg.date;
  const t = timeInfo(ctx, date, o.time);
  const sun = sunAt(ctx, t.utcMs);
  const b = ctx.bbox;
  const target: Vec3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, o.targetZ];
  const n = o.frameCount;
  const scrollCount = Math.ceil(n / o.scrollStep);
  const st = stateAt(ctx, sun, o.blinds, o);
  // a caption names what the frame shows: its feature is kept in the frame while the caption shows
  const captions = orbitCaptions(ctx, target);
  const captionPoints = (i: number): Vec3[] => captions.filter((c) => c.frames.includes(i)).flatMap((c) => ctx.feature(c.feature)?.points ?? []);

  const variants: OrbitVariant[] = o.variants.map((v) => {
    const focalMm = v.focalMm ?? o.focalMm;
    const margin = v.fitMargin ?? o.fitMargin;
    const elevationDeg = v.elevationDeg ?? o.elevationDeg;
    const radii = orbitRadii(ctx, { size: v.size, focalMm, margin, elevationDeg }, target, captionPoints);
    const frames: OrbitFrame[] = [];
    for (let i = 0; i < n; i++) {
      const scroll = i % o.scrollStep === 0;
      if (v.frameSelection === "scroll" && !scroll) continue;
      const { position, angleDeg, elevationDeg: el } = orbitPosition(o, elevationDeg, target, radii[i], i);
      frames.push({
        index: i,
        scrollIndex: scroll ? i / o.scrollStep : null,
        angleDeg: r3(angleDeg),
        elevationDeg: r3(el),
        radius: radii[i],
        file: `orbit/${v.id}/${String(i).padStart(4, "0")}`,
        camera: resolveCamera({ position, target, focalMm }, v.size, ctx.camera, ctx.groundAt(position[0], position[1])),
      });
    }
    return {
      id: v.id,
      size: v.size,
      frameSelection: v.frameSelection,
      fitMargin: margin,
      radiusMin: Math.min(...frames.map((f) => f.radius)),
      radiusMax: Math.max(...frames.map((f) => f.radius)),
      elevationDeg,
      focalMm,
      fov: fieldOfView(focalMm, ctx.camera.sensorWidthMm, v.size),
      frames,
    };
  });
  return {
    date,
    time: t.info,
    sun,
    lights: lightLevels(ctx, o.lights, sun.elevationDeg),
    blinds: st.blinds,
    gates: st.gates,
    garageDoor: st.garageDoor,
    screens: st.screens,
    fps: o.fps,
    frameCount: n,
    durationSec: n / o.fps,
    loop: true,
    startAzimuthDeg: o.startAzimuthDeg,
    direction: o.direction,
    breathing: o.breathing,
    lifts: o.lifts ?? [],
    scrollStep: o.scrollStep,
    scrollCount,
    target,
    captionHalfWindowDeg: o.captions.halfWindowDeg,
    captions,
    variants,
  };
}

export function buildCompare(ctx: ShotContext) {
  const c = ctx.cfg.compare;
  const mk = (which: "before" | "after") => {
    const side = c[which];
    return {
      ...makeShot(ctx, {
        id: `${c.id}-${which}`, file: `compare/${c.id}-${which}`, size: c.size, date: ctx.cfg.date, local: side.time, camera: c.camera, lights: side.lights, blinds: side.blinds,
        gates: side.gates, garageDoor: side.garageDoor, screens: side.screens, subjects: c.subjects,
      }),
      label: side.label,
      title: side.title,
      alt: side.alt,
      gallery: side.gallery ?? true,
    };
  };
  return { id: c.id, size: c.size, alt: c.alt, before: mk("before"), after: mk("after") };
}

export function buildOg(ctx: ShotContext): Shot & { alt: { cs: string; en: string } } {
  const g = ctx.cfg.og;
  return {
    ...makeShot(ctx, {
      id: g.id, file: `og/${g.id}`, size: g.size, date: ctx.cfg.date, local: g.time, camera: g.camera, lights: g.lights, blinds: g.blinds,
      gates: g.gates, garageDoor: g.garageDoor, screens: g.screens, subjects: g.subjects,
    }),
    alt: g.alt,
  };
}
