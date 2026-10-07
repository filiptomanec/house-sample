// Mutation tests of the validator: the unchanged model is clean, and every issue code is provoked at least once by a
// mutation of the model. Mutations are derived from the model itself (no hard-coded coordinates of the house).
import { describe, expect, it } from "vitest";
import { GARAGE_MIN_CLEAR, OPENING_LIMITS } from "../catalog";
import { doorSwing, unionOf } from "../geom";
import { ISSUE_CODES, formatReport, validateHouse, validateHouseJson } from "../validate";
import type { House, Opening, Room } from "../types";
import { baseline, cloneHouse } from "./helpers";

const { house: base, derived: d } = baseline();
const seen = new Set<string>();

interface Result {
  errors: string[];
  warnings: string[];
}
function run(mut: (h: House) => void): Result {
  const h = cloneHouse();
  mut(h);
  const r = validateHouse(h);
  for (const x of [...r.errors, ...r.warnings]) {
    seen.add(x.code);
    // every message exists in both languages
    expect(x.message.cs.length, x.code).toBeGreaterThan(5);
    expect(x.message.en.length, x.code).toBeGreaterThan(5);
    expect(x.message.cs, x.code).not.toBe(x.message.en);
  }
  return { errors: r.errors.map((x) => x.code), warnings: r.warnings.map((x) => x.code) };
}
const wantError = (code: string, mut: (h: House) => void): void => {
  expect(run(mut).errors).toContain(code);
};
const wantWarning = (code: string, mut: (h: House) => void): void => {
  const r = run(mut);
  expect(r.warnings).toContain(code);
};

// ---- lookups in the model (by type / kind / role, never by id)
const room = (h: House, pred: (r: Room) => boolean): Room => h.rooms.find(pred)!;
const opening = (h: House, pred: (o: Opening) => boolean): Opening => h.openings.find(pred)!;
const roomIdWhere = (pred: (r: (typeof d.rooms)[number]) => boolean): string => d.rooms.find(pred)!.id;
const derivedOpening = (id: string) => d.openings.find((o) => o.id === id)!;
const removeOpenings = (h: House, pred: (o: Opening) => boolean): void => {
  h.openings = h.openings.filter((o) => !pred(o));
};
const mainLivingId = roomIdWhere((r) => r.role === "main-living");

describe("the unchanged model", () => {
  it("is valid and clean", () => {
    const r = validateHouse(base);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.derived).not.toBeNull();
    expect(r.metrics).not.toBeNull();
  });
  it("produces a report in both languages", () => {
    const r = validateHouse(base);
    expect(formatReport(r, "cs")).toContain("VÝSLEDEK: v pořádku");
    expect(formatReport(r, "en")).toContain("RESULT: OK");
  });
});

