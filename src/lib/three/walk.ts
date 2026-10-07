// Walk mode at eye height: WASD / arrows and a drag to look on desktop, an on-screen joystick and a drag on touch screens.
// Collision and the start pose are in walkCollision.ts (pure); this module is the controller: input, camera, joystick DOM.
//
//  * Keys work only while the stage container has focus (the container gets tabindex -1 and takes focus on start and on
//    every pointer down, because Safari does not focus a clicked button), never while a form field has focus, never with
//    modifiers. Escape ends the walk when the target is the body or inside the container. A blur clears all pressed keys.
//  * Looking: a pointer drag on the canvas. One pointer at a time, tracked by `pointerId`; a second finger on the canvas is
//    ignored. The joystick has its own pointer id, so one finger can walk while another looks.
//  * Movement: forward / sideways input is normalised (a diagonal is not faster), speed `WALK.speed` (`WALK.run` with Shift),
//    converted from camera yaw to the house frame, then `move()` with sub-steps. Floor height: inside the building outline 0,
//    else `ctx.site.terrain.groundAt`. Eye height `WALK.eyeHeight`, field of view `WALK.fov`.
//  * The joystick is created for `(any-pointer: coarse)` devices (also hybrids), not by CSS `pointer: fine`.
//  * The camera, the orbit target and the field of view are restored on stop. Touch-action of the canvas is `none` while walking.
//  * Frame callbacks are paused off screen (viewer rule), so the walk pauses too.
import type { Pt } from "@/lib/model";
import { loadFootprints } from "./glb";
import type { HouseScene } from "./house";
import type { Viewer } from "./viewer";
import { WALK, buildWalkColliders, collidersAt, move, slide, walkStart, type WalkColliders, type WalkStart } from "./walkCollision";

/** Size of the on-screen joystick knob travel in CSS px (the pad itself is sized by stage.css). */
const JOY_TRAVEL = 36;

export interface WalkLabels {
  /** Accessible name of the joystick (translated by the page). */
  joystick: string;
}

export interface WalkOptions {
  labels: WalkLabels;
  /** Start pose. Default: `walkStart(ctx)`. */
  start?: WalkStart;
  /** Called once when the walk ended (Escape, `stop()`, context loss). */
  onExit: () => void;
  /** Follow the furniture switch of the house scene (default true): boxes collide only while furniture is shown and loaded. */
  followFurniture?: boolean;
}

export interface WalkController {
  /** Ends the walk and restores the camera. Idempotent. */
  stop(): void;
  /** Puts the walker at a house-frame point (pushed out of obstacles). */
  teleport(position: Pt): void;
  /** Current house-frame position and the house azimuth of the view direction. */
  readonly position: Pt;
  readonly yawDeg: number;
}

