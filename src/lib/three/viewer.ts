// The viewer: one WebGL renderer, camera, lights, sky and the render-on-demand loop shared by the Model and Sun pages.
// Specification: docs/THREE-API.md section 4. Phones get the "low" tier (smaller shadow map, MSAA on the context instead of
// post-processing, lighter assets); a frame is drawn only when something changed; the shadow map is redrawn only when
// something that casts shadows changed; the context is released on dispose and its loss is reported.
//
// Light and sky: AgX tone mapping (as the Cycles renders) at `EXPOSURE`. The sky is a tone-mapped dome driven by the sun
// altitude (sky.ts): the same function is the backdrop and, baked into a PMREM environment, the image-based light, re-baked
// only when the sun moved by `REBAKE`. It never depends on the colour scheme of the page.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { N8AOPass } from "n8ao";
import { headingTrue, sunDirectionHouse, sunDirectionScene, toScene, type Vec3 } from "./frame";
import { INTERIOR_VIEW_EASE, INTERIOR_VIEW_OUTSIDE, createInteriorFill, type InteriorFill } from "./interior";
import {
  applySky, bakeEnvironment, createSkyDome, displayOf, luminanceOf, needsRebake, readSkyPalette, skyAt, skyLight, skyRadiance, skyUniforms,
  type SkyRadiance, type SkyState,
} from "./sky";
import { easeInOut, orbitOffset, zoomOffset } from "./orbit";
import { onSchemeChange, prefersReducedMotion, readToken } from "./theme";
import { TIER_SETTINGS, detectTier, type Tier, type TierSettings } from "./tier";
import { VIEW_REACH_MARGIN, fitView, orbitLimitsFor, shadowRangeFor, type FitContext, type FittedView, type OrbitLimits, type ResolvedView, type SceneExtent } from "./views";

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
  /** What the camera may look at (`sceneExtent(ctx, ...)`): orbit limits and the default shadow range follow from it. */
  extent: SceneExtent;
  /** First camera. Default: the first of the page's views passed by the page; the viewer has no built-in pose. Fitted to the stage aspect. */
  initialView?: ResolvedView;
  /** Half-width of the shadow frustum, metres. Default: `shadowRangeFor(extent)`; the house scene widens it to the site occluders. */
  shadowRange?: number;
  /**
   * The sun-driven sky dome behind the scene, the same in light and dark mode (the only backdrop since R2). `"stage"` is a
   * deprecated alias of `"sky"`: the flat `--stage-bg` followed the colour scheme (a night sky at noon in dark mode); it now
   * only paints the container until the canvas appears.
   */
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
  /** Colour of the lawn (`style.materials.lawn.color`): the light bounced up from the ground is derived from it. */
  groundColor?: string;
  /** What `fit` needs to move a camera back safely (`fitContextOf(ctx)`). The house scene sets it when the page does not. */
  fitContext?: FitContext;
}

export interface SunState {
  /** True azimuth (clockwise from true north) and altitude, degrees. */
  azimuthTrue: number;
  altitude: number;
}

/** Draw calls and triangles of the last frame drawn (all passes of the composer together). */
export interface FrameStats {
  calls: number;
  triangles: number;
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
  /** The sky at the current sun (display colours, glow, backdrop intensity). */
  readonly sky: Readonly<SkyState>;
  /** Tone-mapping exposure (AgX). */
  readonly exposure: number;
  /** Half-width of the sun's shadow frustum, metres. */
  readonly shadowRange: number;
  readonly contextLost: boolean;
  /** Resolves when the environment lighting is ready (the first frame is drawn without it). Never rejects. */
  readonly ready: Promise<void>;

