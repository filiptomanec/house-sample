// zod schema of model/site.json (format "site/1"). Self-contained: does not import the house schema.
// All coordinates are in the house frame (metres from the house origin, x east, y north), heights relative to +-0.000.
import { z } from "zod";

const xy = z.tuple([z.number(), z.number()]);
const rect = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const bilingual = z.strictObject({ cs: z.string().min(1), en: z.string().min(1) });
const positive = z.number().positive();

/** A position on the plot boundary: edge i runs from vertex i to vertex i + 1, t in [0, 1] along it. */
const boundaryRef = z.strictObject({ edge: z.number().int().min(0), t: z.number().min(0).max(1) });

export const edgeKinds = ["street", "neighbour", "field"] as const;
export type EdgeKind = (typeof edgeKinds)[number];

const wave = z.strictObject({
  amplitude: positive,
  wavelength: positive,
  directionDeg: z.number(),
  phaseDeg: z.number(),
});

export const terrainSchema = z.strictObject({
  zeroLevelAsl: z.number(),
  plane: z.strictObject({
    origin: xy,
    z0: z.number(),
    slopeSouthPct: z.number(),
    slopeWestPct: z.number(),
  }),
  waves: z.array(wave).max(6),
  noise: z.strictObject({ seed: z.number().int(), amplitude: z.number().min(0), wavelength: positive, octaves: z.number().int().min(1).max(4).optional() }).optional(),
  plateau: z.strictObject({ level: z.number(), rects: z.array(rect).min(1), blend: positive }),
});

const species = z.strictObject({
  latin: z.string().min(1),
  name: bilingual,
  kind: z.enum(["tree", "shrub", "hedge"]),
  evergreen: z.boolean(),
  /** Light extinction per metre inside the crown or hedge (for shading analysis). */
  extinction: z.strictObject({ leafOn: z.number().min(0), leafOff: z.number().min(0) }),
});

const tree = z.strictObject({
  id: z.string().min(1),
  species: z.string().min(1),
  pos: xy,
  /** Total height (m) and crown diameter (m). */
  height: positive,
  crown: positive,
  /** Height of the crown base above the ground (m); default 0.3 x height. */
  crownBase: z.number().min(0).optional(),
  /** Garden light: the tree gets ground uplights after dusk. */
  uplight: z.boolean().optional(),
});

const shrub = z.strictObject({
  id: z.string().min(1),
  species: z.string().min(1),
  pos: xy,
  height: positive,
  width: positive,
});

const hedge = z.strictObject({
  id: z.string().min(1),
  species: z.string().min(1),
  height: positive,
  width: positive,
  from: boundaryRef,
  to: boundaryRef,
  /** Distance of the hedge axis from the boundary into the plot (m). */
  inset: z.number().min(0),
});

export const fenceKinds = ["plinth_fence", "wood_fence", "mesh_fence", "slat_fence"] as const;
export type FenceKind = (typeof fenceKinds)[number];

const fence = z
  .strictObject({
    id: z.string().min(1),
    kind: z.enum(fenceKinds),
    /** Start and end on the boundary; a fence may run over several edges (it follows the vertex order of the plot). */
    from: boundaryRef,
    to: boundaryRef,
    inset: z.number().min(0),
    /** Total height above the ground, plinth included (m), and the depth of the fence body (m). */
    height: positive,
    thickness: positive,
    /** Cut openings where the driveway and walkway cross it (gates and pillars stand in them). */
    gates: z.boolean(),
    /** slat_fence: height of the precast plinth above the ground (m). */
    plinthHeight: z.number().min(0).optional(),
    /** slat_fence: boards, horizontal ("h") or vertical ("v"): board width, gap between boards, board thickness (m). */
    slat: z.strictObject({ orient: z.enum(["h", "v"]), board: positive, gap: z.number().min(0), depth: positive }).optional(),
    /** slat_fence: side of the square posts and their largest spacing (m). */
    postSize: positive.optional(),
    postSpacing: positive.optional(),
  })
  .superRefine((f, ctx) => {
    if (f.kind !== "slat_fence") return;
    for (const k of ["plinthHeight", "slat", "postSize", "postSpacing"] as const) {
      if (f[k] === undefined) ctx.addIssue({ code: "custom", path: [k], message: 'required for kind "slat_fence"' });
    }
  });

