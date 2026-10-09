// What the Sun page builds on top of the Stage: the ray-cast analyser, the movable shading (terrace louvres, exterior blinds), the
// photovoltaics on the roof (they cast shade too) and the sun path drawn over the house. Built after the scene is on screen and
// loaded with `import()`, so this code and three.js stay out of the first chunk.
import type * as THREE from "three";
import type { StageHandle } from "@/components/three/Stage";
import type { CalendarDate } from "@/lib/calc/sun";
import type { ExtBlinds, PvScene, SlatScreens, SunAnalyzer, SunPath } from "@/lib/three";

export interface SunEngine {
  handle: StageHandle;
  analyzer: SunAnalyzer;
  /** Null when the model has none (the controls stay hidden). */
  slats: SlatScreens | null;
  blinds: ExtBlinds | null;
  pv: PvScene | null;
  /** The arc of the sun over the house for the chosen day, with the disc at the chosen minute (draggable). */
  path: SunPath | null;
  /** The movable occluders in their current position (fresh each call). */
  shades(): THREE.Object3D[];
  /** Removes the movable parts from the scene and frees them. Idempotent. */
  dispose(): void;
}

/** Where the sun path starts: the day and minute shown when the engine arrives, and the text of its hour ticks. */
export interface SunPathStart {
  date: CalendarDate;
  minute: number;
  formatHour: (hour: number) => string;
  visible: boolean;
}

/** Builds what the model has; a part that cannot be built (nothing to show, an engine error) is null. */
export async function buildSunEngine(handle: StageHandle, start: SunPathStart): Promise<SunEngine> {
  const [analysis, slatModule, blindModule, pvModule, pathModule] = await Promise.all([
    import("@/lib/three/sunAnalysis"), import("@/lib/three/blinds"), import("@/lib/three/extBlinds"), import("@/lib/three/pv"),
    import("@/lib/three/sunPath"),
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
  const pv = attempt("photovoltaics", () => pvModule.buildPv(handle.viewer, handle.house, pvModule.readPvConfig(handle.ctx)));
  const path = attempt("sun path", () => pathModule.addSunPath(handle.viewer, { ctx: handle.ctx, ...start }));
  const analyzer = analysis.makeSunAnalyzer(handle.viewer, handle.house);
  const own = { slats: slats && slats.counts.screens ? slats : null, blinds: blinds && blinds.sections.length ? blinds : null, pv, path };
  let disposed = false;
  const engine: SunEngine = {
    handle,
    analyzer,
    ...own,
    shades: () => [...(own.slats?.occluders() ?? []), ...(own.blinds?.occluders() ?? [])],
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const part of [slats, blinds, pv, path]) attempt("disposal", () => part?.dispose());
      if (process.env.NODE_ENV !== "production" && hook.__sun === engine) delete hook.__sun;
    },
  };
  // development hook for manual checks and the e2e tests, like `window.__stage`
  const hook = window as unknown as { __sun?: SunEngine };
  if (process.env.NODE_ENV !== "production") hook.__sun = engine;
  return engine;
}