  /** Sets the sun from the true azimuth and altitude (degrees): light, colour, shadow, sky, interior fill, environment. Marks the shadows dirty. */
  setSun(azimuthTrueDeg: number, altitudeDeg: number): void;
  /** Draws on the next frame. `{ shadows: false }`: only the camera moved, keep the shadow map. */
  requestRender(opts?: { shadows?: boolean }): void;
  /** Per-frame callback (dt in seconds, at most 0.1). Return `true` to ask for a redraw. Not called while off screen or hidden. Returns the unsubscribe function. */
  onFrame(cb: (dt: number) => boolean | void): () => void;
  /** Left drag / one finger rotates (default) or pans; the other gesture stays available on the other button / two fingers. */
  setPanMode(pan: boolean): void;
  /** Moves the camera to a view exactly as given; resolves when the transition ends (immediately without animation). A newer call cancels the older. */
  setView(view: ResolvedView, opts?: { animate?: boolean }): Promise<void>;
  /**
   * Moves the camera to a view fitted to a stage aspect (`fitView`; default: the current aspect of the canvas). While the camera
   * stays on this preset (no orbit, pan or zoom by the user), a resize fits it again. Widens the orbit limits when the fitted
   * camera stands further away than they allow.
   */
  fit(view: ResolvedView, aspect?: number, opts?: { animate?: boolean }): Promise<void>;
  /** The fitted view without moving the camera (`fitView` with the viewer's fit context). */
  fitted(view: ResolvedView, aspect?: number): FittedView;
  /** The fit context (set by the house scene from its `ctx`). */
  setFitContext(fc: FitContext): void;
  setLimits(limits: OrbitLimits): void;
  /** Half-width of the shadow frustum, metres (redraws the shadow map). */
  setShadowRange(range: number): void;
  /** True heading of the camera (degrees clockwise from true north). */
  heading(): number;
  /** Calls back when the heading changed by more than `thresholdDeg` (default 0.5), at most once per frame. Returns the unsubscribe function. */
  onHeading(cb: (headingDeg: number) => void, thresholdDeg?: number): () => void;
  /** Re-reads the sky tokens and re-bakes (the tokens are the same in both schemes; called when the scheme changes all the same). */
  refreshTheme(): void;
  /**
   * Linear fog in the colour of the horizon from `near` to `far` metres: aerial perspective that leaves the plot untouched
   * and dissolves the ground past the domain into the sky. (The high tier mixes it before the tone mapper, in radiance, where
   * the bright horizon weighs more: keep `near` beyond the plot.)
   */
  setFog(near: number, far: number): void;
  /** Draw calls and triangles of the last frame drawn. */
  stats(): FrameStats;
  /** One rendered frame as a PNG (renders and reads in the same task; the drawing buffer is not preserved). */
  snapshot(): Promise<Blob | null>;
  /** Stops the loop, removes observers and listeners, disposes composer, sky, environment and renderer, forces the context loss and removes the canvas. Idempotent. */
  dispose(): void;
}

// ------------------------------------------------------------------------------------------------ tuning

/** Tone-mapping exposure (AgX): the sunlit ivory plaster lands at L* 88-92 without clipping at a low winter sun. */
export const EXPOSURE = 1.15;
/** Ambient occlusion outdoors and in the rooms (a short radius indoors, eased in between). */
const AO_OUT = { radius: 1.6, intensity: 2.2 } as const;
const AO_IN = { radius: 0.7, intensity: 1.8 } as const;
/** Samples of the multisampled beauty target on the high tier (thin roof seams, slats and fence boards stay continuous). */
export const MSAA_SAMPLES = 4;
/** Keyboard steps. */
const KEY = { orbitDeg: 5, zoom: 0.1 } as const;
/** Sun light (irradiance of a surface square to the sun at full strength, three.js units) and its distance from the target. */
export const SUN_LIGHT = { distance: 150, intensity: 6.3 } as const;
/**
 * Image-based light: strength of the baked lighting dome (it holds the display colours of the sky, so a clear day's skylight
 * on a horizontal surface is about a sixth of the sun's).
 */
export const ENV_GAIN = 0.35;
/** A faint hemisphere light so a night scene stays legible (the dome is nearly black then). */
const HEMI = { night: 0.08, day: 0.04 } as const;
/** Camera clip planes. */
const CLIP = { near: 0.1, far: 1500 } as const;
const DEFAULT_FOV = 40;

