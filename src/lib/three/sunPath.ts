// The sun path in the scene (Sun page, contract C5: `addSunPath(viewer, opts) -> { setDay, setMinute, onDrag }`): the day's arc
// of the sun drawn as dots around the house, a larger dot at every full hour (with an optional label through the CSS2D layer),
// the part of the day already travelled in mint, and a white sun disc at the current minute that can be dragged along the arc.
// It shows the cause of the shadows the page is about.
//
//  * Geometry (pure, tested): `sunPathSamples` samples `sunPosition(date, minute)` every `step` minutes while the sun is up,
//    with the sunrise and sunset ends refined by bisection; `arcPoint` puts a sun direction (the same formula as the light,
//    `sunDirectionScene`) at `radius` around `centre`. Nothing describes the house: the centre and radius come from the
//    page's scene extent (`sceneExtent(ctx, "house")`, radius `SUN_PATH.radiusShare` of it).
//  * Drawing: one InstancedMesh for the dots and ticks (instance colours: travelled mint, the rest white), one mesh for the disc
//    and its halo. Unlit (`MeshBasicMaterial`), not tone-mapped, no shadows, never an occluder, not cut by the section plane
//    (added to `viewer.scene`, not adopted by the house). Colours from the tokens (`--sun-disc`, `--mint`).
//  * Dragging: a pointer that goes down on the disc takes over from the orbit controls (capture phase on the container), moves
//    the disc to the arc sample nearest to the pointer on screen and reports the minute (`onDrag`); the page sets its time from
//    it the same way as from its slider (the slider stays the accessible control; the disc is decorative).
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { SUN_UP_ALTITUDE, localToUtc, placeOf, sunPosition as calcSunPosition, type CalendarDate } from "@/lib/calc/sun";
import type { HouseContext } from "./context";
import { sunDirectionScene, toScene, type Vec3 } from "./frame";
import type { SunPositionFn } from "./sunAnalysis";
import { readToken } from "./theme";
import type { Viewer } from "./viewer";

/** Drawing conventions of the sun path (sizes relative to its radius). */
export const SUN_PATH = {
  /** Radius of the arc as a share of the scene extent's radius. */
  radiusShare: 0.8,
  /** Minutes between dots. */
  step: 10,
  /** Radius of a dot, of an hour tick and of the sun disc, as shares of the arc radius. */
  dot: 0.006,
  tick: 0.012,
  disc: 0.045,
  /** The halo around the disc, as a multiple of the disc radius, and its opacity. */
  halo: 1.6,
  haloOpacity: 0.35,
  /** Opacity of the dots not yet travelled. */
  restOpacity: 0.85,
  /** Most samples of a day (24 h every 10 min plus the two ends). */
  maxSamples: 24 * 6 + 3,
} as const;

/** One sample of the arc: minute of the local clock day, true azimuth and altitude (degrees), whether it is a full hour. */
export interface SunPathSample {
  minute: number;
  azimuth: number;
  altitude: number;
  hour: boolean;
}

/**
 * Pure: the sun above the horizon on `date` (`month` 0-based) every `step` minutes of the local clock day, with the sunrise and
 * the sunset (where the altitude crosses `SUN_UP_ALTITUDE`) refined by bisection and added as ends. Ascending minutes.
 */
export function sunPathSamples(date: CalendarDate, sunAt: SunPositionFn, step: number = SUN_PATH.step): SunPathSample[] {
  if (!(step > 0)) throw new RangeError(`sunPath: step must be positive: ${step}`);
  const up = (m: number) => sunAt(date, m).altitude > SUN_UP_ALTITUDE;
  const at = (m: number, hour = false): SunPathSample => { const p = sunAt(date, m); return { minute: m, azimuth: p.azimuth, altitude: p.altitude, hour }; };
  const cross = (a: number, b: number) => {
    // a and b differ in `up`; bisect to a minute
    const ua = up(a);
    for (let i = 0; i < 30; i++) { const mid = (a + b) / 2; if (up(mid) === ua) a = mid; else b = mid; }
    return (a + b) / 2;
  };
  const out: SunPathSample[] = [];
  let prev: number | null = null;
  for (let m = 0; m <= 1440 + 1e-9; m += step) {
    const isUp = up(m);
    if (prev !== null && isUp !== up(prev)) {
      const c = cross(prev, m);
      const p = at(c);
      out.push({ ...p, altitude: Math.max(p.altitude, SUN_UP_ALTITUDE) });
    }
    if (isUp) out.push(at(m, Math.abs(m / 60 - Math.round(m / 60)) < 1e-9));
    prev = m;
  }
  return out;
}

