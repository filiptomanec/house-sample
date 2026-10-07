import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isOrangeish, parseColorTokens } from "./color";

type Bi = { cs: string; en: string };
type Material = { name: Bi; color: string; roughness: number; metallic?: number; alpha?: number };
type Option = { id: string; name: Bi; default?: true; set?: Record<string, { color?: string; roughness?: number }>; substitute?: Record<string, string> };
type Style = {
  schema: string;
  palette: Record<string, string>;
  materials: Record<string, Material>;
  looks: Record<string, { label: Bi; options: Option[] }>;
};

const root = join(__dirname, "..", "..");
const style = JSON.parse(readFileSync(join(root, "model", "style.json"), "utf8")) as Style;
const tokens = parseColorTokens(readFileSync(join(__dirname, "tokens.css"), "utf8"));

// roles named in docs/ARCHITECTURE.md (GLB contract) plus the two terrain materials generated in JS
const ROLES = ["plaster", "wood_cladding", "frame", "glass", "sill", "soffit", "fascia", "gutter", "roof_tile", "ridge_cap", "ceiling", "plaster_in", "door_leaf", "slab", "floor_oak", "floor_tile", "floor_stone", "floor_concrete", "terrace_paving", "drive_paving", "path", "gravel", "post", "screen_slats", "lawn", "mulch"];
const HEX = /^#[0-9a-f]{6}$/i;
const bilingual = (b: Bi) => typeof b?.cs === "string" && b.cs.length > 0 && typeof b?.en === "string" && b.en.length > 0;
const allColors = () => [
  ...Object.values(style.palette),
  ...Object.values(style.materials).map((m) => m.color),
  ...Object.values(style.looks).flatMap((g) => g.options.flatMap((o) => Object.values(o.set ?? {}).flatMap((s) => (s.color ? [s.color] : [])))),
];

describe("model/style.json", () => {
  it("is style/1 and has a material for every role of the GLB contract", () => {
    expect(style.schema).toBe("style/1");
    expect(Object.keys(style.materials).sort()).toEqual([...ROLES].sort());
  });

  it("describes every material with a colour, a roughness and a bilingual name", () => {
    for (const [role, m] of Object.entries(style.materials)) {
      expect(m.color, role).toMatch(HEX);
      expect(m.roughness, role).toBeGreaterThanOrEqual(0);
      expect(m.roughness, role).toBeLessThanOrEqual(1);
      expect(bilingual(m.name), role).toBe(true);
      for (const k of ["metallic", "alpha"] as const) if (m[k] !== undefined) expect(m[k]!, `${role}.${k}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("has the looks the web offers: façade 4, timber 4 (one of them 'no timber'), roof 3", () => {
    expect(Object.keys(style.looks).sort()).toEqual(["facade", "roof", "wood"]);
    expect(style.looks.facade.options).toHaveLength(4);
    expect(style.looks.wood.options).toHaveLength(4);
    expect(style.looks.roof.options).toHaveLength(3);
    // the 'no timber' variant is data (a substitution), not an id the code has to know
    expect(style.looks.wood.options.filter((o) => o.substitute)).toHaveLength(1);
  });

  it("gives every look group exactly one default, unique ids and bilingual names", () => {
    for (const [group, g] of Object.entries(style.looks)) {
      expect(bilingual(g.label), group).toBe(true);
      expect(g.options.filter((o) => o.default), group).toHaveLength(1);
      expect(new Set(g.options.map((o) => o.id)).size, group).toBe(g.options.length);
      for (const o of g.options) expect(bilingual(o.name), `${group}/${o.id}`).toBe(true);
    }
  });

  it("only touches roles that exist, with valid colours", () => {
    for (const g of Object.values(style.looks)) {
      for (const o of g.options) {
        for (const [role, s] of Object.entries(o.set ?? {})) {
          expect(style.materials[role], `${o.id} sets ${role}`).toBeDefined();
          if (s.color) expect(s.color).toMatch(HEX);
        }
        for (const [from, to] of Object.entries(o.substitute ?? {})) {
          expect(style.materials[from], `${o.id} substitutes ${from}`).toBeDefined();
          expect(style.materials[to], `${o.id} substitutes with ${to}`).toBeDefined();
        }
      }
    }
  });

  it("uses the default look as the base material colours", () => {
    for (const g of Object.values(style.looks)) {
      const d = g.options.find((o) => o.default)!;
      for (const [role, s] of Object.entries(d.set ?? {})) if (s.color) expect(style.materials[role].color, role).toBe(s.color);
    }
  });

  it("keeps the palette in step with the design tokens", () => {
    expect(style.palette.graphite).toBe(tokens["--ink"].light);
    expect(style.palette.ivory).toBe(tokens["--bg"].light);
    expect(style.palette.mint).toBe(tokens["--mint"].light);
  });

  it("has no orange, honey or terracotta", () => {
    expect(allColors().filter(isOrangeish)).toEqual([]);
  });
});