const smooth = THREE.MathUtils.smoothstep;
const DEG = Math.PI / 180;


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
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.localClippingEnabled = true;
  // draw calls are counted over a whole frame (several passes with the composer), not per render call
  renderer.info.autoReset = false;
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
  // OrbitControls listens for the Control key on the root node of the canvas (the document) and removes those listeners from the
  // root node of the canvas *at dispose time*: React runs effect cleanups after it has detached the container, so that root is
  // then the detached subtree and the document keeps a listener that holds the controls and the whole viewer (about 3 MB per
  // visit). The root at creation is remembered and cleaned explicitly.
  const keyRoot = canvas.getRootNode();
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
  /** The preset the camera sits on (fitted again on resize) until the user moves the camera. */
  let preset: ResolvedView | null = initialView;
  let fitContext: FitContext | undefined = opts.fitContext;

  // ------------------------------------------------------------------ light
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, HEMI.night);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, SUN_LIGHT.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
  let shadowRange = opts.shadowRange ?? shadowRangeFor(extent);
  const applyShadowRange = (R: number) => {
    shadowRange = R;
    Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: SUN_LIGHT.distance + R * 2 + extent.top });
    sun.shadow.camera.updateProjectionMatrix();
  };
  applyShadowRange(shadowRange);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  sun.target.position.copy(centerScene);
  scene.add(sun, sun.target);

  // ------------------------------------------------------------------ sky
  const state: SunState = { azimuthTrue: 180, altitude: 35 };
  let palette = readSkyPalette(readToken);
  const groundReflectance = new THREE.Color(opts.groundColor ?? "#5f7f45");
  const skyU = skyUniforms(), lightU = skyUniforms();
  const dome = createSkyDome(skyU);
  scene.add(dome);
  const bakeScene = new THREE.Scene();
  const bakeDome = createSkyDome(lightU, { forBake: true });
  bakeScene.add(bakeDome);
  let skyState: SkyState = skyAt(state.altitude, palette);
  let radiance: SkyRadiance = skyRadiance(skyState, EXPOSURE);
  const sunDirScene = new THREE.Vector3(0, 1, 0);
  let pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget: THREE.WebGLRenderTarget | null = null;
  let lastBake: { altitude: number; azimuth: number } | null = null;
  let bakeAllowed = false; // the first frame is drawn without the environment; baking starts in the next task
  let bakePending = true;

  let needs = true;
  let alive = true;
  let visible = true;
  let lost = false;
  let raf = 0;
  /** The composer's output pass tone-maps the whole frame (fog and clear colour included); without it they reach the screen as given. */
  let outputPass = false;

  function bakeSky(afterRestore = false) {
    // after a context restore the old generator and target belong to the lost context: they are dropped, not disposed
    // (disposing would try to delete objects of the old context and the browser warns about each one)
    if (afterRestore) { pmrem = new THREE.PMREMGenerator(renderer); envTarget = null; }
    const next = bakeEnvironment(pmrem, bakeScene);
    envTarget?.dispose();
    envTarget = next;
    scene.environment = envTarget.texture;
    lastBake = { altitude: state.altitude, azimuth: state.azimuthTrue };
    bakePending = false;
  }

  /** Backdrop and fog from the current sky. */
  function paintBackdrop() {
    scene.background = null;
    skyU.uIntensity.value = skyState.intensity;
    // the dome's horizon below the sky, in the colour space the fog is mixed in: radiance before the output pass (high tier),
    // the display colour after the material's own tone mapping (low tier: three mixes the fog after the tone-mapping chunk)
    const horizon = radiance.horizon.clone().multiplyScalar(skyState.intensity);
    const fog = outputPass ? horizon : displayOf(horizon, EXPOSURE);
    if (scene.fog) scene.fog.color.copy(fog);
    renderer.setClearColor(fog);
  }

  function updateSky() {
    skyState = skyAt(state.altitude, palette);
    radiance = skyRadiance(skyState, EXPOSURE);
    applySky(skyU, radiance, skyState, sunDirScene);
    // the lighting dome: the display colours of the sky and the sunlit ground below it
    const skyE = Math.PI * ENV_GAIN * skyState.intensity * 0.5 * (luminanceOf(skyState.top) + luminanceOf(skyState.horizon));
    const groundE = sun.intensity * Math.max(0, sunDirScene.y) + skyE;
    const light = skyLight(skyState, groundReflectance, groundE, ENV_GAIN);
    applySky(lightU, light, skyState, sunDirScene);
    // the hemisphere light keeps the hue of the sky and the ground, not their brightness
    const norm = (c: THREE.Color) => c.clone().multiplyScalar(1 / Math.max(1e-6, luminanceOf(c)));
    hemi.color.copy(norm(light.top.clone().lerp(light.horizon, 0.5)));
    hemi.groundColor.copy(norm(light.ground));
    paintBackdrop();
    if (needsRebake(lastBake, state.altitude, state.azimuthTrue)) bakePending = true;
  }

  scene.fog = new THREE.Fog(0xffffff, extent.radius * 5, extent.radius * 20);

  function setSun(azimuthTrueDeg: number, altitudeDeg: number) {
    state.azimuthTrue = azimuthTrueDeg;
    state.altitude = altitudeDeg;
    const v = sunDirectionScene(azimuthTrueDeg, altitudeDeg, bearingDeg);
    sunDirScene.set(v[0], v[1], v[2]);
    sun.position.set(v[0], v[1], v[2]).multiplyScalar(SUN_LIGHT.distance).add(sun.target.position);
    const k = THREE.MathUtils.clamp(altitudeDeg / 14, 0, 1);
    const d = smooth(altitudeDeg, -8, 20);
    sun.intensity = SUN_LIGHT.intensity * smooth(altitudeDeg, -1, 6);
    // warm (never orange) at a low sun, a slightly warm white by day (against the cooler skylight)
    sun.color.setRGB(1, 0.8 + 0.17 * k, 0.62 + 0.3 * k);
    hemi.intensity = HEMI.night + HEMI.day * d;
    updateSky();
    scene.environmentIntensity = ENV_GAIN * skyState.intensity;
    const h = sunDirectionHouse(azimuthTrueDeg, altitudeDeg, bearingDeg);
    interior.setDaylight(altitudeDeg, [h[0], h[1]]);
    needs = true;
    renderer.shadowMap.needsUpdate = true;
  }

  setSun(state.azimuthTrue, state.altitude);

  // ------------------------------------------------------------------ post-processing (high tier only, loaded on demand)
  let composer: EffectComposer | null = null;
  let ao: N8AOPass | null = null;
  const postReady: Promise<void> = settings.postprocessing
    ? Promise.all([import("three/addons/postprocessing/EffectComposer.js"), import("three/addons/postprocessing/OutputPass.js"), import("n8ao")])
        .then(([c, o, n]) => {
          if (!alive) return;
          const comp = new c.EffectComposer(renderer);
          // N8AOPass renders the scene itself (autoRenderBeauty) into its beauty target: multisampled, so sub-pixel seams,
          // slats and fence boards stay continuous (it replaces SMAA); no RenderPass in front of it
          const pass = new n.N8AOPass(scene, camera, 1, 1);
          const beauty = (pass as unknown as { beautyRenderTarget?: THREE.WebGLRenderTarget }).beautyRenderTarget;
          if (beauty) beauty.samples = Math.min(MSAA_SAMPLES, renderer.capabilities.maxSamples);
          pass.configuration.aoRadius = AO_OUT.radius;
          pass.configuration.distanceFalloff = 0.8;
          pass.configuration.intensity = AO_OUT.intensity;
          pass.configuration.gammaCorrection = false;
          comp.addPass(pass);
          comp.addPass(new o.OutputPass());
          composer = comp; ao = pass;
          outputPass = true;
          paintBackdrop(); // fog and clear colour now pass through the tone mapper
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
    if (composer && ao) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      ao.setSize(w * pr, h * pr);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // still on a preset: keep it fitted to the new aspect
    if (preset && !tween) {
      const f = fitted(preset, camera.aspect);
      widenFor(f);
      placeCamera(f.position, f.target, f.fov);
    }
    needs = true;
  }

  // ------------------------------------------------------------------ tween and keyboard
  let tween: Tween | null = null;
  const finishTween = () => { const t = tween; tween = null; t?.done(); };
  controls.addEventListener("start", () => { finishTween(); preset = null; });
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

  const offsetV = new THREE.Vector3();
  const moveBy = (next: Vec3) => {
    preset = null;
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
      case "Home": void fit(initialView, undefined, { animate: true }); break;
      default: return;
    }
    e.preventDefault();
  };
  if (keyboardOn) container.addEventListener("keydown", onKey);

  function setView(view: ResolvedView, o: { animate?: boolean } = {}): Promise<void> {
    finishTween();
    preset = null;
    return moveTo(view, o);
  }
  function moveTo(view: ResolvedView, o: { animate?: boolean } = {}): Promise<void> {
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
  function fitted(view: ResolvedView, aspect = camera.aspect): FittedView {
    return fitView(view, aspect, fitContext);
  }
  /** The orbit limits reach a fitted preset (never narrowed). */
  function widenFor(v: Pick<ResolvedView, "position" | "target">) {
    const d = Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]) * VIEW_REACH_MARGIN;
    if (d > limits.maxDistance) applyLimits({ ...limits, maxDistance: d });
  }
  function fit(view: ResolvedView, aspect?: number, o: { animate?: boolean } = {}): Promise<void> {
    finishTween();
    const f = fitted(view, aspect);
    widenFor(f);
    const done = moveTo(f, o);
    preset = view;
    return done;
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
  let lastStats: FrameStats = { calls: 0, triangles: 0 };
  function draw() {
    if (lost) return;
    if (bakePending && bakeAllowed) {
      try { bakeSky(); } catch (err) { bakePending = false; console.warn("sky could not be baked", err); }
    }
    renderer.info.reset();
    if (composer) composer.render(); else renderer.render(scene, camera);
    lastStats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
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
    // inside the building or outside: ambient occlusion radius and the interior fill follow the camera
    const inside = interior.contains(camera.position);
    const wantView = inside ? 1 : INTERIOR_VIEW_OUTSIDE;
    if (interior.view !== wantView) {
      const rate = (1 - INTERIOR_VIEW_OUTSIDE) / INTERIOR_VIEW_EASE;
      interior.setView(wantView > interior.view ? Math.min(wantView, interior.view + dt * rate) : Math.max(wantView, interior.view - dt * rate));
      needs = true;
    }
    if (ao) {
      const want = inside ? 1 : 0;
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
    palette = readSkyPalette(readToken);
    lastBake = null;
    updateSky();
    needs = true;
  }

  // the first frame is drawn without the environment; it follows in the next task
  const ready: Promise<void> = new Promise<void>((resolve) => {
    setTimeout(() => {
      bakeAllowed = true;
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
    get sky() { return skyState; },
    exposure: EXPOSURE,
    get shadowRange() { return shadowRange; },
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
    fit,
    fitted,
    setFitContext(fc) {
      fitContext = fc;
      if (preset && !tween) {
        const f = fitted(preset);
        widenFor(f);
        placeCamera(f.position, f.target, f.fov);
        needs = true;
      }
    },
    setLimits(l) { applyLimits(l); controls.update(); needs = true; },
    setShadowRange(R) { applyShadowRange(R); renderer.shadowMap.needsUpdate = true; needs = true; },
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
    stats: () => ({ ...lastStats }),
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
      const c = controls as unknown as { _interceptControlDown?: EventListener; _interceptControlUp?: EventListener };
      if (c._interceptControlDown) keyRoot.removeEventListener("keydown", c._interceptControlDown, { capture: true });
      if (c._interceptControlUp) keyRoot.removeEventListener("keyup", c._interceptControlUp, { capture: true });
      headingListeners.clear();
      frameCbs.clear();
      interior.dispose();
      envTarget?.dispose();
      envTarget = null;
      scene.environment = null;
      for (const m of [dome, bakeDome]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.removeFromParent();
      }
      pmrem.dispose();
      // the composer frees its own targets, the passes (ambient occlusion, output) have theirs
      composer?.passes.forEach((pass) => pass.dispose?.());
      composer?.dispose();
      composer = null;
      ao = null;
      renderer.renderLists.dispose();
      renderer.dispose();
      // iOS has few contexts; repeated navigation between the two 3D pages must not leak them (a context that is lost already
      // has no extension to ask, and three.js would warn)
      if (!lost) renderer.forceContextLoss();
      canvas.remove();
      labels?.domElement.remove();
      scene.clear();
      bakeScene.clear();
    },
  };
}
