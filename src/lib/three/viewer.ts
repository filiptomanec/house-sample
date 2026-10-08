// The viewer: one WebGL renderer, camera, lights, sky and the render-on-demand loop shared by the Model and Sun pages.
// Specification: docs/THREE-API.md section 4. Phones get the "low" tier (smaller shadow map, MSAA instead of
// post-processing, lighter assets); a frame is drawn only when something changed; the shadow map is redrawn only when
// something that casts shadows changed; the context is released on dispose and its loss is reported.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import type { N8AOPass } from "n8ao";
import { headingTrue, sunDirectionHouse, sunDirectionScene, toScene, type Vec3 } from "./frame";
import { createInteriorFill, type InteriorFill } from "./interior";
import { MIN_DOME_LUMINANCE, bakeEnvironment, gradientTexture, groundBounce, inverseNeutralToneMapping, liftToLuminance } from "./sky";
import { easeInOut, orbitOffset, zoomOffset } from "./orbit";
import { onSchemeChange, prefersReducedMotion, readToken } from "./theme";
import { TIER_SETTINGS, detectTier, type Tier, type TierSettings } from "./tier";
import { orbitLimitsFor, shadowRangeFor, type OrbitLimits, type ResolvedView, type SceneExtent } from "./views";

export { TIER_SETTINGS, detectTier, type Tier, type TierSettings };

/** Thrown by `createViewer` when the browser cannot create a WebGL2 context. The UI shows a message instead of the scene. */
export class WebGlUnavailableError extends Error {
  constructor(message = "WebGL is not available") {
    super(message);
    this.name = "WebGlUnavailableError";
  }
}

export { isWebGlAvailable } from "./webgl";

export interface ViewerOptions {
  /** Default: `detectTier()`. */
  tier?: Tier;
  /** True azimuth of the house +y axis, degrees (`ctx.bearingDeg`). The scene itself is not rotated. */
  bearingDeg: number;
  /** What the camera may look at (`sceneExtent(ctx, ...)`): orbit limits and the shadow range follow from it. */
  extent: SceneExtent;
  /** First camera. Default: the first of `webViews(house.cameras)` passed by the page; the viewer has no built-in pose. */
  initialView?: ResolvedView;
  /** Half-width of the shadow frustum, metres. Default: `shadowRangeFor(extent)`. */
  shadowRange?: number;
  /** `"stage"`: flat `--stage-bg` behind the scene (Model). `"sky"`: gradient `--sky-top` to `--sky-bottom` (Sun). Both follow the colour scheme. */
  backdrop?: "stage" | "sky";
  /** Add a CSS2D layer for room tags (`viewer.labels`). */
  labels?: boolean;
  /** Arrow keys orbit, `+` and `-` zoom while the container has focus. Default true. */
  keyboard?: boolean;
  /** Duration of camera transitions, ms (default 600). 0, or `prefers-reduced-motion`, jumps. */
  transitionMs?: number;
  /** Accessible name of the canvas (a translated string from the page). */
  ariaLabel?: string;
  /** WebGL context lost (`true`) or restored (`false`). The engine has already prevented the default so the browser may restore it. */
  onContextLost?: (lost: boolean) => void;
  /** Colour of the lawn (`style.materials.lawn.color`): the light bounced up from the ground is derived from it. Extension of the first draft. */
  groundColor?: string;
}

export interface SunState {
  /** True azimuth (clockwise from true north) and altitude, degrees. */
  azimuthTrue: number;
  altitude: number;
}

export interface Viewer {
  readonly tier: Tier;
  readonly settings: TierSettings;
  /** The element the canvas was added to. */
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** CSS2D layer for room tags, when `labels` was requested. */
  readonly labels: CSS2DRenderer | null;
  /** The interior light of the rooms (patches materials; see interior.ts). One per viewer. */
  readonly interior: InteriorFill;
  readonly bearingDeg: number;
  readonly extent: SceneExtent;
  readonly sun: Readonly<SunState>;
  readonly contextLost: boolean;
  /** Resolves when the environment lighting is ready (the first frame is drawn without it). Never rejects. */
  readonly ready: Promise<void>;