describe("structure", () => {
  it("E-JSON", () => {
    const r = validateHouseJson('{ "schema": ');
    expect(r.errors.map((x) => x.code)).toEqual(["E-JSON"]);
    seen.add("E-JSON");
    expect(r.derived).toBeNull();
  });
  it("E-SCHEMA", () => wantError("E-SCHEMA", (h) => ((h as { schema: string }).schema = "concept/1")));
  it("E-TYP: bad enum, bad number, missing swing, unknown key, missing section, non-object root", () => {
    wantError("E-TYP", (h) => ((h.rooms[0] as { type: string }).type = "sauna"));
    wantError("E-TYP", (h) => ((h.openings[0] as { w: unknown }).w = "wide"));
    wantError("E-TYP", (h) => delete (opening(h, (o) => o.kind === "door") as { swing?: string }).swing);
    wantError("E-TYP", (h) => ((h as unknown as Record<string, unknown>).surprise = 1));
    wantError("E-TYP", (h) => delete (h as { windows?: unknown }).windows);
    wantError("E-TYP", (h) => ((h.furniture[0] as { rot: number }).rot = 45));
    const r = validateHouse(42);
    expect(r.errors.map((x) => x.code)).toContain("E-TYP");
    expect(r.house).toBeNull();
  });
  it("a structural error stops the geometry", () => {
    const h = cloneHouse();
    (h.rooms[0] as { type: string }).type = "sauna";
    const r = validateHouse(h);
    expect(r.derived).toBeNull();
    expect(r.metrics).toBeNull();
    expect(r.valid).toBe(false);
  });
  it("E-ID", () => wantError("E-ID", (h) => (h.rooms[1].id = h.rooms[0].id)));
  it("E-ID in nested lists (layers)", () => wantError("E-ID", (h) => (h.assemblies.roof.layers[1].id = h.assemblies.roof.layers[0].id)));
  it("E-RECT", () =>
    wantError("E-RECT", (h) => {
      const r = h.rooms[0].rects[0];
      h.rooms[0].rects[0] = [r[2], r[1], r[0], r[3]];
    }));
  it("E-LOKACE (privacy: coordinates are rounded to 0.1 degree)", () => {
    wantError("E-LOKACE", (h) => (h.location.lat = base.location.lat + 0.03));
    wantError("E-LOKACE", (h) => (h.location.lon = base.location.lon + 0.07));
  });
  it("E-ZONA", () => {
    const type = h0().rooms[0].type;
    wantError("E-ZONA", (h) => {
      for (const z of ["day", "night", "service"] as const) h.zones[z].types = h.zones[z].types.filter((t) => t !== type);
    });
    wantError("E-ZONA", (h) => h.zones.night.types.push(...h.zones.day.types.slice(0, 1)));
    wantError("E-ZONA", (h) => (h.zones.outdoor.types = []));
  });
  it("E-ROLE", () =>
    wantError("E-ROLE", (h) => {
      h.rooms[0].role = "main-living";
      h.rooms[1].role = "main-living";
    }));
  it("E-SKLADBA", () => {
    wantError("E-SKLADBA", (h) => (h.assemblies.exteriorWall.layers[0].t += 0.05));
    wantError("E-SKLADBA", (h) => (h.assemblies.partitionWall.layers[0].t += 0.05));
    wantError("E-SKLADBA", (h) => h.assemblies.ceiling.layers.forEach((l) => l.role === "structure" && (l.t += 0.05)));
  });
});

function h0(): House {
  return cloneHouse();
}

describe("plan", () => {
  it("E-PREKRYV: a room extended into its neighbour", () => {
    const w = d.walls.find((x) => !x.ext && x.orient === "v")!;
    wantError("E-PREKRYV", (h) => {
      const lo = h.rooms.find((r) => r.id === w.lo)!;
      for (const q of lo.rects) if (Math.abs(q[2] - w.at) < 1e-6) q[2] += 0.4;
    });
  });
  it("E-DIRA: a ring of rooms around an empty block", () => {
    wantError("E-DIRA", (h) => {
      const t = h.rooms[0];
      h.rooms = [{ ...t, id: "X1", rects: [[0, 0, 6, 2], [0, 4, 6, 6], [0, 2, 2, 4], [4, 2, 6, 4]] }];
    });
  });
  it("E-NESOUVISLY: two rooms touching only at a corner", () => {
    wantError("E-NESOUVISLY", (h) => {
      const [a, b] = h.rooms;
      h.rooms = [
        { ...a, id: "X1", rects: [[0, 0, 4, 4]] },
        { ...b, id: "X2", rects: [[4, 4, 8, 8]] },
      ];
    });
  });
  it("E-MISTNOST: a room thinner than its walls", () =>
    wantError("E-MISTNOST", (h) => {
      const r = h.rooms[0].rects[0];
      h.rooms[0].rects[0] = [r[0], r[1], r[0] + 0.1, r[3]];
    }));
  it("E-GARAZ-ROZMER", () =>
    wantError("E-GARAZ-ROZMER", (h) => {
      const g = room(h, (r) => r.type === "garage");
      const clear = d.rooms.find((r) => r.type === "garage")!.mainClear;
      g.rects[0][2] -= Math.max(0, clear.w - GARAGE_MIN_CLEAR) + 0.3; // the clear width drops below the minimum
    }));
  it("V-PLOCHA: the smallest room declared as a living space", () => {
    const smallest = [...d.rooms].sort((a, b) => a.area - b.area)[0].id;
    wantWarning("V-PLOCHA", (h) => (h.rooms.find((r) => r.id === smallest)!.type = "living"));
  });
  it("V-CHODBA: a narrower corridor", () =>
    wantWarning("V-CHODBA", (h) => {
      const c = room(h, (r) => r.type === "corridor");
      c.rects[0][0] += 0.3;
    }));
  it("V-UZKA: a narrow study", () =>
    wantWarning("V-UZKA", (h) => {
      const o = room(h, (r) => r.type === "office");
      o.rects[0][2] = o.rects[0][0] + 1.0;
    }));
  it("V-PRUCHOD: some bath/wardrobe/wc turned into a plain room behind a private room", () => {
    let hit = false;
    for (const r of base.rooms.filter((x) => ["bath", "wc", "wardrobe"].includes(x.type))) {
      if (run((h) => (h.rooms.find((q) => q.id === r.id)!.type = "storage")).warnings.includes("V-PRUCHOD")) hit = true;
    }
    expect(hit).toBe(true);
  });
});

