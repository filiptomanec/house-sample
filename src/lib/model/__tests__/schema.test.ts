// The model file, the exported JSON schema and the generated derived data agree with the code.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { derive } from "../derive";
import { HouseSchema, houseJsonSchema } from "../schema";
import { baseline, rawHouse, repoRoot } from "./helpers";

/** Same rounding as scripts/build-derived.ts. */
const stable = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x)));

describe("model/house.json", () => {
  it("is a valid house/1 document", () => {
    const r = HouseSchema.safeParse(rawHouse());
    expect(r.success).toBe(true);
  });

  it("keeps every key of concept/1 and adds the extensions", () => {
    const keys = Object.keys(rawHouse());
    for (const k of ["schema", "id", "name", "idea", "wall", "clearHeight", "slab", "bearingAxes", "rooms", "openings", "roofs", "outdoor", "accents", "furniture", "lightpipes", "screens", "notes"]) {
      expect(keys, k).toContain(k);
    }
    for (const k of ["fictional", "location", "zones", "assemblies", "windows", "equipment", "shading", "roof", "cameras"]) expect(keys, k).toContain(k);
  });

  it("is marked fictional and the location is the fictional region, rounded to 0.1 degree", () => {
    const { house } = baseline();
    expect(house.fictional).toBe(true);
    for (const v of [house.location.lat, house.location.lon]) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
  });

  it("has Czech and English text everywhere, with Czech typography", () => {
    const texts: { path: string; cs: string; en: string }[] = [];
    const walk = (v: unknown, p: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.cs === "string" && typeof o.en === "string" && Object.keys(o).length === 2) texts.push({ path: p, cs: o.cs, en: o.en });
        else for (const [k, x] of Object.entries(o)) walk(x, `${p}.${k}`);
      }
    };
    walk(rawHouse(), "$");
    expect(texts.length).toBeGreaterThan(50);
    for (const t of texts) {
      expect(t.cs.trim().length, t.path).toBeGreaterThan(0);
      expect(t.en.trim().length, t.path).toBeGreaterThan(0);
      // a single-letter Czech preposition or conjunction is followed by a no-break space, units are glued to the number
      expect(/(^|[\s(])[vVkKsSzZoOuUaAiI] \S/.test(t.cs), `${t.path}: ${t.cs}`).toBe(false);
      expect(/\d (mm|m|m²|m2|kWh|kW|kWp|W|°|%)(?![\p{L}])/u.test(t.cs), `${t.path}: ${t.cs}`).toBe(false);
    }
    // texts differ between the languages unless they are language-neutral (digits, one word, a proper symbol)
    const same = texts.filter((t) => t.cs === t.en && /\s/.test(t.cs));
    expect(same.map((t) => t.path)).toEqual([]);
  });

  it("room ids, opening ids and so on are unique and rooms carry names in both languages", () => {
    const { house } = baseline();
    expect(new Set(house.rooms.map((r) => r.id)).size).toBe(house.rooms.length);
    expect(new Set(house.openings.map((o) => o.id)).size).toBe(house.openings.length);
    for (const r of house.rooms) {
      expect(r.name.cs).not.toBe(r.name.en);
    }
  });
});

describe("generated files are fresh", () => {
  it("model/house.schema.json equals the schema exported from the code", () => {
    const file = path.join(repoRoot, "model", "house.schema.json");
    expect(fs.existsSync(file), "run: npx tsx scripts/build-derived.ts").toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(stable(houseJsonSchema()));
  });

  it("the exported JSON schema describes the house: required sections, closed objects", () => {
    const js = JSON.parse(fs.readFileSync(path.join(repoRoot, "model", "house.schema.json"), "utf8")) as {
      $schema: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { type?: string }>;
    };
    expect(js.$schema).toContain("json-schema.org");
    expect(js.additionalProperties).toBe(false);
    for (const k of ["schema", "rooms", "openings", "roofs", "assemblies", "equipment", "location"]) expect(js.required).toContain(k);
    expect(js.properties.rooms.type).toBe("array");
  });

  it("generated/derived.json equals derive(house.json) (apart from the input hash)", () => {
    const file = path.join(repoRoot, "generated", "derived.json");
    expect(fs.existsSync(file), "run: npx tsx scripts/build-derived.ts").toBe(true);
    const committed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const fresh = stable(derive(baseline().house)) as Record<string, unknown>;
    expect(typeof committed.inputHash).toBe("string");
    expect((committed.inputHash as string).length).toBe(64);
    delete committed.inputHash;
    delete fresh.inputHash;
    expect(committed).toEqual(fresh);
  });
});
