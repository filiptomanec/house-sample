// Procedural sky of the 3D scene: a gradient dome baked once into a PMREM environment (image-based light, no HDRI file),
// the backdrop gradient behind the scene and the colour helpers both need. Colours come from the design tokens
// (`--sky-top`, `--sky-bottom`, `--stage-bg`) and from the lawn material of the style; nothing here describes the house.
import * as THREE from "three";

/** Radiance of the baked dome relative to the token colours (the tokens are paint, the sky is a light source). */
export const SKY_GAIN = 1.7;
/** A dome darker than this (linear luminance) is lifted towards white: the dark theme has a dark backdrop, not a dark daylight. */
export const MIN_DOME_LUMINANCE = 0.38;
/** Warm tint of the light bounced up from the sunlit ground (linear RGB). */
const WARM_BOUNCE = new THREE.Color(1, 0.86, 0.66);

export interface SkyColors {
  /** Zenith and horizon of the lighting dome, and the ground it stands on (linear working space). */
  top: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
}

export const luminanceOf = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Moves a colour towards white until its luminance reaches `min`; brighter colours are returned unchanged (a copy). */
export function liftToLuminance(color: THREE.Color, min: number): THREE.Color {
  const out = color.clone();
  const l = luminanceOf(out);
  if (l >= min) return out;
  const white = new THREE.Color(1, 1, 1);
  const k = (min - l) / Math.max(1e-6, 1 - l);
  return out.lerp(white, Math.min(1, k));
}

/** The light bounced up from the ground: the lawn colour warmed and brightened, so shaded walls do not pick up a cold tint. */
export function groundBounce(lawn: THREE.Color): THREE.Color {
  return lawn.clone().lerp(WARM_BOUNCE, 0.35).multiplyScalar(0.9);
}

/** A sphere around the origin with a vertical gradient: horizon colour at the equator, the zenith above, the ground below. */
function skyDome(colors: SkyColors): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: colors.top.clone().multiplyScalar(SKY_GAIN) },
      uHorizon: { value: colors.horizon.clone().multiplyScalar(SKY_GAIN) },
      uGround: { value: colors.ground.clone().multiplyScalar(SKY_GAIN) },
    },
    vertexShader: "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }",
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uTop, uHorizon, uGround;
      void main() {
        float h = normalize( vDir ).y;
        vec3 sky = mix( uHorizon, uTop, pow( clamp( h, 0.0, 1.0 ), 0.55 ) );
        vec3 low = mix( uHorizon, uGround, smoothstep( 0.0, -0.3, h ) );
        gl_FragColor = vec4( h >= 0.0 ? sky : low, 1.0 );
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), material);
}

/**
 * Bakes the dome into a PMREM environment. The caller owns the returned render target (dispose it when replacing it) and
 * the generator. Needs a live renderer.
 */
export function bakeEnvironment(pmrem: THREE.PMREMGenerator, colors: SkyColors): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const dome = skyDome(colors);
  scene.add(dome);
  const target = pmrem.fromScene(scene, 0, 0.1, 100);
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  return target;
}

/** A vertical gradient (top to bottom) as a background texture. */
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
