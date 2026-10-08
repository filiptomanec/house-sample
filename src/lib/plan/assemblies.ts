// Cards of the constructions of the model (layers, resistance, U-value) and the legend of materials for the floor plan page.
// Layer by layer figures come from calc/uvalue.ts (EN ISO 6946); names and colours come from the model. Pure, server-side data.
import { assemblyBreakdown } from "@/lib/calc/uvalue";
import { nb } from "@/lib/i18n/format";
import type { Assembly, House, Locale } from "@/lib/model/types";
import type { StyleMaterials } from "./view";

/**
 * The constructions of the model (keys of `house.assemblies`, schema keys that name a role, not ids). `wallToUnheated` is
 * optional in the model; a card is made for every key the house has. The page orders the cards by `envelope` first.
 */
export const ASSEMBLY_KEYS = ["exteriorWall", "roof", "ceiling", "groundFloor", "wallToUnheated", "bearingWall", "partitionWall"] as const satisfies readonly (keyof House["assemblies"])[];
export type AssemblyKey = (typeof ASSEMBLY_KEYS)[number];

/**
 * The constructions that bound the heated volume (the thermal envelope the energy balance uses): the external walls, the
 * floor on the ground, the top closure (the ceiling under a cold loft, else the roof: `roof.attic`) and the wall to an
 * unheated room when the model has one. Everything else (internal walls, the roof over a cold loft) is not part of it, so
 * its U-value says nothing about the heat loss of the house.
 */
export function envelopeKeys(house: Pick<House, "roof" | "assemblies">): Set<AssemblyKey> {
  const keys = new Set<AssemblyKey>(["exteriorWall", "groundFloor", house.roof.attic === "cold" ? "ceiling" : "roof"]);
  if (house.assemblies.wallToUnheated) keys.add("wallToUnheated");
  return keys;
}

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
  /** Part of the thermal envelope (see `envelopeKeys`): the page shows its U-value large; for the others the thickness. */
  envelope: boolean;
  /** Total thickness, m, resistance of the layers without surface films, m2K/W, and U-value, W/(m2K). */
  thickness: number;
  r: number;
  u: number;
  ventilated: boolean;
  layers: LayerRow[];
}

/** One card per construction of the house: the envelope first, then the rest, each group in the order of ASSEMBLY_KEYS. */
export function buildAssemblyCards(house: House, locale: Locale): AssemblyCard[] {
  const env = envelopeKeys(house);
  const cards = ASSEMBLY_KEYS.flatMap((key): AssemblyCard[] => {
    const a: Assembly | undefined = house.assemblies[key];
    if (!a) return [];
    const b = assemblyBreakdown(a);
    return [{
      key, name: nb(a.name[locale], locale), envelope: env.has(key), thickness: b.thickness, r: b.rLayers, u: b.u, ventilated: b.ventilated,
      layers: a.layers.map((l, i) => ({ name: nb(l.name[locale], locale), thickness: b.layers[i].thickness, ignored: b.layers[i].ignored, share: b.layers[i].share, role: l.role ?? null })),
    }];
  });
  return [...cards.filter((c) => c.envelope), ...cards.filter((c) => !c.envelope)];
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
