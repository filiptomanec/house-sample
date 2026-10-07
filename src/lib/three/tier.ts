// Quality tiers of the 3D engine. Kept free of three.js so the asset layer and tests can use it without loading the renderer;
// `viewer.ts` re-exports everything here (docs/THREE-API.md section 4).

export type Tier = "high" | "low";

/** Everything that differs between the tiers. Tuning values of the renderer, none of them describes the house. */
export interface TierSettings {
  /** Upper bound of `devicePixelRatio`. */
  maxPixelRatio: number;
  /** Side of the sun shadow map, px. */
  shadowMapSize: number;
  /** N8AO ambient occlusion + SMAA through an EffectComposer. Off: no composer, the context antialiases (MSAA). */
  postprocessing: boolean;
  /** WebGL antialiasing; only used without post-processing. */
  msaa: boolean;
  /** Draco decoder workers. */
  dracoWorkers: number;
  /** The decoder workers are released this long after the last load, ms. */
  idleDecoderMs: number;
  /** Texture anisotropy. */
  anisotropy: number;
  /** Terrain mesh cell, metres, and the side of the painted ground texture, px. */
  terrainStep: number;
  groundTexture: number;
  /** Whether furniture pieces cast shadows (pieces lower than `furnitureShadowMinHeight` never do). */
  furnitureShadows: boolean;
  /** Merge the furniture meshes that share a material into one mesh (far fewer draw calls; the pieces then cannot be told apart). */
  mergeFurniture: boolean;
  furnitureShadowMinHeight: number;
  /** Share of the vegetation instances that are drawn (1 = all). */
  vegetationDensity: number;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  high: {
    maxPixelRatio: 2, shadowMapSize: 4096, postprocessing: true, msaa: false, dracoWorkers: 4, idleDecoderMs: 10_000, anisotropy: 8,
    terrainStep: 1, groundTexture: 2048, furnitureShadows: true, mergeFurniture: false, furnitureShadowMinHeight: 0.35, vegetationDensity: 1,
  },
  low: {
    maxPixelRatio: 1.5, shadowMapSize: 2048, postprocessing: false, msaa: true, dracoWorkers: 2, idleDecoderMs: 10_000, anisotropy: 4,
    terrainStep: 2, groundTexture: 1024, furnitureShadows: false, mergeFurniture: true, furnitureShadowMinHeight: 0.35, vegetationDensity: 0.4,
  },
};

/** Phones and tablets (touch, small screens, iOS) get the light tier. On the server it is always "low". */
export function detectTier(): Tier {
  if (typeof window === "undefined") return "low";
  const coarse = matchMedia("(pointer: coarse)").matches;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const small = Math.min(screen.width, screen.height) < 900;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return ios || (coarse && small) || (mem !== undefined && mem < 4) ? "low" : "high";
}
