import { describe, expect, it } from "vitest";
import styleJson from "../../../model/style.json";
import { defaultLook, defaultOption, effectiveRole, generatedMaterial, resolveLook, type StyleModel } from "./style";

const style = styleJson as unknown as StyleModel;

describe("looks", () => {
  it("the default selection reproduces the base materials", () => {
    const sel = defaultLook(style);
    expect(Object.keys(sel).sort()).toEqual(Object.keys(style.looks).sort());
    const look = resolveLook(style, sel);
    expect(look.selection).toEqual(sel);
    expect(look.substitutions).toEqual({});
    for (const [role, m] of Object.entries(style.materials)) {
      // the default option equals the base material (docs/DESIGN.md section 9)
      expect(look.materials[role].color.toLowerCase(), role).toBe(m.color.toLowerCase());
      expect(look.materials[role].roughness, role).toBe(m.roughness);
    }
  });

  it("recolours exactly the roles of the chosen option", () => {
    for (const [key, group] of Object.entries(style.looks)) {
      for (const option of group.options.filter((o) => o.set)) {
        const look = resolveLook(style, { [key]: option.id });
        for (const [role, patch] of Object.entries(option.set!)) {
          if (patch.color) expect(look.materials[role].color, `${key}/${option.id}/${role}`).toBe(patch.color);
        }
        // roles outside every `set` of the chosen option keep their base colour
        // (the other groups sit at their defaults, which equal the base materials)
        const touched = new Set(Object.keys(option.set!));
        for (const r of Object.keys(style.materials).filter((role) => !touched.has(role))) {
          expect(look.materials[r].color.toLowerCase(), `${key}/${option.id}/${r}`).toBe(style.materials[r].color.toLowerCase());
        }
      }
    }
  });

  it("applies a substitution only for the option that declares it", () => {
    const [key, group] = Object.entries(style.looks).find(([, g]) => g.options.some((o) => o.substitute))!;
    const sub = group.options.find((o) => o.substitute)!;
    const look = resolveLook(style, { [key]: sub.id });
    for (const [role, other] of Object.entries(sub.substitute!)) {
      expect(look.substitutions[role]).toBe(other);
      expect(effectiveRole(look, role)).toBe(other);
    }
    const plain = resolveLook(style, { [key]: defaultOption(group).id });
    expect(plain.substitutions).toEqual({});
  });

  it("falls back to the defaults for unknown groups and stale ids", () => {
    const sel = defaultLook(style);
    const look = resolveLook(style, { nonsense: "x", [Object.keys(style.looks)[0]]: "no-such-option" });
    expect(look.selection).toEqual(sel);
  });

  it("does not modify the style", () => {
    const before = JSON.stringify(style);
    const [key, group] = Object.entries(style.looks)[0];
    resolveLook(style, { [key]: group.options[group.options.length - 1].id });
    expect(JSON.stringify(style)).toBe(before);
  });

  it("follows substitution chains and survives a cycle", () => {
    const look = { selection: {}, materials: {}, substitutions: { a: "b", b: "c" } };
    expect(effectiveRole(look, "a")).toBe("c");
    expect(effectiveRole({ ...look, substitutions: { a: "b", b: "a" } }, "a")).toMatch(/^[ab]$/);
    expect(effectiveRole(look, "z")).toBe("z");
  });

  it("generated materials fall back to a role of the style", () => {
    const m = generatedMaterial(style, "pv_cell-not-in-style", "frame");
    expect(m.color).toBe(style.materials.frame.color);
    expect(() => generatedMaterial(style, "x", "no-such-role")).toThrow();
  });
});