  /** Sets the sun from the true azimuth and altitude (degrees): light, colour, shadow, interior fill, environment strength. Marks the shadows dirty. */
  setSun(azimuthTrueDeg: number, altitudeDeg: number): void;
  /** Draws on the next frame. `{ shadows: false }`: only the camera moved, keep the shadow map. */
  requestRender(opts?: { shadows?: boolean }): void;
  /** Per-frame callback (dt in seconds, at most 0.1). Return `true` to ask for a redraw. Not called while off screen or hidden. Returns the unsubscribe function. */
  onFrame(cb: (dt: number) => boolean | void): () => void;
  /** Left drag / one finger rotates (default) or pans; the other gesture stays available on the other button / two fingers. */
  setPanMode(pan: boolean): void;
  /** Moves the camera to a view; resolves when the transition ends (immediately without animation). A newer call cancels the older. */
  setView(view: ResolvedView, opts?: { animate?: boolean }): Promise<void>;
  setLimits(limits: OrbitLimits): void;
  /** True heading of the camera (degrees clockwise from true north). */
  heading(): number;
  /** Calls back when the heading changed by more than `thresholdDeg` (default 0.5), at most once per frame. Returns the unsubscribe function. */
  onHeading(cb: (headingDeg: number) => void, thresholdDeg?: number): () => void;
  /** Re-reads the colour tokens (backdrop, fog, environment). Called automatically when the colour scheme changes. */
  refreshTheme(): void;
  /** Fog from `near` to `far` metres in the colour of the backdrop (the scene fades into it past the edge of the ground). */
  setFog(near: number, far: number): void;
  /** One rendered frame as a PNG (renders and reads in the same task; the drawing buffer is not preserved). */
  snapshot(): Promise<Blob | null>;
  /** Stops the loop, removes observers and listeners, disposes composer, environment and renderer, forces the context loss and removes the canvas. Idempotent. */
  dispose(): void;
}

// ------------------------------------------------------------------------------------------------ tuning

/** Ambient occlusion outdoors and in the rooms (a short radius indoors, eased in between). */
const AO_OUT = { radius: 1.6, intensity: 2.2 } as const;
const AO_IN = { radius: 0.7, intensity: 1.8 } as const;
/** Keyboard steps. */
const KEY = { orbitDeg: 5, zoom: 0.1 } as const;
/** Sun light: starting values of the earlier engine, tuned against the renders. */
const SUN_LIGHT = { distance: 150, intensity: 5.2 } as const;
/** Camera clip planes. */
const CLIP = { near: 0.1, far: 1500 } as const;
const DEFAULT_FOV = 40;

const smooth = THREE.MathUtils.smoothstep;
const DEG = Math.PI / 180;

const colorOf = (token: string, fallback: string): THREE.Color => {
  const c = new THREE.Color();
  try { c.set(readToken(token, fallback)); } catch { c.set(fallback); }
  return c;
};

interface Tween {
  fromPos: THREE.Vector3; toPos: THREE.Vector3;
  fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  fromFov: number; toFov: number;
  t: number; duration: number;
  done: () => void;
}

/**
 * Creates the renderer in `container` (a positioned element with a size; the canvas gets class `gl`, the label layer
 * `gl-labels`). Throws `WebGlUnavailableError` without WebGL. Only one viewer per container.
 */
