// Materials and "looks" of the 3D scene, from model/style.json (format "style/1", docs/DESIGN.md section 9). Pure, no three.js.
//
// A look group (facade, wood, roof, ... whatever `looks` contains) is a list of options. Exactly one option per group has
// `default: true` and equals the base materials. An option either recolours roles (`set`) or replaces the material of a
// role by the material of another role (`substitute`, e.g. "no timber": the timber role is drawn with the plaster).
// Code selects options by their id as an opaque key (what the UI stored) and never branches on a particular id.
import type { LocalizedText } from "@/lib/model";

export interface StyleMaterial {
  name: LocalizedText;
  /** "#rrggbb". */
  color: string;
  roughness: number;
  metallic?: number;
  /** Opacity below 1 makes the material transparent (glass). */
  alpha?: number;
}

export interface LookOption {
  id: string;
  name: LocalizedText;
  default?: true;
  set?: Record<string, { color?: string; roughness?: number }>;
  /** role -> role whose material is used instead. */
  substitute?: Record<string, string>;
}

export interface LookGroup {
  label: LocalizedText;
  options: LookOption[];
}

export interface StyleModel {
  schema: "style/1";
  palette: Record<string, string>;
  /** One material per GLB role plus the generated ground roles `lawn` and `mulch`. */
  materials: Record<string, StyleMaterial>;
  looks: Record<string, LookGroup>;
  /**
   * Optional: materials of geometry that is generated in JS and has no GLB role (PV cells and frames, blind slats and
   * rails, battery, bark, foliage, asphalt, field, kerb). When a role is missing here the engine derives a colour from
   * the roles above (see docs/THREE-API.md section 3.3).
   */
  generated?: Record<string, StyleMaterial>;
}

/** What the UI stores: group key -> option id. Groups and ids are opaque keys taken from `style.looks`. */
export type LookSelection = Record<string, string>;

/** A resolved material for one role under a look. */
export interface ResolvedMaterial {
  color: string;
  roughness: number;
  metallic: number;
  alpha: number;
}

export interface ResolvedLook {
  /** The selection actually applied (unknown or missing ids replaced by the defaults). */
  selection: LookSelection;
  /** Role -> material parameters after `set`. Roles without a change keep the base values. */
  materials: Record<string, ResolvedMaterial>;
  /** Role -> role whose material is drawn instead (from `substitute`). Empty without such an option. */
  substitutions: Record<string, string>;
}

const base = (m: StyleMaterial): ResolvedMaterial => ({ color: m.color, roughness: m.roughness, metallic: m.metallic ?? 0, alpha: m.alpha ?? 1 });

/** The option with `default: true` (else the first) of a group. */
export function defaultOption(group: LookGroup): LookOption {
  return group.options.find((o) => o.default) ?? group.options[0];
}

/** The default selection: every group at its default option. */
export function defaultLook(style: StyleModel): LookSelection {
  return Object.fromEntries(Object.entries(style.looks).map(([key, g]) => [key, defaultOption(g).id]));
}

/**
 * Applies a selection to the base materials. Groups missing from `selection` and ids that no longer exist (a stale value
 * in localStorage) fall back to the group's default. Options are applied in the order of the groups in `style.looks`;
 * a later `set` of the same role wins. Pure: the style is not modified.
 */
export function resolveLook(style: StyleModel, selection: Partial<LookSelection> = {}): ResolvedLook {
  const materials: Record<string, ResolvedMaterial> = Object.fromEntries(Object.entries(style.materials).map(([role, m]) => [role, base(m)]));
  const substitutions: Record<string, string> = {};
  const applied: LookSelection = {};
  for (const [key, group] of Object.entries(style.looks)) {
    const option = group.options.find((o) => o.id === selection[key]) ?? defaultOption(group);
    applied[key] = option.id;
    for (const [role, patch] of Object.entries(option.set ?? {})) {
      const m = materials[role];
      if (!m) continue;
      if (patch.color !== undefined) m.color = patch.color;
      if (patch.roughness !== undefined) m.roughness = patch.roughness;
    }
    for (const [role, other] of Object.entries(option.substitute ?? {})) {
      if (style.materials[role] && style.materials[other]) substitutions[role] = other;
    }
  }
  return { selection: applied, materials, substitutions };
}

/** Is a role drawn with another role's material under this look? Follows chains, stops on cycles. */
export function effectiveRole(look: ResolvedLook, role: string): string {
  const seen = new Set<string>();
  let r = role;
  while (look.substitutions[r] && !seen.has(r)) { seen.add(r); r = look.substitutions[r]; }
  return r;
}

/** Material of a generated (non-GLB) part: `style.generated[role]` when present, else the fallback role of `style.materials`. */
export function generatedMaterial(style: StyleModel, role: string, fallbackRole: string): ResolvedMaterial {
  const m = style.generated?.[role] ?? style.materials[fallbackRole];
  if (!m) throw new Error(`style: no material "${role}" and no fallback "${fallbackRole}"`);
  return base(m);
}