describe("openings", () => {
  it("E-OTVOR-ZED: off the wall axis", () =>
    wantError("E-OTVOR-ZED", (h) => {
      const o = opening(h, (x) => x.kind === "window");
      if (o.orient === "h") o.cy += 0.37;
      else o.cx += 0.37;
    }));
  it("E-OTVOR-ZED: beyond the end of the wall", () =>
    wantError("E-OTVOR-ZED", (h) => {
      const o = opening(h, (x) => x.kind === "window");
      if (o.orient === "h") o.cx += 100;
      else o.cy += 100;
    }));
  it("E-OTVOR-DRUH: a window in an interior wall, a door in an exterior wall, a slider in an interior wall", () => {
    wantError("E-OTVOR-DRUH", (h) => (opening(h, (x) => x.kind === "door").kind = "window"));
    wantError("E-OTVOR-DRUH", (h) => {
      const o = opening(h, (x) => x.kind === "window");
      o.kind = "door";
      o.swing = "+";
      o.hinge = "+";
    });
    wantError("E-OTVOR-DRUH", (h) => (opening(h, (x) => x.kind === "door").kind = "slider"));
  });
  it("E-OTVOR-ROZMER: width, sill, head, clear height", () => {
    wantError("E-OTVOR-ROZMER", (h) => (opening(h, (x) => x.kind === "slider").w = OPENING_LIMITS.slider.w[1] + 0.1));
    wantError("E-OTVOR-ROZMER", (h) => (opening(h, (x) => x.kind === "window").sill = OPENING_LIMITS.window.sill[0] - 0.5));
    wantError("E-OTVOR-ROZMER", (h) => (opening(h, (x) => x.kind === "door").head = OPENING_LIMITS.door.head[1] + 0.2));
    wantError("E-OTVOR-ROZMER", (h) => (opening(h, (x) => x.kind === "entry").w = OPENING_LIMITS.entry.w[0] - 0.2));
    wantError("E-OTVOR-ROZMER", (h) => (opening(h, (x) => x.kind === "window").head = opening(h, (x) => x.kind === "window").sill + 0.1));
  });
  it("E-OTVOR-ROH: a window pushed into the corner", () => {
    // the window on the longest exterior wall that carries one
    const ext = d.walls.filter((w) => w.ext && d.openings.some((o) => o.wallId === w.id && o.kind === "window")).sort((a, b) => b.len - a.len)[0];
    const win = d.openings.find((o) => o.wallId === ext.id && o.kind === "window")!;
    wantError("E-OTVOR-ROH", (h) => {
      const o = h.openings.find((x) => x.id === win.id)!;
      const c = ext.from + 0.25 + 0.05 + win.w / 2;
      if (o.orient === "h") o.cx = c;
      else o.cy = c;
    });
  });
  it("E-OTVOR-OTVOR: two windows on top of each other", () =>
    wantError("E-OTVOR-OTVOR", (h) => {
      const o = opening(h, (x) => x.kind === "window");
      h.openings.push({ ...o, id: "Wdup" });
    }));
  it("E-OBKLAD: cladding on an interior wall", () => {
    const w = d.walls.find((x) => !x.ext && x.orient === "h")!;
    wantError("E-OBKLAD", (h) => {
      Object.assign(h.accents[0], { orient: "h", cy: w.at, cx: (w.from + w.to) / 2, w: Math.min(1, w.len / 2) });
    });
    wantError("E-OBKLAD", (h) => (h.accents[0].cx += 100));
  });
  it("E-ZASKLENI: no glazing in the main living space", () =>
    wantError("E-ZASKLENI", (h) => removeOpenings(h, (o) => derivedOpening(o.id).room === mainLivingId && derivedOpening(o.id).glazingArea > 0)));
  it("V-ZASKLENI: glazing between 10 % and 12.5 % of the floor", () => {
    const bed = d.rooms.find((r) => r.type === "bedroom")!;
    wantWarning("V-ZASKLENI", (h) => {
      const wins = h.openings.filter((o) => derivedOpening(o.id).room === bed.id && o.kind === "window");
      removeOpenings(h, (o) => wins.slice(1).some((x) => x.id === o.id));
      wins[0].w = (0.11 * bed.area) / (wins[0].head - wins[0].sill);
    });
  });
  it("V-JIH and V-OBYTNA", () => {
    wantWarning("V-JIH", (h) => removeOpenings(h, (o) => derivedOpening(o.id).room === mainLivingId && derivedOpening(o.id).dir === "S"));
    wantWarning("V-OBYTNA", (h) => {
      for (const r of h.rooms) {
        if (r.type === "living") {
          r.type = "kitchen";
          delete r.role;
        }
      }
    });
  });
  it("V-SEVER: a bedroom or children's room glazed to the north only", () => {
    const cand = d.rooms.find((r) => (r.type === "bedroom" || r.type === "kids") && r.glazing.N > 0 && r.glazing.total > r.glazing.N)!;
    wantWarning("V-SEVER", (h) => removeOpenings(h, (o) => derivedOpening(o.id).room === cand.id && derivedOpening(o.id).dir !== "N"));
  });
  it("V-BEZ-OKNA: a study without windows", () => {
    const office = roomIdWhere((r) => r.type === "office");
    wantWarning("V-BEZ-OKNA", (h) => removeOpenings(h, (o) => derivedOpening(o.id).room === office && derivedOpening(o.id).glazingArea > 0));
  });
  it("E-VSTUP, V-VICE-VSTUPU", () => {
    wantError("E-VSTUP", (h) => removeOpenings(h, (o) => o.kind === "entry"));
    wantWarning("V-VICE-VSTUPU", (h) => {
      const o = opening(h, (x) => x.kind === "entry");
      h.openings.push({ ...o, id: "Edup", cx: o.cx - 0.3 });
    });
  });
  it("E-DOSTUPNOST: a room without doors", () => {
    const deepest = Object.entries(d.access.depth).sort((a, b) => b[1] - a[1])[0][0];
    wantError("E-DOSTUPNOST", (h) => removeOpenings(h, (o) => o.kind === "door" && ((derivedOpening(o.id).connects ?? []) as (string | null)[]).includes(deepest)));
  });
  it("V-GARAZ-VRATA: garage without a door", () => wantWarning("V-GARAZ-VRATA", (h) => removeOpenings(h, (o) => o.kind === "garage")));
});

