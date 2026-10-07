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

const fence = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["plinth_fence", "wood_fence", "mesh_fence"]),
  from: boundaryRef,
  to: boundaryRef,
  inset: z.number().min(0),
  height: positive,
  thickness: positive,
  /** Cut openings where the driveway and walkway cross it. */
  gates: z.boolean(),
});

const bed = z.strictObject({ id: z.string().min(1), kind: z.enum(["mulch", "gravel"]), polygon: z.array(xy).min(3) });

const paved = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["garden_path", "service_path", "pad"]),
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
    note: z.string().optional(),
  }),
  terrain: terrainSchema,
  street: z.strictObject({ edge: z.number().int().min(0), verge: positive, carriageway: positive, kerbHeight: z.number().min(0) }),
  /** Open field beyond the given edge (rendered as agricultural ground). */
  field: z.strictObject({ edge: z.number().int().min(0), depth: positive }),
  access: z.strictObject({
    /** Outdoor `type` in house.json that carries the driveway / walkway; the site extends it to the street. */
    /** The gate opening is as wide as the paved strip plus a post margin on each side; `flare` widens the apron across the verge. */
    driveway: z.strictObject({ outdoorType: z.string().min(1), gateMargin: z.number().min(0), flare: z.number().min(0) }),
    walkway: z.strictObject({ outdoorType: z.string().min(1), gateMargin: z.number().min(0) }),
  }),
  /** Terrain and zone polygons are generated around the plot with this margin (m). */
  domain: z.strictObject({ margin: positive }),
  species: z.record(z.string(), species),
  trees: z.array(tree),
  shrubs: z.array(shrub),
  hedges: z.array(hedge),
  fences: z.array(fence),
  beds: z.array(bed),
  paved: z.array(paved),
  neighbours: z.array(neighbour),
});

export type SiteModel = z.infer<typeof siteSchema>;
export type TerrainModel = z.infer<typeof terrainSchema>;
export type SpeciesModel = z.infer<typeof species>;
export type TreeModel = z.infer<typeof tree>;
export type ShrubModel = z.infer<typeof shrub>;
export type HedgeModel = z.infer<typeof hedge>;
export type FenceModel = z.infer<typeof fence>;
export type BedModel = z.infer<typeof bed>;
export type PavedModel = z.infer<typeof paved>;
export type NeighbourModel = z.infer<typeof neighbour>;
export type BoundaryRef = z.infer<typeof boundaryRef>;

/** Parses and validates the raw JSON; throws a ZodError with paths on failure. */
export const parseSite = (raw: unknown): SiteModel => siteSchema.parse(raw);
