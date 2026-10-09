// The movable parts of the scene (exterior blinds, slat screens, the garage door, photovoltaics and battery). They are built after the scene
// is on screen and loaded with `import()`, so their code (and three.js) stays out of the first chunk of the page.
import type { StageHandle } from "@/components/three/Stage";
import type { ExtBlinds, GarageDoor, PvScene, SlatScreens } from "@/lib/three";

export interface Equipment {
  blinds: ExtBlinds | null;
  pv: PvScene | null;
  screens: SlatScreens | null;
  /** Null unless the GLB has a door leaf to move (`available`). */
  garage: GarageDoor | null;
  /** Removes all four from the scene and frees their resources. Idempotent. */
  dispose(): void;
}

/** Builds what the model has; a part that cannot be built (nothing to show, an engine error) is null and its controls stay hidden. */
export async function buildEquipment(h: StageHandle): Promise<Equipment> {
  const [extBlinds, pv, slats, door] = await Promise.all([
    import("@/lib/three/extBlinds"), import("@/lib/three/pv"), import("@/lib/three/blinds"), import("@/lib/three/garageDoor"),
  ]);
  const attempt = <T>(what: string, make: () => T): T | null => {
    try {
      return make();
    } catch (error) {
      console.warn(`3D model: ${what} could not be built`, error);
      return null;
    }
  };
  const blinds = attempt("exterior blinds", () => extBlinds.buildExtBlinds(h.viewer, h.house));
  const photovoltaics = attempt("photovoltaics", () => pv.buildPv(h.viewer, h.house, pv.readPvConfig(h.ctx)));
  const screens = attempt("slat screens", () => slats.buildSlatScreens(h.viewer, h.house));
  const garage = attempt("garage door", () => door.buildGarageDoor(h.viewer, h.house));
  let disposed = false;
  return {
    blinds: blinds && blinds.sections.length ? blinds : null,
    pv: photovoltaics,
    screens: screens && screens.counts.screens ? screens : null,
    garage: garage?.available ? garage : null,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const part of [blinds, photovoltaics, screens, garage]) attempt("disposal", () => part?.dispose());
    },
  };
}