export function createViewer(container: HTMLElement, opts: ViewerOptions): Viewer {
  const tier = opts.tier ?? detectTier();
  const settings = TIER_SETTINGS[tier];
  const backdrop = opts.backdrop ?? "stage";
  const { extent, bearingDeg } = opts;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: settings.msaa, alpha: false, powerPreference: tier === "low" ? "default" : "high-performance", preserveDrawingBuffer: false });
  } catch (e) {
    throw new WebGlUnavailableError(e instanceof Error ? e.message : undefined);
  }
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new WebGlUnavailableError("WebGL 2 is required");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // the shadow map is redrawn only when something that casts or receives shadows changes (requestRender without
  // { shadows: false }, setSun, a restored context), not for camera moves
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.className = "gl";
  canvas.setAttribute("role", "img");
  if (opts.ariaLabel) canvas.setAttribute("aria-label", opts.ariaLabel);
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
  container.append(canvas);

  const labels = opts.labels ? new CSS2DRenderer() : null;
  if (labels) {
    labels.domElement.className = "gl-labels";
    Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
    labels.domElement.setAttribute("aria-hidden", "true");
    container.append(labels.domElement);
  }

  const interior = createInteriorFill();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.initialView?.fov ?? DEFAULT_FOV, 1, CLIP.near, CLIP.far);

  // ------------------------------------------------------------------ camera and controls
  const reduceMotion = () => prefersReducedMotion();
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduceMotion();
  controls.dampingFactor = 0.08;
  // panning moves over the ground (not the screen plane), so from above the scene slides like a map
  controls.screenSpacePanning = false;
  let limits = orbitLimitsFor(extent);
  const applyLimits = (l: OrbitLimits) => {
    limits = l;
    controls.minDistance = l.minDistance;
    controls.maxDistance = l.maxDistance;
    controls.maxPolarAngle = l.maxPolarAngle;
  };
  applyLimits(limits);

  const centerScene = new THREE.Vector3(...toScene(extent.center));
  const placeCamera = (position: Vec3, target: Vec3, fov: number) => {
    camera.position.set(...position);
    controls.target.set(...target);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.update();
  };
  const initialView: ResolvedView = opts.initialView ?? {
    id: "default", name: { cs: "", en: "" }, ortho: false, fov: DEFAULT_FOV,
    target: [centerScene.x, centerScene.y, centerScene.z],
    position: [centerScene.x + extent.radius * 1.4, extent.radius * 0.9, centerScene.z + extent.radius * 1.4],
  };
  placeCamera(initialView.position, initialView.target, initialView.fov);

  // ------------------------------------------------------------------ light and sky
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, SUN_LIGHT.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
  const R = opts.shadowRange ?? shadowRangeFor(extent);
  Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: SUN_LIGHT.distance + R * 2 + extent.top });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  sun.target.position.copy(centerScene);
  scene.add(sun, sun.target);

  const state: SunState = { azimuthTrue: 180, altitude: 35 };
  let day = 1;
  let bgTexture: THREE.Texture | null = null;
  const groundHex = opts.groundColor ?? "#6f8f4a";
  let pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget: THREE.WebGLRenderTarget | null = null;

  let needs = true;
  let alive = true;
  let visible = true;
  let lost = false;
  let raf = 0;
  /** The composer's output pass tone-maps the whole frame, backdrop and fog included (without it the backdrop is not tone-mapped). */
  let outputPass = false;

  function bakeSky(afterRestore = false) {
    // after a context restore the old generator and target belong to the lost context: they are dropped, not disposed
    // (disposing would try to delete objects of the old context and the browser warns about each one)
    if (afterRestore) { pmrem = new THREE.PMREMGenerator(renderer); envTarget = null; }
    const top = liftToLuminance(palette.top, MIN_DOME_LUMINANCE);
    const horizon = liftToLuminance(palette.bottom, MIN_DOME_LUMINANCE);
    const ground = groundBounce(new THREE.Color(groundHex));
    envTarget?.dispose();
    envTarget = bakeEnvironment(pmrem, { top, horizon, ground });
    scene.environment = envTarget.texture;
    hemi.color.copy(top).lerp(horizon, 0.5);
    hemi.groundColor.copy(ground);
  }

  // the backdrop colours come from the tokens; they are read when the scheme changes, not on every sun move
  const readPalette = () => ({ top: colorOf("--sky-top", "#a9c7de"), bottom: colorOf("--sky-bottom", "#e1ecf1"), stage: colorOf("--stage-bg", "#cfdce4") });
  let palette = readPalette();
  /** A palette colour as the scene must hold it for the screen to show that colour (dark slate would come out darker and bluer). */
  const framed = (c: THREE.Color) => (outputPass ? inverseNeutralToneMapping(c) : c.clone());
  /** Builds the background from the palette: a flat colour (stage) or a gradient texture (sky). */
  function paintBackdrop() {
    bgTexture?.dispose();
    bgTexture = null;
    if (backdrop === "sky") {
      bgTexture = gradientTexture(framed(palette.top), framed(palette.bottom));
      scene.background = bgTexture;
    } else {
      scene.background = palette.stage.clone();
    }
    shadeBackdrop();
  }
  /** Night darkens the backdrop and the fog with it. */
  function shadeBackdrop() {
    const shade = 0.25 + 0.75 * day;
    const horizon = backdrop === "sky" ? palette.bottom : palette.stage;
    if (backdrop === "sky") scene.backgroundIntensity = shade;
    else (scene.background as THREE.Color).copy(framed(palette.stage)).multiplyScalar(shade);
    if (scene.fog) scene.fog.color.copy(framed(horizon)).multiplyScalar(shade);
  }
  const fogDefault = { near: extent.radius * 2.5, far: extent.radius * 8 };
  scene.fog = new THREE.Fog(0xffffff, fogDefault.near, fogDefault.far);

  function setSun(azimuthTrueDeg: number, altitudeDeg: number) {
    state.azimuthTrue = azimuthTrueDeg;
    state.altitude = altitudeDeg;
    const v = sunDirectionScene(azimuthTrueDeg, altitudeDeg, bearingDeg);
    sun.position.set(v[0], v[1], v[2]).multiplyScalar(SUN_LIGHT.distance).add(sun.target.position);
    const k = THREE.MathUtils.clamp(altitudeDeg / 14, 0, 1);
    const d = smooth(altitudeDeg, -8, 20);
    day = d;
    sun.intensity = SUN_LIGHT.intensity * smooth(altitudeDeg, -1, 6);
    sun.color.setRGB(1, 0.72 + 0.25 * k, 0.5 + 0.42 * k);
    hemi.intensity = 0.05 + 0.12 * d;
    scene.environmentIntensity = 0.12 + 0.43 * d;
    shadeBackdrop();
    const h = sunDirectionHouse(azimuthTrueDeg, altitudeDeg, bearingDeg);
    interior.setDaylight(altitudeDeg, [h[0], h[1]]);
    needs = true;
    renderer.shadowMap.needsUpdate = true;
  }

  paintBackdrop();
  setSun(state.azimuthTrue, state.altitude);

  // ------------------------------------------------------------------ post-processing (high tier only, loaded on demand)
  let composer: EffectComposer | null = null;
  let smaa: SMAAPass | null = null;
  let ao: N8AOPass | null = null;
  const postReady: Promise<void> = settings.postprocessing
    ? Promise.all([import("three/addons/postprocessing/EffectComposer.js"), import("three/addons/postprocessing/SMAAPass.js"), import("three/addons/postprocessing/OutputPass.js"), import("n8ao")])
        .then(([c, s, o, n]) => {
          if (!alive) return;
          const comp = new c.EffectComposer(renderer);
          // N8AOPass renders the scene itself (autoRenderBeauty), so no RenderPass in front of it
          const pass = new n.N8AOPass(scene, camera, 1, 1);
          pass.configuration.aoRadius = AO_OUT.radius;
          pass.configuration.distanceFalloff = 0.8;
          pass.configuration.intensity = AO_OUT.intensity;
          pass.configuration.gammaCorrection = false;
          comp.addPass(pass);
          const aa = new s.SMAAPass(1, 1);
          comp.addPass(aa);
          comp.addPass(new o.OutputPass());
          composer = comp; ao = pass; smaa = aa;
          outputPass = true;
          paintBackdrop(); // the backdrop and the fog now pass through the tone mapper: repaint them compensated
          resize();
        })
        .catch((e: unknown) => { console.warn("post-processing is not available", e); })
    : Promise.resolve();

  // ------------------------------------------------------------------ size and visibility
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels?.setSize(w, h);
    if (composer && smaa && ao) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      smaa.setSize(w * pr, h * pr);
      ao.setSize(w * pr, h * pr);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needs = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) needs = true;
  }, { rootMargin: "100px" });
  io.observe(container);
  const onVisibility = () => { if (!document.hidden) needs = true; };
  document.addEventListener("visibilitychange", onVisibility);
  const offScheme = onSchemeChange(() => refreshTheme());

  // ------------------------------------------------------------------ tween and keyboard
  let tween: Tween | null = null;
  const finishTween = () => { const t = tween; tween = null; t?.done(); };
  controls.addEventListener("start", finishTween);
  controls.addEventListener("change", () => {
    // the target stays over the ground the scene covers, so the house cannot get lost off screen
    const t = controls.target;
    const cx = THREE.MathUtils.clamp(t.x, limits.targetMin[0], limits.targetMax[0]);
    const cy = THREE.MathUtils.clamp(t.y, limits.targetMin[1], limits.targetMax[1]);
    const cz = THREE.MathUtils.clamp(t.z, limits.targetMin[2], limits.targetMax[2]);
    if (cx !== t.x || cy !== t.y || cz !== t.z) {
      const d = new THREE.Vector3(cx - t.x, cy - t.y, cz - t.z);
      t.add(d);
      camera.position.add(d);
    }
    needs = true;
  });

  const offsetV = new THREE.Vector3();
  const moveBy = (next: Vec3) => {
    camera.position.copy(controls.target).add(offsetV.set(...next));
    controls.update();
    needs = true;
  };
  const orbitBy = (dTheta: number, dPhi: number) =>
    moveBy(orbitOffset(offsetV.copy(camera.position).sub(controls.target).toArray(), dTheta, dPhi, controls.maxPolarAngle));
  const zoomBy = (factor: number) =>
    moveBy(zoomOffset(offsetV.copy(camera.position).sub(controls.target).toArray(), factor, controls.minDistance, controls.maxDistance));

  const hadTabIndex = container.hasAttribute("tabindex");
  const keyboardOn = opts.keyboard !== false;
  if (keyboardOn && !hadTabIndex) container.tabIndex = 0;
  const onKey = (e: KeyboardEvent) => {
    // only while the container itself has focus (a button inside it keeps its own keys) and not while walking
    if (!controls.enabled || e.target !== container || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = KEY.orbitDeg * DEG;
    switch (e.key) {
      case "ArrowLeft": orbitBy(-step, 0); break;
      case "ArrowRight": orbitBy(step, 0); break;
      case "ArrowUp": orbitBy(0, -step); break;
      case "ArrowDown": orbitBy(0, step); break;
      case "+": case "=": zoomBy(1 - KEY.zoom); break;
      case "-": case "_": zoomBy(1 + KEY.zoom); break;
      case "Home": void setView(initialView, { animate: true }); break;
      default: return;
    }
    e.preventDefault();
  };
  if (keyboardOn) container.addEventListener("keydown", onKey);

  function setView(view: ResolvedView, o: { animate?: boolean } = {}): Promise<void> {
    finishTween();
    const duration = (opts.transitionMs ?? 600) / 1000;
    const animate = (o.animate ?? true) && duration > 0 && !reduceMotion();
    if (!animate) {
      placeCamera(view.position, view.target, view.fov);
      needs = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      tween = {
        fromPos: camera.position.clone(), toPos: new THREE.Vector3(...view.position),
        fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(...view.target),
        fromFov: camera.fov, toFov: view.fov, t: 0, duration, done: resolve,
      };
    });
  }

  // ------------------------------------------------------------------ heading
  const dirV = new THREE.Vector3();
  function heading(): number {
    camera.getWorldDirection(dirV);
    // looking straight down there is no heading of the view direction: the "up" of the screen gives it
    if (Math.hypot(dirV.x, dirV.z) < 0.1) dirV.set(0, 1, 0).applyQuaternion(camera.quaternion);
    return headingTrue([dirV.x, dirV.y, dirV.z], bearingDeg);
  }
  const headingListeners = new Set<{ cb: (h: number) => void; threshold: number; last: number }>();
  const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  // ------------------------------------------------------------------ loop
  const frameCbs = new Set<(dt: number) => boolean | void>();
  let last = performance.now();
  let indoor = 0;
  function draw() {
    if (lost) return;
    if (composer) composer.render(); else renderer.render(scene, camera);
    labels?.render(scene, camera);
  }
  function loop(now: number) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden || lost) return;
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.duration);
      const k = easeInOut(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, k);
      camera.updateProjectionMatrix();
      if (tween.t >= 1) finishTween();
      needs = true;
    }
    if (controls.enabled && controls.update()) needs = true;
    for (const cb of frameCbs) if (cb(dt) === true) needs = true;
    if (ao) {
      const want = interior.contains(camera.position) ? 1 : 0;
      if (indoor !== want) {
        indoor = want > indoor ? Math.min(want, indoor + dt * 4) : Math.max(want, indoor - dt * 4);
        ao.configuration.aoRadius = THREE.MathUtils.lerp(AO_OUT.radius, AO_IN.radius, indoor);
        ao.configuration.intensity = THREE.MathUtils.lerp(AO_OUT.intensity, AO_IN.intensity, indoor);
        needs = true;
      }
    }
    if (needs) {
      draw();
      needs = false;
      if (headingListeners.size) {
        const h = heading();
        for (const l of headingListeners) if (Number.isNaN(l.last) || angleDiff(h, l.last) > l.threshold) { l.last = h; l.cb(h); }
      }
    }
  }
  raf = requestAnimationFrame(loop);

  // ------------------------------------------------------------------ context loss
  const onLost = (e: Event) => { e.preventDefault(); lost = true; opts.onContextLost?.(true); };
  const onRestored = () => {
    lost = false;
    // render targets lose their content with the context: the baked environment has to be made again
    try { bakeSky(true); } catch (err) { console.warn("sky could not be rebaked", err); }
    needs = true;
    renderer.shadowMap.needsUpdate = true;
    opts.onContextLost?.(false);
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  function refreshTheme() {
    if (!alive || lost) return;
    palette = readPalette();
    paintBackdrop();
    try { bakeSky(); } catch (err) { console.warn("sky could not be rebaked", err); }
    needs = true;
  }

  // the first frame is drawn without the environment; it follows in the next task
  const ready: Promise<void> = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (alive && !lost) {
        try { bakeSky(); } catch (err) { console.warn("sky could not be baked", err); }
        needs = true;
      }
      resolve();
    }, 0);
  }).then(() => postReady);

  let disposed = false;
  return {
    tier, settings, container, renderer, scene, camera, controls, labels, interior, bearingDeg, extent,
    get sun() { return state; },
    get contextLost() { return lost; },
    ready,
    setSun,
    requestRender(o) { needs = true; if (o?.shadows !== false) renderer.shadowMap.needsUpdate = true; },
    onFrame(cb) { frameCbs.add(cb); return () => { frameCbs.delete(cb); }; },
    setPanMode(pan) {
      controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = pan ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      controls.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
      controls.touches.TWO = pan ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;
    },
    setView,
    setLimits(l) { applyLimits(l); controls.update(); needs = true; },
    heading,
    onHeading(cb, thresholdDeg = 0.5) {
      const l = { cb, threshold: thresholdDeg, last: Number.NaN };
      headingListeners.add(l);
      needs = true;
      return () => { headingListeners.delete(l); };
    },
    refreshTheme,
    setFog(near, far) {
      const f = scene.fog as THREE.Fog;
      f.near = near;
      f.far = far;
      needs = true;
    },
    snapshot() {
      draw();
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      alive = false;
      cancelAnimationFrame(raf);
      finishTween();
      ro.disconnect();
      io.disconnect();
      offScheme();
      document.removeEventListener("visibilitychange", onVisibility);
      container.removeEventListener("keydown", onKey);
      if (keyboardOn && !hadTabIndex) container.removeAttribute("tabindex");
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      controls.dispose();
      headingListeners.clear();
      frameCbs.clear();
      interior.dispose();
      envTarget?.dispose();
      bgTexture?.dispose();
      pmrem.dispose();
      // the composer frees its own targets, the passes (ambient occlusion, SMAA, output) have theirs
      composer?.passes.forEach((pass) => pass.dispose?.());
      composer?.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      // iOS has few contexts; repeated navigation between the two 3D pages must not leak them (a context that is lost already
      // has no extension to ask, and three.js would warn)
      if (!lost) renderer.forceContextLoss();
      canvas.remove();
      labels?.domElement.remove();
    },
  };
}