/** Pure: a sun direction (true azimuth and altitude, degrees) at `radius` around `centre` (scene frame), as the light points. */
export function arcPoint(centre: Readonly<Vec3>, radius: number, azimuthTrue: number, altitude: number, bearingDeg: number): Vec3 {
  const d = sunDirectionScene(azimuthTrue, altitude, bearingDeg);
  return [centre[0] + d[0] * radius, centre[1] + d[1] * radius, centre[2] + d[2] * radius];
}

/** Pure: the sample nearest to a minute (by time), or null for an empty arc. */
export function sampleAt(samples: readonly SunPathSample[], minute: number): SunPathSample | null {
  let best: SunPathSample | null = null, d = Infinity;
  for (const s of samples) { const e = Math.abs(s.minute - minute); if (e < d) { d = e; best = s; } }
  return best;
}

/** Pure: the index of the screen point nearest to `p` (pixels), or -1. */
export function nearestOnScreen(points: readonly (readonly [number, number])[], p: readonly [number, number]): number {
  let best = -1, d = Infinity;
  points.forEach((q, i) => { const e = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (e < d) { d = e; best = i; } });
  return best;
}

export interface SunPathOptions {
  /** The house context (place, bearing). */
  ctx: HouseContext;
  /** Day and minute (local clock) to start with. */
  date: CalendarDate;
  minute: number;
  /** Centre of the arc (house frame) and its radius (m). Default: the viewer's extent centre and `SUN_PATH.radiusShare` of its radius. */
  centre?: readonly [number, number, number];
  radius?: number;
  /** Sun position; default `calc/sun` for `placeOf(ctx.house)`, as the sun analysis. */
  sunPosition?: SunPositionFn;
  /** Text of an hour tick label (e.g. the page's `f.clock(hour)`); without it, or without the viewer's label layer, no labels. */
  formatHour?: (hour: number) => string;
  /** Drawn from the start (default true). */
  visible?: boolean;
}