describe("roofs, outdoor areas, furniture", () => {
  it("E-STRECHA: no roof, a roof that misses a wall", () => {
    wantError("E-STRECHA", (h) => (h.roofs = []));
    wantError("E-STRECHA", (h) => (h.roofs[0].rect = [h.roofs[0].rect[0] + 3, h.roofs[0].rect[1], h.roofs[0].rect[2], h.roofs[0].rect[3]]));
  });
  it("E-TERASA: a covered area outside every roof", () =>
    wantError("E-TERASA", (h) => h.outdoor.push({ id: "OX", type: "terrace", covered: true, rect: [100, 100, 102, 102], posts: [[100, 100]] })));
  it("V-TERASA-SLOUPY and V-SLOUP-MIMO", () => {
    wantWarning("V-TERASA-SLOUPY", (h) => (h.outdoor.find((o) => o.covered)!.posts = []));
    wantWarning("V-SLOUP-MIMO", (h) => h.outdoor.find((o) => o.covered)!.posts!.push([100, 100]));
  });
  it("V-VENKU-DUM: an outdoor area inside the house", () => {
    const [cx, cy] = [...d.rooms].sort((a, b) => b.area - a.area)[0].centroid;
    wantWarning("V-VENKU-DUM", (h) => (h.outdoor[0].rect = [cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5]));
  });
  it("V-STRECHA-VYSKA and V-STRECHA-PRESAH", () => {
    wantWarning("V-STRECHA-VYSKA", (h) => (h.roofs[0].wallTop = 1));
    wantWarning("V-STRECHA-PRESAH", (h) => (h.roofs[0].overhang = 2));
  });
  it("V-NABYTEK-MIMO: furniture far away", () => wantWarning("V-NABYTEK-MIMO", (h) => (h.furniture[0].x += 100)));
  it("V-NABYTEK-DVERE: a chair inside the swing of a door", () => {
    const door = d.openings.find((o) => o.kind === "door" && o.problem === null)!;
    const sw = doorSwing(door, d.walls.find((w) => w.id === door.wallId)!.t)!;
    // a point inside the quarter circle: 0.3 m from the hinge towards the leaf end and 0.3 m towards the closed end
    const ux = (sw.leafEnd[0] - sw.hinge[0]) / sw.radius;
    const uy = (sw.leafEnd[1] - sw.hinge[1]) / sw.radius;
    const vx = (sw.closedEnd[0] - sw.hinge[0]) / sw.radius;
    const vy = (sw.closedEnd[1] - sw.hinge[1]) / sw.radius;
    wantWarning("V-NABYTEK-DVERE", (h) => h.furniture.push({ type: "chair", x: sw.hinge[0] + 0.3 * (ux + vx), y: sw.hinge[1] + 0.3 * (uy + vy), rot: 0 }));
  });
});

