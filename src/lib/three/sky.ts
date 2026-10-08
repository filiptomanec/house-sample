// The sky of the 3D scene: one sky function drives the visible backdrop (a tone-mapped dome drawn behind everything) and the
// image-based light (the same dome baked into a PMREM environment). The sky follows the simulated sun, never the colour scheme
// of the page: its colours are the scheme-independent design tokens `--sky-*` (tokens.css, the same in light and dark mode),
// blended by the sun altitude (night -> dusk -> low sun -> day) with a warm-white glow around a low sun.
//
// Tone mapping is AgX (as the Cycles renders). The tokens are what the screen should show, so the dome holds the radiance that
// AgX turns into the token (`inverseAgx`, solved numerically against a JS copy of three's shader, `agx`). The dome material
// includes the tone-mapping and colour-space chunks: drawn to the screen (low tier) it tone-maps itself; drawn into the
// composer's linear target (high tier) the chunks are no-ops and the output pass tone-maps the frame. Both tiers show the same sky.
// Nothing here describes the house.
import * as THREE from "three";

export type Rgb = [number, number, number];

// ------------------------------------------------------------------------------------------------ AgX in JS

// three r169 `AgXToneMapping` (tonemapping_pars_fragment): GLSL mat3(a, b, c) has the columns a, b, c.
type Mat3 = readonly [Rgb, Rgb, Rgb];
const mul = (m: Mat3, v: Readonly<Rgb>): Rgb => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];
const AGX_INSET: Mat3 = [[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903], [0.0482516061458583, 0.101439036467562, 0.811302368396859]];
const AGX_OUTSET: Mat3 = [[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294], [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]];
const REC2020_TO_SRGB: Mat3 = [[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]];
const SRGB_TO_REC2020: Mat3 = [[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.088], [0.0433, 0.0113, 0.8956]];
const AGX_MIN_EV = -12.47393, AGX_MAX_EV = 4.026069;
const agxContrast = (x: number) => {
  const x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** AgX tone mapping exactly as three.js r169 draws it: linear-sRGB radiance in, display-linear sRGB (0..1) out. */
export function agx(rgb: Readonly<Rgb>, exposure = 1): Rgb {
  let v: Rgb = [rgb[0] * exposure, rgb[1] * exposure, rgb[2] * exposure];
  v = mul(AGX_INSET, mul(SRGB_TO_REC2020, v));
  v = v.map((x) => agxContrast(clamp01((Math.log2(Math.max(x, 1e-10)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)))) as Rgb;
  v = mul(AGX_OUTSET, v).map((x) => Math.pow(Math.max(0, x), 2.2)) as Rgb;
  return mul(REC2020_TO_SRGB, v).map(clamp01) as Rgb;
}

/** Displayable colours are kept inside this range before inverting (AgX reaches neither 0 nor 1 exactly). */
const DISPLAY_RANGE = [2e-4, 0.985] as const;

/**
 * The radiance (linear sRGB) that AgX at `exposure` turns into `display` (display-linear sRGB). Newton's method in log space
 * with a finite-difference Jacobian; the target is clamped into the range AgX can reach. Pure.
 */
export function inverseAgx(display: Readonly<Rgb>, exposure = 1): Rgb {
  const target = display.map((x) => Math.min(DISPLAY_RANGE[1], Math.max(DISPLAY_RANGE[0], x))) as Rgb;
  // unknowns: log2 of the radiance per channel; start from the grey curve
  let u = target.map((x) => Math.log2(Math.max(1e-6, x)) + 0.4) as Rgb;
  const f = (w: Rgb): Rgb => agx(w.map((x) => 2 ** x) as Rgb, exposure);
  for (let it = 0; it < 40; it++) {
    const y = f(u);
    const r: Rgb = [y[0] - target[0], y[1] - target[1], y[2] - target[2]];
    if (Math.max(...r.map(Math.abs)) < 1e-7) break;
    const h = 1e-4;
    const J: Rgb[] = [0, 1, 2].map((k) => {
      const w = [...u] as Rgb;
      w[k] += h;
      const yk = f(w);
      return [(yk[0] - y[0]) / h, (yk[1] - y[1]) / h, (yk[2] - y[2]) / h] as Rgb;
    }); // J[k] = d y / d u_k (a column)
    const d = solve3(J, r);
    if (!d) break;
    // damped step, never more than 2 EV at once
    const s = Math.min(1, 2 / Math.max(1e-9, ...d.map(Math.abs)));
    u = [u[0] - d[0] * s, u[1] - d[1] * s, u[2] - d[2] * s];
  }
  return u.map((x) => 2 ** x) as Rgb;
}

/** Solves sum_k cols[k] * x_k = b (Cramer's rule). */
function solve3(cols: Rgb[], b: Rgb): Rgb | null {
  const [a, c, e] = cols;
  const det = (p: Rgb, q: Rgb, r: Rgb) => p[0] * (q[1] * r[2] - q[2] * r[1]) - q[0] * (p[1] * r[2] - p[2] * r[1]) + r[0] * (p[1] * q[2] - p[2] * q[1]);
  const D = det(a, c, e);
  if (Math.abs(D) < 1e-14) return null;
  return [det(b, c, e) / D, det(a, b, e) / D, det(a, c, b) / D];
}

// ------------------------------------------------------------------------------------------------ colour helpers

export const luminanceOf = (c: THREE.Color | Readonly<Rgb>): number => {
  const [r, g, b] = Array.isArray(c) ? (c as Rgb) : [(c as THREE.Color).r, (c as THREE.Color).g, (c as THREE.Color).b];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** CIE L* (0..100) of a display-linear colour. */
export const lightnessOf = (c: THREE.Color | Readonly<Rgb>): number => {
  const y = luminanceOf(c);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};

/** Warm tint of the light bounced up from the sunlit ground (linear RGB). */
const WARM_BOUNCE = new THREE.Color(1, 0.9, 0.78);

/** The light bounced up from the ground: the lawn colour, a little warmed and brightened (a reflectance, not a radiance). */
export function groundBounce(lawn: THREE.Color): THREE.Color {
  return lawn.clone().lerp(WARM_BOUNCE, 0.3).multiplyScalar(0.9);
}

const rgbOf = (c: THREE.Color): Rgb => [c.r, c.g, c.b];
const colorOf = (v: Readonly<Rgb>): THREE.Color => new THREE.Color(v[0], v[1], v[2]);

// ------------------------------------------------------------------------------------------------ the palette

/** The sky tokens (tokens.css, scheme independent) and fallbacks equal to their values. Display colours, not radiance. */
export const SKY_TOKENS = {
  dayTop: ["--sky-day-top", "#a3c8ea"],
  dayHorizon: ["--sky-day-horizon", "#e6eff4"],
  lowHorizon: ["--sky-low-horizon", "#eef0ea"],
  duskTop: ["--sky-dusk-top", "#3a5684"],
  duskHorizon: ["--sky-dusk-horizon", "#e6d3da"],
  nightTop: ["--sky-night-top", "#0b1422"],
  nightHorizon: ["--sky-night-horizon", "#22324a"],
  glow: ["--sky-glow", "#f6ead6"],
} as const satisfies Record<string, readonly [string, string]>;

export type SkyPalette = Record<keyof typeof SKY_TOKENS, THREE.Color>;

/** Reads the palette through `read(token, fallback)` (the viewer passes `readToken`; tests pass the fallbacks). */
export function readSkyPalette(read: (token: string, fallback: string) => string = (_t, f) => f): SkyPalette {
  const out = {} as SkyPalette;
  for (const [key, [token, fallback]] of Object.entries(SKY_TOKENS) as [keyof SkyPalette, readonly [string, string]][]) {
    const c = new THREE.Color();
    try { c.set(read(token, fallback)); } catch { c.set(fallback); }
    out[key] = c;
  }
  return out;
}

/** Altitudes (degrees) of the blends. Properties of the sky model, not of the house. */
export const SKY_BLEND = {
  /** Night below `night[0]`, dusk colours at `night[1]`. */
  night: [-12, -6],
  /** Dusk at `dusk[0]`, the low-sun colours at `dusk[1]`. */
  dusk: [-6, 2],
  /** The low-sun horizon turns into the day horizon over this range. */
  day: [2, 14],
  /** The warm glow around the sun fades out between these altitudes (and below the first of `glowBelow`). */
  glow: [5, 25],
  glowBelow: [-8, -2],
} as const;

const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

export interface SkyState {
  /** Display colours at the zenith and at the horizon (display-linear sRGB). */
  top: THREE.Color;
  horizon: THREE.Color;
  /** Display colour of the glow and its strength (0..1) near the sun. */
  glow: THREE.Color;
  glowStrength: number;
  /** Multiplier of the visible backdrop (radiance): `0.3 + 0.7 * smoothstep(alt, -6, 3)`. */
  intensity: number;
}

/** Backdrop intensity: never dimmed while the sun is up, 0.3 in the night. */
export const backdropIntensity = (altitudeDeg: number): number => 0.3 + 0.7 * smooth(altitudeDeg, -6, 3);

/** The sky at a sun altitude (pure): colours blended night -> dusk -> low sun -> day, glow and backdrop intensity. */
export function skyAt(altitudeDeg: number, p: SkyPalette): SkyState {
  const a = altitudeDeg;
  const nightK = smooth(a, SKY_BLEND.night[0], SKY_BLEND.night[1]);
  const duskK = smooth(a, SKY_BLEND.dusk[0], SKY_BLEND.dusk[1]);
  const dayK = smooth(a, SKY_BLEND.day[0], SKY_BLEND.day[1]);
  const top = p.nightTop.clone().lerp(p.duskTop, nightK).lerp(p.dayTop, duskK);
  const lowHorizon = p.lowHorizon.clone().lerp(p.dayHorizon, dayK);
  const horizon = p.nightHorizon.clone().lerp(p.duskHorizon, nightK).lerp(lowHorizon, duskK);
  const glowStrength = (1 - smooth(a, SKY_BLEND.glow[0], SKY_BLEND.glow[1])) * smooth(a, SKY_BLEND.glowBelow[0], SKY_BLEND.glowBelow[1]);
  return { top, horizon, glow: p.glow.clone(), glowStrength, intensity: backdropIntensity(a) };
}

// ------------------------------------------------------------------------------------------------ the dome

/** The colours a dome is drawn with (linear sRGB, before exposure and tone mapping). */
export interface SkyRadiance {
  top: THREE.Color;
  horizon: THREE.Color;
  glow: THREE.Color;
  /** The ground half of the lighting dome (the visible dome shows the horizon colour below the horizon). */
  ground: THREE.Color;
}

/**
 * The backdrop: the radiance AgX at `exposure` turns into the display colours of the state (so the screen shows the tokens).
 * Below the horizon the backdrop continues the horizon.
 */
export function skyRadiance(state: SkyState, exposure: number): SkyRadiance {
  const top = colorOf(inverseAgx(rgbOf(state.top), exposure));
  const horizon = colorOf(inverseAgx(rgbOf(state.horizon), exposure));
  const glow = colorOf(inverseAgx(rgbOf(state.glow), exposure));
  return { top, horizon, glow, ground: horizon.clone() };
}

/**
 * The lighting dome (baked into the environment): the display colours of the state themselves, a soft skylight (the inverted
 * backdrop radiance is far too saturated a blue to light with), and the ground half: the ground's reflectance times the light
 * that falls on it, `groundIrradiance` (sun and sky on a horizontal surface, three.js units), in units of the dome, which the
 * viewer scales by `gain` (its environment intensity).
 */
export function skyLight(state: SkyState, groundReflectance: THREE.Color, groundIrradiance: number, gain: number): SkyRadiance {
  const ground = groundBounce(groundReflectance).multiplyScalar(Math.max(0, groundIrradiance) / Math.PI / Math.max(1e-6, gain));
  return { top: state.top.clone(), horizon: state.horizon.clone(), glow: state.glow.clone(), ground };
}

/** The colour a radiance shows on the screen (display-linear) after AgX at `exposure`. */
export const displayOf = (radiance: THREE.Color, exposure: number): THREE.Color => colorOf(agx(rgbOf(radiance), exposure));

/** Uniforms of the dome material. */
export interface SkyUniforms {
  [name: string]: THREE.IUniform;
  uTop: THREE.IUniform<THREE.Color>;
  uHorizon: THREE.IUniform<THREE.Color>;
  uGround: THREE.IUniform<THREE.Color>;
  uGlow: THREE.IUniform<THREE.Color>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uGlowK: THREE.IUniform<number>;
  uIntensity: THREE.IUniform<number>;
  /** 0: the horizon colour continues below the horizon (visible dome); 1: the ground half (lighting dome). */
  uGroundMix: THREE.IUniform<number>;
}

/** Exponent of the zenith blend over the height of the direction (sin of the elevation): above 0.5 the horizon stays pale longer. */
export const SKY_GRADIENT = 0.8;

const DOME_VERTEX = /* glsl */ `
varying vec3 vSkyDir;
void main() {
  vSkyDir = position;
  // rotation only: the dome is infinitely far away; z = w puts it on the far plane
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = vec4( p.xy, p.w * 0.99999, p.w );
}`;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uTop, uHorizon, uGround, uGlow, uSunDir;
uniform float uGlowK, uIntensity, uGroundMix;
varying vec3 vSkyDir;
void main() {
  vec3 d = normalize( vSkyDir );
  float h = d.y;
  // interpolated in log space, so the gradient reads even after the log-encoding tone mapper
  // the haze keeps the horizon colour over the lowest ten degrees or so, the blue deepens above
  vec3 sky = exp( mix( log( uHorizon ), log( uTop ), pow( clamp( h, 0.0, 1.0 ), ${SKY_GRADIENT.toFixed(2)} ) ) );
  // the glow fades out towards the horizon line itself, where the fog colour (the plain horizon) meets the sky
  float g = pow( max( dot( d, uSunDir ), 0.0 ), 6.0 ) * uGlowK * ( 1.0 - 0.7 * clamp( h, 0.0, 1.0 ) ) * smoothstep( -0.01, 0.1, h );
  sky = mix( sky, uGlow, clamp( g, 0.0, 1.0 ) );
  vec3 low = mix( uHorizon, uGround, smoothstep( 0.0, -0.2, h ) * uGroundMix );
  gl_FragColor = vec4( ( h >= 0.0 ? sky : low ) * uIntensity, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Fresh uniforms (all black, sun up). */
export function skyUniforms(): SkyUniforms {
  return {
    uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uGlowK: { value: 0 }, uIntensity: { value: 1 }, uGroundMix: { value: 0 },
  };
}

/** Sets the uniforms from radiances, the sun direction (scene frame) and the state. */
export function applySky(u: SkyUniforms, r: SkyRadiance, state: SkyState, sunDirScene: Readonly<THREE.Vector3>): void {
  // log() in the shader needs strictly positive colours
  const pos = (c: THREE.Color) => new THREE.Color(Math.max(c.r, 1e-6), Math.max(c.g, 1e-6), Math.max(c.b, 1e-6));
  u.uTop.value.copy(pos(r.top));
  u.uHorizon.value.copy(pos(r.horizon));
  u.uGround.value.copy(pos(r.ground));
  u.uGlow.value.copy(pos(r.glow));
  u.uSunDir.value.copy(sunDirScene).normalize();
  u.uGlowK.value = state.glowStrength;
}

/**
 * The sky dome: a unit sphere drawn at infinity with the sky function and its own uniforms (`skyUniforms`). The backdrop:
 * drawn first, behind everything, never culled, without depth. The lighting variant (`forBake`, baked into the environment)
 * shows the ground half below the horizon (`uGroundMix` 1) at full intensity.
 */
export function createSkyDome(uniforms: SkyUniforms, opts: { forBake?: boolean } = {}): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: opts.forBake ? "sky-dome-bake" : "sky-dome",
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
    uniforms,
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
  });
  if (opts.forBake) { uniforms.uIntensity.value = 1; uniforms.uGroundMix.value = 1; }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.name = opts.forBake ? "sky-dome-bake" : "sky-dome";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // the dome is not part of the world: rays and pickers ignore it
  mesh.raycast = () => undefined;
  return mesh;
}

/** When the environment must be baked again: the sun moved at least this far (degrees) in altitude or azimuth. */
export const REBAKE = { altitudeDeg: 2, azimuthDeg: 5 } as const;

/** Has the sun moved far enough from the last bake to bake again? */
export function needsRebake(last: { altitude: number; azimuth: number } | null, altitude: number, azimuth: number): boolean {
  if (!last) return true;
  const dAz = Math.abs(((azimuth - last.azimuth + 540) % 360) - 180);
  return Math.abs(altitude - last.altitude) >= REBAKE.altitudeDeg || dAz >= REBAKE.azimuthDeg;
}

/**
 * Bakes the lighting dome (a scene holding `createSkyDome(uniforms, { forBake: true })`) into a PMREM environment. The caller
 * owns the returned render target (dispose it when replacing it) and the generator. Needs a live renderer.
 */
export function bakeEnvironment(pmrem: THREE.PMREMGenerator, domeScene: THREE.Scene): THREE.WebGLRenderTarget {
  return pmrem.fromScene(domeScene, 0, 0.1, 100);
}

/** A vertical gradient (top to bottom) as a background texture (2D helper; the viewer draws the dome instead). */
export function gradientTexture(top: THREE.Color, bottom: THREE.Color, steps = 128): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = steps;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, steps);
    grad.addColorStop(0, `#${top.getHexString()}`);
    grad.addColorStop(1, `#${bottom.getHexString()}`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, steps);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