/** Which access a gate or pillar belongs to. */
export const accessKinds = ["driveway", "walkway"] as const;
export type AccessKind = (typeof accessKinds)[number];

/**
 * A gate in the fence where an access crosses it. `side` is relative to the direction of the plot edge (vertex i to i + 1):
 * "+" towards the end of the edge, "-" towards its start. Sliding: the leaf parks on that side, behind the fence on the plot
 * side. Swing: the hinge is on that side and the leaf opens into the plot.
 */
const gate = z.strictObject({
  id: z.string().min(1),
  access: z.enum(accessKinds),
  kind: z.enum(["sliding", "swing"]),
  /** Width of the leaf = clear opening between the gate posts (m). The fence opening is leaf + 2 x postSize. */
  leaf: positive,
  height: positive,
  /** Side of the two square gate posts (m). */
  postSize: positive,
  side: z.enum(["+", "-"]),
  /** Sliding only: counterbalance tail of a self-supporting leaf, behind the post on the park side (m). Default 0. */
  tail: z.number().min(0).optional(),
  /** Depth of the leaf frame (m). Default 0.06. */
  thickness: positive.optional(),
});

/** Things a technical pillar beside a gate can carry. */
export const pillarItems = ["meter-box", "mailbox", "intercom", "house-number", "light"] as const;
export type PillarItem = (typeof pillarItems)[number];

/** A technical pillar beside a gate (meter box, mailbox, intercom, house number, light). */
const pillar = z.strictObject({
  id: z.string().min(1),
  access: z.enum(accessKinds),
  /** Side of the gate it stands on (relative to the edge direction, as for gates). */
  side: z.enum(["+", "-"]),
  /** Width along the fence, depth across it, height (m). */
  size: z.tuple([positive, positive, positive]),
  items: z.array(z.enum(pillarItems)),
});

const bed = z.strictObject({ id: z.string().min(1), kind: z.enum(["mulch", "gravel"]), polygon: z.array(xy).min(3) });

const paved = z.strictObject({
  id: z.string().min(1),
  /** `bins` is the bin pad beside the gate pillar (renderers place two bins on it). */
  kind: z.enum(["garden_path", "service_path", "pad", "bins"]),
  /** Surface material role (matches the GLB / style roles). */
  surface: z.enum(["path", "gravel", "drive_paving", "terrace_paving"]),
  polygon: z.array(xy).min(3),
});

const neighbour = z.strictObject({
  id: z.string().min(1),
  /** The plot edge shared with this neighbour (their plot extends outward from it). */
  edge: z.number().int().min(0),
  /** How far their plot extends along the street and the field edge (m). */
  plotWidth: positive,
  house: z.strictObject({
    center: xy,
    /** Size along the local x and y axes before rotation (m). */
    size: z.tuple([positive, positive]),
    /** Rotation, degrees counter-clockwise. */
    rotDeg: z.number(),
    /** Height of the wall top above their ground (m). */
    eaveHeight: positive,
    roof: z.strictObject({ kind: z.enum(["hip", "gable", "flat"]), pitchDeg: z.number().min(0).max(70), overhang: z.number().min(0).max(2) }),
  }),
});

