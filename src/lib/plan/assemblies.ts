// Cards of the constructions of the model (layers, resistance, U-value) and the legend of materials for the floor plan page.
// Layer by layer figures come from calc/uvalue.ts (EN ISO 6946); names and colours come from the model. Pure, server-side data.
import { assemblyBreakdown } from "@/lib/calc/uvalue";
import { nb } from "@/lib/i18n/format";
import type { Assembly, House, Locale } from "@/lib/model/types";
import type { StyleMaterials } from "./view";

/** The six constructions of the model, in the order the page shows them (keys of `house.assemblies`). */
export const ASSEMBLY_KEYS = ["exteriorWall", "roof", "ceiling", "groundFloor", "bearingWall", "partitionWall"] as const satisfies readonly (keyof House["assemblies"])[];
export type AssemblyKey = (typeof ASSEMBLY_KEYS)[number];

export interface LayerRow {
  name: string;
  /** Thickness, m. */
  thickness: number;
  /** Does not count (outside a ventilated layer). */
  ignored: boolean;
  /** Share of the layer in the total resistance, 0..1. */
  share: number;
  role: string | null;
}

export interface AssemblyCard {
  key: AssemblyKey;
  name: string;
  /** Total thickness, m, resistance of the layers without surface films, m2K/W, and U-value, W/(m2K). */
  thickness: number;
  r: number;
  u: number;
  ventilated: boolean;
  layers: LayerRow[];
}

export function buildAssemblyCards(house: House, locale: Locale): AssemblyCard[] {
  return ASSEMBLY_KEYS.map((key) => {
    const a: Assembly = house.assemblies[key];
    const b = assemblyBreakdown(a);
    return {
      key, name: nb(a.name[locale], locale), thickness: b.thickness, r: b.rLayers, u: b.u, ventilated: b.ventilated,
      layers: a.layers.map((l, i) => ({ name: nb(l.name[locale], locale), thickness: b.layers[i].thickness, ignored: b.layers[i].ignored, share: b.layers[i].share, role: l.role ?? null })),
    };
  });
}

export interface MaterialRow { role: string; name: string; color: string }

/**
 * Materials that appear in the plan or on the facade, with the colour of the model's style: the floors in use, then plaster,
 * timber cladding (when the house has some), roof covering, frames and glass. Roles are the style's own keys.
 */
export function buildMaterialLegend(house: House, floors: readonly string[], style: StyleMaterials, locale: Locale): MaterialRow[] {
  const roles = [...new Set(floors)].map((f) => `floor_${f}`);
  roles.push("plaster", ...(house.accents.length ? ["wood_cladding"] : []), "roof_tile", "frame", "glass");
  return roles.flatMap((role) => {
    const m = style.materials[role];
    return m ? [{ role, name: nb(m.name[locale], locale), color: m.color }] : [];
  });
}
