// Shots of the render inputs: time and sun, lamp levels, blinds, cameras for stills, the day sequence, the orbit, the compare
// pair and the Open Graph image. Everything is derived from model/render.json and the world data.
import {
  boxCorners, fieldOfView, insideFrame, project, resolveCamera, type CameraDefaults, type ResolvedCamera,
} from "./render-camera";
import { blindStates, type BlindItem } from "./render-equipment";
import { scheduleLevel } from "./render-lights";
import type { BlindsRequest, CameraSpec, LightsRequest, RenderConfig, Vec3 } from "./render-schema";
import type {
  BlindState, DayFrame, LightLevels, OrbitFrame, OrbitVariant, Shot, StillShot, SunInfo, SunScreen, TimeInfo,
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
  blinds: { rule: { closeAboveIrradiance: number }; details: { maxDrop: number; cutoffMarginDeg: number; closedSlatAngleDeg: number }; items: BlindItem[] };
  camera: CameraDefaults;
  bbox: { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number };
  /** Roofs that can cover a camera: the outline at the eave `[x0, y0, x1, y1]` and the height of the eave edge. */
  roofs: { eaveRect: [number, number, number, number]; eaveHeight: number }[];
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

interface ShotArgs {
  id: string;
  file: string;
  size: [number, number];
  date: string;
  local: string;
  camera: CameraSpec;
  lights: LightsRequest;
  blinds: BlindsRequest;
}

export function makeShot(ctx: ShotContext, a: ShotArgs): Shot {
  const t = timeInfo(ctx, a.date, a.local);
  const sun = sunAt(ctx, t.utcMs);
  const camera = resolveCamera(a.camera, a.size, ctx.camera);
  return {
    id: a.id,
    file: a.file,
    size: a.size,
    time: t.info,
    camera,
    sun,
    lights: lightLevels(ctx, a.lights, sun.elevationDeg),
    blinds: blindStates(ctx.blinds.items, ctx.blinds.rule, ctx.blinds.details, sun, a.blinds),
    sunScreen: sunScreenOf(ctx, camera, a.size, sun),
  };
}

export function buildStills(ctx: ShotContext): StillShot[] {
  return ctx.cfg.stills.map((s) => ({
    ...makeShot(ctx, { id: s.id, file: `stills/${s.id}`, size: s.size, date: s.date ?? ctx.cfg.date, local: s.time, camera: s.camera, lights: s.lights, blinds: s.blinds }),
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
  const camera = resolveCamera(d.camera, d.size, ctx.camera);
  const times = expandRanges(d.ranges);
  const frames: DayFrame[] = times.map((local, index) => {
    const t = timeInfo(ctx, date, local);
    const sun = sunAt(ctx, t.utcMs);
    return {
      index,
      id: local.replace(":", ""),
      file: `day/${local.replace(":", "")}`,
      time: t.info,
      sun,
      lights: lightLevels(ctx, d.lights, sun.elevationDeg),
      blinds: blindStates(ctx.blinds.items, ctx.blinds.rule, ctx.blinds.details, sun, d.blinds),
      sunScreen: sunScreenOf(ctx, camera, d.size, sun),
    };
  });
  const [w, h] = d.size;
  const even = (v: number): number => Math.round(v / 2) * 2;
  const cw = Math.min(w, even((h * d.portrait.aspect[0]) / d.portrait.aspect[1]));
  const cx = Math.max(0, Math.min(w - cw, even(d.portrait.centerX * w - cw / 2)));
  if (!times.includes(d.stillTime)) throw new Error(`day.stillTime ${d.stillTime} is not one of the day times`);
  return {
    date,
    size: d.size,
    camera,
    portrait: { aspect: d.portrait.aspect, size: [cw, h] as [number, number], crop: { x: cx, y: 0, width: cw, height: h } },
    stillTime: d.stillTime,
    frames,
  };
}

// ------------------------------------------------------------------------------------------------ orbit

type Orbit = RenderConfig["orbit"];

/** Camera position of frame `i` for the horizontal distance `radius` (the breathing terms are periodic in the frame number). */
function orbitPosition(o: Orbit, target: Vec3, radius: number, i: number): { position: Vec3; angleDeg: number } {
  const n = o.frameCount;
  const sgn = o.direction === "clockwise" ? 1 : -1;
  const angle = mod360(o.startAzimuthDeg + (sgn * 360 * i) / n);
  const a = angle * RAD;
  const r = radius * (1 + o.breathing.radiusFraction * Math.cos((4 * Math.PI * i) / n));
  const z = target[2] + radius * Math.tan(o.elevationDeg * RAD) + o.breathing.heightM * Math.sin((4 * Math.PI * i) / n);
  return { position: [target[0] + r * Math.sin(a), target[1] + r * Math.cos(a), z], angleDeg: angle };
}

interface OrbitLens {
  size: [number, number];
  focalMm: number;
  margin: number;
}

/** Does the whole building box stay inside the frame (shrunk by the margin) at frame `i` for this radius? */
export function orbitFitsAt(ctx: ShotContext, lens: OrbitLens, target: Vec3, radius: number, i: number): boolean {
  const b = ctx.bbox;
  const pos = orbitPosition(ctx.cfg.orbit, target, radius, i).position;
  const cam = resolveCamera({ position: pos, target, focalMm: lens.focalMm }, lens.size, ctx.camera);
  for (const c of boxCorners(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1)) if (!insideFrame(project(cam, lens.size, c), lens.margin)) return false;
  return true;
}

/** Smallest horizontal distance at which the building fits at frame `i` (bisection; fitting is monotone in the distance). */
export function fitRadiusAt(ctx: ShotContext, lens: OrbitLens, target: Vec3, i: number): number {
  let lo = 1, hi = 800;
  if (!orbitFitsAt(ctx, lens, target, hi, i)) throw new Error("the orbit cannot fit the building even at 800 m: check focalMm and elevationDeg");
  for (let k = 0; k < 48; k++) {
    const mid = (lo + hi) / 2;
    if (orbitFitsAt(ctx, lens, target, mid, i)) hi = mid;
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
 * Horizontal distance of every frame of a closed orbit: the building fits (with the margin) at every frame, and the distance
 * follows the shape of the building smoothly (closer to the short sides), so the apparent size stays nearly constant.
 */
export function orbitRadii(ctx: ShotContext, lens: OrbitLens, target: Vec3): number[] {
  const n = ctx.cfg.orbit.frameCount;
  const fit = Array.from({ length: n }, (_, i) => fitRadiusAt(ctx, lens, target, i));
  const smooth = smoothClosed(fit, n / 24);
  const k = Math.max(1, ...fit.map((f, i) => f / smooth[i]));
  const slack = ctx.cfg.orbit.radiusSlack;
  return smooth.map((r) => Math.ceil(r * k * slack * 1000) / 1000);
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

  const variants: OrbitVariant[] = o.variants.map((v) => {
    const focalMm = v.focalMm ?? o.focalMm;
    const margin = v.fitMargin ?? o.fitMargin;
    const radii = orbitRadii(ctx, { size: v.size, focalMm, margin }, target);
    const frames: OrbitFrame[] = [];
    for (let i = 0; i < n; i++) {
      const scroll = i % o.scrollStep === 0;
      if (v.frameSelection === "scroll" && !scroll) continue;
      const { position, angleDeg } = orbitPosition(o, target, radii[i], i);
      frames.push({
        index: i,
        scrollIndex: scroll ? i / o.scrollStep : null,
        angleDeg: r3(angleDeg),
        radius: radii[i],
        file: `orbit/${v.id}/${String(i).padStart(4, "0")}`,
        camera: resolveCamera({ position, target, focalMm }, v.size, ctx.camera),
      });
    }
    return {
      id: v.id,
      size: v.size,
      frameSelection: v.frameSelection,
      fitMargin: margin,
      radiusMin: Math.min(...frames.map((f) => f.radius)),
      radiusMax: Math.max(...frames.map((f) => f.radius)),
      elevationDeg: o.elevationDeg,
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
    blinds: blindStates(ctx.blinds.items, ctx.blinds.rule, ctx.blinds.details, sun, o.blinds) as BlindState[],
    fps: o.fps,
    frameCount: n,
    durationSec: n / o.fps,
    loop: true,
    startAzimuthDeg: o.startAzimuthDeg,
    direction: o.direction,
    breathing: o.breathing,
    scrollStep: o.scrollStep,
    scrollCount,
    target,
    variants,
  };
}

export function buildCompare(ctx: ShotContext) {
  const c = ctx.cfg.compare;
  const mk = (which: "before" | "after") => ({
    ...makeShot(ctx, { id: `${c.id}-${which}`, file: `compare/${c.id}-${which}`, size: c.size, date: ctx.cfg.date, local: c[which].time, camera: c.camera, lights: c[which].lights, blinds: c[which].blinds }),
    label: c[which].label,
  });
  return { id: c.id, size: c.size, alt: c.alt, before: mk("before"), after: mk("after") };
}

export function buildOg(ctx: ShotContext): Shot & { alt: { cs: string; en: string } } {
  const g = ctx.cfg.og;
  return { ...makeShot(ctx, { id: g.id, file: `og/${g.id}`, size: g.size, date: ctx.cfg.date, local: g.time, camera: g.camera, lights: g.lights, blinds: g.blinds }), alt: g.alt };
}