/** Is a point inside a ring (even-odd rule)? */
const inRing = (p: Pt, ring: readonly Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/**
 * Starts the walk in `container` (the element that holds the canvas). Loads the furniture footprints when furniture is on
 * (walls work at once). Throws nothing; failures to load footprints only mean no furniture colliders.
 */
export function startWalk(viewer: Viewer, house: HouseScene, container: HTMLElement, opts: WalkOptions): WalkController {
  const { ctx } = house;
  const cam = viewer.camera;
  const canvas = viewer.renderer.domElement;
  const start = opts.start ?? walkStart(ctx);
  const outline = ctx.derived.outline.polygons[0]?.pts ?? [];
  const follow = opts.followFurniture !== false;

  let stopped = false;
  let colliders: WalkColliders = buildWalkColliders(ctx);
  const abort = new AbortController();
  loadFootprints({ signal: abort.signal })
    .then((fp) => { if (!stopped) colliders = buildWalkColliders(ctx, fp); })
    .catch(() => undefined);
  const segsAt = (q: Pt) => collidersAt(colliders, follow ? house.furniture && house.furnitureState === "ready" : false, q);

  const saved = { pos: cam.position.clone(), target: viewer.controls.target.clone(), fov: cam.fov };
  viewer.controls.enabled = false;
  cam.fov = WALK.fov;
  cam.updateProjectionMatrix();
  cam.rotation.order = "YXZ";

  let p: Pt = slide([start.position[0], start.position[1]], segsAt(start.position));
  // house azimuth of the view direction (radians, clockwise from +y) and pitch (positive looks up)
  let yaw = (start.yawDeg * Math.PI) / 180, pitch = -0.05;
  const keys = new Set<string>();
  let shift = false;
  let joy: [number, number] = [0, 0];

  const floorAt = (q: Pt): number => (inRing(q, outline) ? 0 : ctx.site.terrain.groundAt(q[0], q[1]));
  function place() {
    // house (x, y, z) -> scene (x, z, -y); the camera looks along -Z, so a house azimuth `a` is a rotation of -a about +Y
    cam.position.set(p[0], floorAt(p) + WALK.eyeHeight, -p[1]);
    cam.rotation.set(pitch, -yaw, 0);
    viewer.requestRender({ shadows: false });
  }
  place();
  container.dataset.walking = "";

  const offFrame = viewer.onFrame((dt) => {
    let f = 0, s = 0, turn = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyA")) s -= 1;
    if (keys.has("KeyD")) s += 1;
    if (keys.has("ArrowLeft")) turn -= 1;
    if (keys.has("ArrowRight")) turn += 1;
    f += -joy[1]; s += joy[0];
    if (!f && !s && !turn) return false;
    yaw += turn * WALK.turnRate * dt;
    // a diagonal is not faster than straight ahead
    const mag = Math.hypot(f, s);
    if (mag > 1) { f /= mag; s /= mag; }
    const speed = (shift ? WALK.run : WALK.speed) * dt;
    const fx = Math.sin(yaw), fy = Math.cos(yaw), rx = Math.cos(yaw), ry = -Math.sin(yaw);
    p = move(p, [(fx * f + rx * s) * speed, (fy * f + ry * s) * speed], segsAt);
    place();
    return true;
  });

  // keys walk only while the stage has focus (the walk button sits inside it, a click on the view focuses it),
  // so arrows keep working in sliders and fields and still scroll the page elsewhere
  const prevTabIndex = container.getAttribute("tabindex");
  if (prevTabIndex === null) container.tabIndex = -1;
  const focusStage = () => { if (!container.contains(document.activeElement)) container.focus({ preventScroll: true }); };
  const isField = (t: HTMLElement) => !!t.closest?.("input, select, textarea, [contenteditable]:not([contenteditable='false'])");
  focusStage(); // Safari does not focus a clicked button, so focus stays outside the stage: take it now

  let dragId: number | null = null;
  let drag: [number, number] = [0, 0];
  const pd = (e: PointerEvent) => {
    focusStage();
    if (dragId !== null) return; // one finger looks; a second one is ignored
    dragId = e.pointerId;
    drag = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
  };
  const pm = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    yaw += (e.clientX - drag[0]) * WALK.lookYaw;
    pitch = Math.max(-WALK.maxPitch, Math.min(WALK.maxPitch, pitch - (e.clientY - drag[1]) * WALK.lookPitch));
    drag = [e.clientX, e.clientY];
    place();
  };
  const pu = (e: PointerEvent) => { if (e.pointerId === dragId) dragId = null; };
  const KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const kd = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t || isField(t) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === "Escape" && (t === document.body || container.contains(t))) { stop(); return; }
    if (container.contains(t) && KEYS.includes(e.code)) { keys.add(e.code); shift = e.shiftKey; e.preventDefault(); }
  };
  const ku = (e: KeyboardEvent) => { keys.delete(e.code); shift = e.shiftKey; };
  const clear = () => { keys.clear(); shift = false; }; // a key released while focus is elsewhere must not keep walking
  canvas.addEventListener("pointerdown", pd);
  canvas.addEventListener("pointermove", pm);
  canvas.addEventListener("pointerup", pu);
  canvas.addEventListener("pointercancel", pu);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("blur", clear);
  container.addEventListener("focusout", clear);
  const prevTouch = canvas.style.touchAction;
  canvas.style.touchAction = "none";

  // joystick for every device that has a touch screen, also hybrids
  let pad: HTMLDivElement | null = null;
  if (typeof matchMedia === "function" && matchMedia("(any-pointer: coarse)").matches) {
    const el = document.createElement("div");
    el.className = "joy";
    el.setAttribute("role", "application");
    el.setAttribute("aria-label", opts.labels.joystick);
    const knob = document.createElement("i");
    el.append(knob);
    container.append(el);
    pad = el;
    let id: number | null = null;
    const jmove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      joy = [x, y];
      knob.style.transform = `translate(${x * JOY_TRAVEL}px, ${y * JOY_TRAVEL}px)`;
    };
    el.addEventListener("pointerdown", (e) => { if (id !== null) return; id = e.pointerId; el.setPointerCapture(id); jmove(e); e.stopPropagation(); });
    el.addEventListener("pointermove", (e) => { if (e.pointerId === id) jmove(e); });
    const jup = (e: PointerEvent) => { if (e.pointerId !== id) return; id = null; joy = [0, 0]; knob.style.transform = ""; };
    el.addEventListener("pointerup", jup);
    el.addEventListener("pointercancel", jup);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    abort.abort();
    offFrame();
    canvas.removeEventListener("pointerdown", pd);
    canvas.removeEventListener("pointermove", pm);
    canvas.removeEventListener("pointerup", pu);
    canvas.removeEventListener("pointercancel", pu);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
    window.removeEventListener("blur", clear);
    container.removeEventListener("focusout", clear);
    if (prevTabIndex === null) container.removeAttribute("tabindex");
    pad?.remove();
    delete container.dataset.walking;
    canvas.style.touchAction = prevTouch;
    cam.rotation.order = "XYZ";
    cam.fov = saved.fov;
    cam.updateProjectionMatrix();
    cam.position.copy(saved.pos);
    viewer.controls.target.copy(saved.target);
    viewer.controls.enabled = true;
    viewer.controls.update();
    viewer.requestRender();
    opts.onExit();
  }

  return {
    stop,
    teleport(q) { p = slide([q[0], q[1]], segsAt(q)); place(); },
    get position() { return p; },
    get yawDeg() { return ((yaw * 180) / Math.PI % 360 + 360) % 360; },
  };
}

