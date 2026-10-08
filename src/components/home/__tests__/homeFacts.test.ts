// What the start page states about the house: invariants of the model and independent sums, never numbers of this particular house.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { derived, house, metrics } from "@/lib/model/instance";
import { homeFacts, ZONE_ORDER, ZONE_TOKEN } from "../homeFacts";

const PLOT = 1234.5;
const facts = homeFacts(house, derived, metrics, PLOT);
const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

describe("homeFacts", () => {
  it("counts the rooms and passes the plot area through", () => {
    expect(facts.roomCount).toBe(derived.rooms.length);
    expect(facts.plotArea).toBe(PLOT);
  });

  it("splits the rooms into the zones without losing or adding floor area", () => {
    const roomZones = facts.zones.filter((z) => z.key !== "outdoor");
    expect(sum(roomZones.map((z) => z.area))).toBeCloseTo(sum(derived.rooms.map((r) => r.area)), 9);
    // the heated net area plus the garage is every room
    expect(sum(roomZones.map((z) => z.area))).toBeCloseTo(metrics.netArea + metrics.garageArea, 1) // metrics are rounded to centimetres of area;
    for (const z of roomZones) {
      const own = derived.rooms.filter((r) => r.zone === z.key);
      expect(z.area).toBeCloseTo(sum(own.map((r) => r.area)), 9);
    }
  });

  it("lists the four zones in a fixed order, labelled by the model except the terrace", () => {
    expect(facts.zones.map((z) => z.key)).toEqual([...ZONE_ORDER]);
    for (const z of facts.zones) {
      if (z.key === "outdoor") expect(z.label).toBeNull();
      else expect(z.label).toEqual(house.zones[z.key].label);
    }
  });

  it("takes the terrace from the outdoor areas of the model", () => {
    const outdoor = facts.zones.find((z) => z.key === "outdoor")!;
    const terraces = derived.outdoor.filter((o) => o.type === "terrace");
    expect(outdoor.area).toBeCloseTo(sum(terraces.map((o) => o.area)), 1);
    expect(facts.terrace.area).toBeCloseTo(outdoor.area, 9);
    expect(facts.terrace.covered).toBeLessThanOrEqual(facts.terrace.area + 1e-9);
    expect(facts.terrace.covered).toBeCloseTo(sum(terraces.filter((o) => o.covered).map((o) => o.area)), 1);
  });

  it("knows the zone of every room (the key joins the drawing to the model)", () => {
    expect(Object.keys(facts.zoneOfRoom).sort()).toEqual(derived.rooms.map((r) => r.id).sort());
    for (const r of derived.rooms) expect(facts.zoneOfRoom[r.id]).toBe(r.zone);
  });

  it("describes the highest roof", () => {
    expect(facts.roof).not.toBeNull();
    expect(facts.roof!.ridgeHeight).toBeCloseTo(metrics.ridgeMax!, 1); // metrics are rounded
    expect(derived.roofs.every((r) => r.ridgeHeight <= facts.roof!.ridgeHeight + 1e-9)).toBe(true);
    const own = derived.roofs.find((r) => r.ridgeHeight === facts.roof!.ridgeHeight)!;
    expect(facts.roof!.pitchDeg).toBe(own.pitch);
    expect(facts.roof!.overhang).toBe(own.overhang);
  });

  it("finds the facade of the garage door and of the entrance by the kind of opening", () => {
    const garage = derived.openings.find((o) => o.kind === "garage" && o.exterior)!;
    const entry = derived.openings.find((o) => o.kind === "entry" && o.exterior)!;
    expect(facts.garage).toEqual({ area: metrics.garageArea, side: garage.dir });
    expect(facts.entrySide).toBe(entry.dir);
  });

  it("states no garage and no roof when the model has none", () => {
    const none = homeFacts(house, { ...derived, roofs: [], openings: derived.openings.filter((o) => o.kind !== "garage" && o.kind !== "entry") }, { ...metrics, garageArea: 0 }, PLOT);
    expect(none.garage).toBeNull();
    expect(none.roof).toBeNull();
    expect(none.entrySide).toBeNull();
  });

  it("reads the outer dimensions from the footprint", () => {
    expect(facts.footprint).toEqual({ w: metrics.footprintBBox.w, d: metrics.footprintBBox.d });
    expect(facts.footprint.w * facts.footprint.d).toBeGreaterThanOrEqual(metrics.footprintArea - 1e-9);
  });

  it("takes the glossary's usable area, the layout code and the bedroom count from the metrics", () => {
    expect(facts.heatedArea).toBe(metrics.heatedArea);
    expect(facts.layoutCode).toBe(metrics.layoutCode);
    expect(facts.bedroomCount).toBe(metrics.bedroomCount);
    expect(facts.layoutCode).toMatch(/^\d+\+(kk|1)$/);
  });

  it("states the pool, the panels, the louvres and the drive by type and kind", () => {
    const pool = derived.outdoor.find((o) => o.pool);
    expect(facts.pool).toEqual(pool?.pool ? { area: pool.pool.waterArea, depth: pool.pool.depth } : null);
    expect(facts.pv).toEqual(derived.pv.count ? { count: derived.pv.count, kwp: derived.pv.kwp } : null);
    expect(facts.louvres).toBe(derived.screens.length > 0);
    expect(facts.driveToGate).toBe(derived.outdoor.some((o) => o.type === "drive" && o.grade.ramp !== null));
    const none = homeFacts(house, { ...derived, outdoor: derived.outdoor.filter((o) => !o.pool && o.type !== "drive"), screens: [], pv: { ...derived.pv, count: 0, panels: [] } }, metrics, PLOT);
    expect([none.pool, none.pv, none.louvres, none.driveToGate]).toEqual([null, null, false, false]);
  });

  it("uses design tokens that exist", () => {
    const css = readFileSync(join(__dirname, "..", "..", "..", "styles", "tokens.css"), "utf8");
    for (const token of Object.values(ZONE_TOKEN)) expect(css).toContain(`${token}:`);
  });
});