describe("extensions of house/1", () => {
  it("V-IDEA", () => wantWarning("V-IDEA", (h) => delete h.idea));
  it("V-U-ZED, V-U-STRECHA, V-U-PODLAHA: too little insulation", () => {
    const thin = (a: House["assemblies"]["roof"]): void => a.layers.forEach((l) => l.role === "insulation" && (l.t = 0.01));
    wantWarning("V-U-ZED", (h) => thin(h.assemblies.exteriorWall));
    wantWarning("V-U-STRECHA", (h) => thin(h.assemblies.roof));
    wantWarning("V-U-PODLAHA", (h) => thin(h.assemblies.groundFloor));
  });
  it("V-FVE-NULA: modules larger than the roof", () => wantWarning("V-FVE-NULA", (h) => (h.equipment.pv.module.width = 50)));
  it("V-SVETLOVOD-MIMO", () => wantWarning("V-SVETLOVOD-MIMO", (h) => h.lightpipes.push([-50, -50])));
  it("V-SVOD-UDOLI: no downpipe at a valley", () => wantWarning("V-SVOD-UDOLI", (h) => (h.roof.downpipes = [])));
});

describe("coverage of the code registry", () => {
  it("every registered code was provoked by a mutation above", () => {
    const missing = Object.keys(ISSUE_CODES).filter((c) => !seen.has(c));
    expect(missing).toEqual([]);
  });
  it("only registered codes are reported", () => {
    for (const c of seen) expect(Object.keys(ISSUE_CODES)).toContain(c);
  });
  it("the registry has Czech and English titles and the right prefixes", () => {
    for (const [code, info] of Object.entries(ISSUE_CODES)) {
      expect(info.title.cs.length).toBeGreaterThan(3);
      expect(info.title.en.length).toBeGreaterThan(3);
      expect(code.startsWith(info.severity === "error" ? "E-" : "V-")).toBe(true);
    }
  });
  it("net room geometry used by the mutations is sane", () => {
    expect(unionOf(d.rooms.flatMap((r) => r.cleanRects)).area).toBeGreaterThan(0);
  });
});