export interface SunPath {
  readonly group: THREE.Group;
  /** The samples of the current day. */
  readonly samples: readonly SunPathSample[];
  readonly minute: number;
  /** A new day: the arc is sampled again. */
  setDay(date: CalendarDate): void;
  /** Moves the disc (hidden while the sun is down) and the travelled part of the arc. */
  setMinute(minute: number): void;
  /** Called with the minute while the disc is dragged. Returns the unsubscribe function. */
  onDrag(cb: (minute: number) => void): () => void;
  /** Hide it (top view, interior views). */
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Builds the sun path into `viewer.scene` and returns its controller. */
export function addSunPath(viewer: Viewer, opts: SunPathOptions): SunPath {
  const { ctx } = opts;
  const place = placeOf(ctx.house);
  const sunAt: SunPositionFn = opts.sunPosition ?? ((date, minute) => calcSunPosition(localToUtc(place.tz, date, minute / 60), place));
  const ext = viewer.extent;
  const centre: Vec3 = toScene(opts.centre ? [opts.centre[0], opts.centre[1], opts.centre[2]] : [ext.center[0], ext.center[1], ext.center[2]]);
  const radius = opts.radius ?? ext.radius * SUN_PATH.radiusShare;

  const group = new THREE.Group();
  group.name = "sun_path";
  group.visible = opts.visible !== false;
  const colorOf = (token: string, fallback: string) => { const c = new THREE.Color(); try { c.set(readToken(token, fallback)); } catch { c.set(fallback); } return c; };
  const white = colorOf("--sun-disc", "#fbfaf5"), mint = colorOf("--mint", "#5fd6ae");

  const dotGeo = new THREE.IcosahedronGeometry(1, 1);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: SUN_PATH.restOpacity, fog: false });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, SUN_PATH.maxSamples);
  dots.name = "sun_path_dots";
  dots.frustumCulled = false;
  dots.raycast = () => undefined;
  const discGeo = new THREE.SphereGeometry(1, 24, 16);
  const discMat = new THREE.MeshBasicMaterial({ color: white, toneMapped: false, fog: false });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.name = "sun_path_disc";
  disc.scale.setScalar(radius * SUN_PATH.disc);
  const haloMat = new THREE.MeshBasicMaterial({ color: mint, toneMapped: false, transparent: true, opacity: SUN_PATH.haloOpacity, depthWrite: false, fog: false });
  const halo = new THREE.Mesh(discGeo, haloMat);
  halo.name = "sun_path_halo";
  halo.scale.setScalar(SUN_PATH.halo);
  halo.raycast = () => undefined;
  disc.add(halo);
  group.add(dots, disc);
  for (const o of [dots, disc, halo]) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 5; }
  viewer.scene.add(group);

  const labelsOn = !!(opts.formatHour && viewer.labels);
  const labels: CSS2DObject[] = [];

  let samples: SunPathSample[] = [];
  let points: Vec3[] = [];
  let minute = opts.minute;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();

  function paintDots() {
    samples.forEach((s, i) => dots.setColorAt(i, s.minute <= minute ? mint : white));
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
  }

  function setDay(date: CalendarDate) {
    samples = sunPathSamples(date, sunAt).slice(0, SUN_PATH.maxSamples);
    points = samples.map((s) => arcPoint(centre, radius, s.azimuth, s.altitude, ctx.bearingDeg));
    samples.forEach((s, i) => {
      const r = radius * (s.hour ? SUN_PATH.tick : SUN_PATH.dot);
      dots.setMatrixAt(i, M.compose(P.set(...points[i]), Q, S.set(r, r, r)));
    });
    dots.count = samples.length;
    dots.instanceMatrix.needsUpdate = true;
    for (const l of labels) { l.removeFromParent(); l.element.remove(); }
    labels.length = 0;
    if (labelsOn) {
      samples.forEach((s) => {
        if (!s.hour) return;
        const el = document.createElement("div");
        el.className = "sun-tick";
        el.textContent = opts.formatHour!(Math.round(s.minute / 60));
        el.setAttribute("aria-hidden", "true");
        const label = new CSS2DObject(el);
        // a little outside the arc, so the text does not sit on the dot
        label.position.set(...arcPoint(centre, radius * 1.06, s.azimuth, s.altitude, ctx.bearingDeg));
        group.add(label);
        labels.push(label);
      });
    }
    setMinute(minute);
  }

  function setMinute(m: number) {
    minute = m;
    const s = sunAt(currentDate, m);
    const up = s.altitude > SUN_UP_ALTITUDE && samples.length > 0;
    disc.visible = up;
    if (up) disc.position.set(...arcPoint(centre, radius, s.azimuth, s.altitude, ctx.bearingDeg));
    paintDots();
    viewer.requestRender({ shadows: false });
  }

  // ---- dragging the disc
  const listeners = new Set<(minute: number) => void>();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canvas = viewer.renderer.domElement;
  let dragging: number | null = null;
  const toNdc = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return r;
  };
  const onDown = (e: PointerEvent) => {
    if (!group.visible || !disc.visible || e.button > 0) return;
    toNdc(e);
    ray.setFromCamera(ndc, viewer.camera);
    // a generous target for a finger: the halo counts
    const hit = ray.ray.distanceToPoint(disc.position) <= disc.scale.x * SUN_PATH.halo * 1.2;
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    dragging = e.pointerId;
    viewer.controls.enabled = false;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (dragging !== e.pointerId || !samples.length) return;
    e.stopPropagation();
    const r = toNdc(e);
    const v = new THREE.Vector3();
    const screen = points.map((p): [number, number] => {
      v.set(...p).project(viewer.camera);
      return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
    });
    const i = nearestOnScreen(screen, [e.clientX - r.left, e.clientY - r.top]);
    if (i < 0) return;
    const m = Math.round(samples[i].minute);
    if (m === minute) return;
    setMinute(m);
    for (const cb of listeners) cb(m);
  };
  const onUp = (e: PointerEvent) => {
    if (dragging !== e.pointerId) return;
    dragging = null;
    viewer.controls.enabled = true;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  // capture phase on the container: the disc wins over the orbit controls, which listen on the canvas
  const host = viewer.container;
  host.addEventListener("pointerdown", onDown, { capture: true });
  host.addEventListener("pointermove", onMove, { capture: true });
  host.addEventListener("pointerup", onUp, { capture: true });
  host.addEventListener("pointercancel", onUp, { capture: true });

  let currentDate: CalendarDate = { ...opts.date };
  setDay(currentDate);

  return {
    group,
    get samples() { return samples; },
    get minute() { return minute; },
    setDay(date) { currentDate = { ...date }; setDay(currentDate); },
    setMinute,
    onDrag(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    setVisible(v) { group.visible = v; viewer.requestRender({ shadows: false }); },
    dispose() {
      host.removeEventListener("pointerdown", onDown, { capture: true });
      host.removeEventListener("pointermove", onMove, { capture: true });
      host.removeEventListener("pointerup", onUp, { capture: true });
      host.removeEventListener("pointercancel", onUp, { capture: true });
      if (dragging !== null) viewer.controls.enabled = true;
      listeners.clear();
      for (const l of labels) { l.removeFromParent(); l.element.remove(); }
      labels.length = 0;
      dots.dispose();
      dotGeo.dispose(); discGeo.dispose();
      dotMat.dispose(); discMat.dispose(); haloMat.dispose();
      group.removeFromParent();
      group.clear();
      viewer.requestRender({ shadows: false });
    },
  };
}