export const siteSchema = z.strictObject({
  schema: z.literal("site/1"),
  /** The plot is invented; this flag is shown on the website. */
  fictional: z.literal(true),
  name: bilingual,
  /** Pointer only: the source of truth for latitude, longitude, elevation and axis bearing is house.json. */
  location: z.strictObject({ source: z.literal("house.json#/location") }),
  plot: z.strictObject({
    /** Counter-clockwise ring (no repeated end point). */
    polygon: z.array(xy).min(3),
    /** edges[i] describes the edge from vertex i to vertex i + 1. */
    edges: z.array(z.strictObject({ kind: z.enum(edgeKinds) })),
  }),
  limits: z.strictObject({ maxBuiltUpRatio: z.number().min(0).max(1), minGreenRatio: z.number().min(0).max(1) }),
  setbackRules: z.strictObject({
    /** House wall to any boundary (m). */
    minToBoundary: positive,
    /** Free length in front of the garage door to the street boundary (m). */
    minToStreetAtDriveway: positive,
    /** Roof edge (eaves) to any boundary (m). */
    minRoofEdgeToBoundary: z.number().min(0),
    minTreeTrunkToHouse: z.number().min(0),
    minCrownEdgeToHouse: z.number().min(0),
    /** Tree crown edge to the water of a pool (m; leaves and nuts in the water). Checked when the house has a pool. */
    minCrownEdgeToPool: z.number().min(0).optional(),
    note: z.string().optional(),
  }),
  terrain: terrainSchema,
  street: z.strictObject({
    edge: z.number().int().min(0),
    /** Public strip between the plot boundary and the carriageway (m): the pavement next to the kerb, the rest is green. */
    verge: positive,
    carriageway: positive,
    kerbHeight: z.number().min(0),
    /** Width of the pavement along the kerb (m, part of the verge); default 0 (all green). */
    pavement: z.number().min(0).optional(),
    /** Width of the kerb stones (m); default 0.15. Dropped kerbs at the drive and walk crossings have a 0.02 m reveal. */
    kerbWidth: positive.optional(),
  }),
  /** Open field beyond the given edge (rendered as agricultural ground). */
  field: z.strictObject({ edge: z.number().int().min(0), depth: positive }),
  access: z.strictObject({
    /** Outdoor `type` in house.json that carries the driveway / walkway; the site extends it to the street. */
    /** The gate opening is as wide as the paved strip plus a post margin on each side; `flare` widens the apron across the verge. */
    /** `gateWidth` (optional) fixes the opening of a crossing without a gate; else strip width + 2 x gateMargin. */
    driveway: z.strictObject({ outdoorType: z.string().min(1), gateMargin: z.number().min(0), flare: z.number().min(0), gateWidth: positive.optional() }),
    walkway: z.strictObject({ outdoorType: z.string().min(1), gateMargin: z.number().min(0), gateWidth: positive.optional() }),
  }),
  /** Terrain and zone polygons are generated around the plot with this margin (m). */
  domain: z.strictObject({ margin: positive }),
  species: z.record(z.string(), species),
  trees: z.array(tree),
  shrubs: z.array(shrub),
  hedges: z.array(hedge),
  fences: z.array(fence),
  /** Gates in the fences (at most one per access) and technical pillars beside them. */
  gates: z.array(gate).optional(),
  pillars: z.array(pillar).optional(),
  beds: z.array(bed),
  paved: z.array(paved),
  neighbours: z.array(neighbour),
  /** Rainwater retention tank (underground): plan centre, volume (m3), diameter (m) and where the overflow goes. */
  rainwater: z
    .strictObject({ tank: z.strictObject({ pos: xy, volumeM3: positive, diameter: positive, overflow: z.enum(["soakaway", "sewer"]) }) })
    .optional(),
});

export type SiteModel = z.infer<typeof siteSchema>;
export type TerrainModel = z.infer<typeof terrainSchema>;
export type SpeciesModel = z.infer<typeof species>;
export type TreeModel = z.infer<typeof tree>;
export type ShrubModel = z.infer<typeof shrub>;
export type HedgeModel = z.infer<typeof hedge>;
export type FenceModel = z.infer<typeof fence>;
export type GateModel = z.infer<typeof gate>;
export type PillarModel = z.infer<typeof pillar>;
export type BedModel = z.infer<typeof bed>;
export type PavedModel = z.infer<typeof paved>;
export type NeighbourModel = z.infer<typeof neighbour>;
export type BoundaryRef = z.infer<typeof boundaryRef>;

/** Parses and validates the raw JSON; throws a ZodError with paths on failure. */
export const parseSite = (raw: unknown): SiteModel => siteSchema.parse(raw);
