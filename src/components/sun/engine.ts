// What the Sun page builds on top of the Stage: the ray-cast analyser and the movable shading (terrace slat screens, exterior
// blinds). Built after the scene is on screen and loaded with `import()`, so this code and three.js stay out of the first chunk.
import type * as THREE from "three";
import type { StageHandle } from "@/components/three/Stage";
import type { ExtBlinds, SlatScreens, SunAnalyzer } from "@/lib/three";

export interface SunEngine {
  handle: StageHandle;
  analyzer: SunAnalyzer;
  /** Null when the model has none (the controls stay hidden). */
  slats: SlatScreens | null;
  blinds: ExtBlinds | null;
  /** The movable occluders in their current position (fresh each call). */
  shades(): THREE.Object3D[];
  /** Removes the movable parts from the scene and frees them. Idempotent. */
  dispose(): void;
}

/** Builds what the model has; a part that cannot be built (nothing to show, an engine error) is null. */
export async function buildSunEngine(handle: StageHandle): Promise<SunEngine> {
  const [analysis, slatModule, blindModule] = await Promise.all([
    import("@/lib/three/sunAnalysis"), import("@/lib/three/blinds"), import("@/lib/three/extBlinds"),
  ]);
  const attempt = <T>(what: string, make: () => T): T | null => {
    try {
      return make();
    } catch (error) {
      console.warn(`Sun page: ${what} could not be built`, error);
      return null;
    }
  };
  const slats = attempt("slat screens", () => slatModule.buildSlatScreens(handle.viewer, handle.house));
  const blinds = attempt("exterior blinds", () => blindModule.buildExtBlinds(handle.viewer, handle.house));
  const analyzer = analysis.makeSunAnalyzer(handle.viewer, handle.house);
  const own = { slats: slats && slats.counts.screens ? slats : null, blinds: blinds && blinds.sections.length ? blinds : null };
  let disposed = false;
  return {
    handle,
    analyzer,
    ...own,
    shades: () => [...(own.slats?.occluders() ?? []), ...(own.blinds?.occluders() ?? [])],
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const part of [slats, blinds]) attempt("disposal", () => part?.dispose());
    },
  };
}
