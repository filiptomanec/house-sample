// Constants of the house/1 format: enumerations, furniture catalogue, opening limits, minimum areas.
// Pure data, no logic; the zod schema, the validator and the deriver all read from here.

export const SCHEMA_ID = "house/1" as const;
export const DERIVED_SCHEMA_VERSION = 1 as const;

export type LocalizedText = { cs: string; en: string };

export const ROOM_TYPES = [
  "hall", "living", "kitchen", "dining", "bedroom", "kids", "office", "guest", "bath", "wc",
  "wardrobe", "utility", "pantry", "garage", "storage", "corridor", "technical",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** Optional semantic tags of a room. Code may branch on a role (never on an id). */
export const ROOM_ROLES = [
  "main-living", "entry", "primary-bedroom", "primary-bath", "primary-wardrobe", "children",
  "family-bath", "guest-wc", "home-office", "plant", "pantry", "garage", "night-corridor",
] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

export const FLOORS = ["oak", "tile", "concrete", "stone"] as const;
export type FloorKind = (typeof FLOORS)[number];

export const OPENING_KINDS = ["window", "door", "entry", "garage", "slider"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

export const OUTDOOR_TYPES = ["terrace", "paving", "drive", "path"] as const;
export type OutdoorType = (typeof OUTDOOR_TYPES)[number];

export const ZONE_KEYS = ["day", "night", "service", "outdoor"] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];

/** Compass names of the four house-frame directions (house +y is "N", +x is "E"). */
export const DIRS = ["N", "E", "S", "W"] as const;
export type Dir = (typeof DIRS)[number];
export const DIR_AZIMUTH: Record<Dir, number> = { N: 0, E: 90, S: 180, W: 270 };
export const AZ_KEYS: Record<number, Dir> = { 0: "N", 90: "E", 180: "S", 270: "W" };

export const FACINGS8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Facing8 = (typeof FACINGS8)[number];

/** Kinds of edges of a roof face. */
export const EDGE_KINDS = ["eave", "ridge", "hip", "valley", "step", "seam"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const LAYER_ROLES = ["finish", "insulation", "structure", "cladding", "air", "membrane", "screed"] as const;
export type LayerRole = (typeof LAYER_ROLES)[number];

export const CAMERA_USES = ["web", "render", "og"] as const;

// Room groups used by the validator.
/** Habitable rooms (daylight check). */
export const HABITABLE: readonly RoomType[] = ["living", "kitchen", "dining", "bedroom", "kids", "office", "guest"];
/** Rooms that may have no window. */
export const WINDOWLESS_OK: readonly RoomType[] = [
  "bath", "wc", "wardrobe", "utility", "pantry", "storage", "corridor", "hall", "garage", "technical",
];
/** Private rooms: must not be a transit route to other rooms. */
export const PRIVATE_TYPES: readonly RoomType[] = ["bedroom", "kids", "guest", "bath", "wc", "wardrobe"];
/** Rooms that are not heated (excluded from the net heated floor area). */
export const UNHEATED_TYPES: readonly RoomType[] = ["garage"];

/** Recommended minimum net floor areas (m2), warnings only. */
export const MIN_AREA: Partial<Record<RoomType, number>> = {
  living: 30, bedroom: 12, kids: 11, office: 8, guest: 8, bath: 4.5, wc: 1.2,
  wardrobe: 3, utility: 4, hall: 6, pantry: 2, garage: 32,
};

/** Minimum clear size of a garage in both directions (m): two cars. */
export const GARAGE_MIN_CLEAR = 5.5;

/** Opening size limits (m): [min, max]. */
export const OPENING_LIMITS: Record<OpeningKind, { sill: [number, number]; head: [number, number]; w: [number, number] }> = {
  window: { sill: [0.6, 1.2], head: [0, 2.4], w: [0.4, 6] },
  door: { sill: [0, 0], head: [2.0, 2.4], w: [0.8, 1.0] },
  entry: { sill: [0, 0], head: [2.2, 2.4], w: [1.0, 1.3] },
  garage: { sill: [0, 0], head: [2.2, 2.4], w: [2.4, 5.0] },
  slider: { sill: [0, 0], head: [2.2, 2.4], w: [1.8, 4.5] },
};

/** Furniture catalogue: footprint w x d (m) at rot 0; the "back" (bed head, sofa back, wall side) faces +y. */
export const FURNITURE = {
  bed160: { w: 1.6, d: 2.0, name: { cs: "Postel 160", en: "Bed 160" } },
  bed180: { w: 1.8, d: 2.0, name: { cs: "Postel 180", en: "Bed 180" } },
  bed90: { w: 0.9, d: 2.0, name: { cs: "Postel 90", en: "Bed 90" } },
  sofaL: { w: 2.9, d: 1.9, name: { cs: "Sedačka do L", en: "L-shaped sofa" } },
  sofa3: { w: 2.2, d: 0.95, name: { cs: "Pohovka", en: "Sofa" } },
  armchair: { w: 0.85, d: 0.85, name: { cs: "Křeslo", en: "Armchair" } },
  tv: { w: 1.6, d: 0.4, name: { cs: "Televize", en: "TV unit" } },
  table6: { w: 1.8, d: 0.9, name: { cs: "Stůl pro šest", en: "Table for six" } },
  table8: { w: 2.4, d: 1.0, name: { cs: "Stůl pro osm", en: "Table for eight" } },
  chair: { w: 0.45, d: 0.45, name: { cs: "Židle", en: "Chair" } },
  island: { w: 2.8, d: 1.0, name: { cs: "Kuchyňský ostrov", en: "Kitchen island" } },
  kitchenLine: { w: 3.0, d: 0.62, name: { cs: "Kuchyňská linka", en: "Kitchen run" } },
  fridge: { w: 0.7, d: 0.7, name: { cs: "Lednice", en: "Fridge" } },
  wardrobe: { w: 1.0, d: 0.6, name: { cs: "Skříň", en: "Wardrobe" } },
  desk: { w: 1.4, d: 0.7, name: { cs: "Pracovní stůl", en: "Desk" } },
  shelf: { w: 1.0, d: 0.35, name: { cs: "Regál", en: "Shelving" } },
  wc: { w: 0.4, d: 0.7, name: { cs: "WC", en: "Toilet" } },
  sink: { w: 0.6, d: 0.5, name: { cs: "Umyvadlo", en: "Washbasin" } },
  sink2: { w: 1.2, d: 0.5, name: { cs: "Dvojumyvadlo", en: "Double washbasin" } },
  shower: { w: 0.9, d: 0.9, name: { cs: "Sprchový kout", en: "Shower" } },
  bath: { w: 1.7, d: 0.75, name: { cs: "Vana", en: "Bathtub" } },
  washer: { w: 0.6, d: 0.6, name: { cs: "Pračka", en: "Washing machine" } },
  car: { w: 4.7, d: 1.9, name: { cs: "Auto", en: "Car" } },
  lounger: { w: 0.7, d: 2.0, name: { cs: "Lehátko", en: "Lounger" } },
  swingbed: { w: 2.0, d: 1.4, name: { cs: "Závěsné lehátko", en: "Hanging daybed" } },
  grill: { w: 1.0, d: 0.6, name: { cs: "Gril", en: "Grill" } },
  bench: { w: 1.5, d: 0.4, name: { cs: "Lavice", en: "Bench" } },
} as const satisfies Record<string, { w: number; d: number; name: LocalizedText }>;
export type FurnitureType = keyof typeof FURNITURE;
export const FURNITURE_TYPES = Object.keys(FURNITURE) as [FurnitureType, ...FurnitureType[]];

export const ROOM_TYPE_NAMES: Record<RoomType, LocalizedText> = {
  hall: { cs: "hala", en: "hall" },
  living: { cs: "obytný prostor", en: "living space" },
  kitchen: { cs: "kuchyně", en: "kitchen" },
  dining: { cs: "jídelna", en: "dining room" },
  bedroom: { cs: "ložnice", en: "bedroom" },
  kids: { cs: "dětský pokoj", en: "children's room" },
  office: { cs: "pracovna", en: "study" },
  guest: { cs: "pokoj pro hosty", en: "guest room" },
  bath: { cs: "koupelna", en: "bathroom" },
  wc: { cs: "WC", en: "toilet" },
  wardrobe: { cs: "šatna", en: "wardrobe" },
  utility: { cs: "technická místnost", en: "utility room" },
  pantry: { cs: "spíž", en: "pantry" },
  garage: { cs: "garáž", en: "garage" },
  storage: { cs: "sklad", en: "storage" },
  corridor: { cs: "chodba", en: "corridor" },
  technical: { cs: "technická místnost", en: "plant room" },
};

export const OUTDOOR_TYPE_NAMES: Record<OutdoorType, LocalizedText> = {
  terrace: { cs: "Terasa", en: "Terrace" },
  paving: { cs: "Zpevněná plocha", en: "Paved area" },
  drive: { cs: "Vjezd", en: "Driveway" },
  path: { cs: "Chodník", en: "Footpath" },
};

export const DIR_NAMES: Record<Dir, LocalizedText> = {
  N: { cs: "severní", en: "north" },
  E: { cs: "východní", en: "east" },
  S: { cs: "jižní", en: "south" },
  W: { cs: "západní", en: "west" },
};

// Rules of thumb for a low-energy house (not a code citation): U-values above these raise a warning, W/m2K.
export const U_LIMITS = { exteriorWall: 0.2, roof: 0.15, groundFloor: 0.25 } as const;

// Tolerances.
/** Position tolerance of an opening on a wall axis (m). */
export const AXIS_TOL = 0.01;
/** Tolerance of an assembly thickness against the wall/slab thickness in the plan (m). */
export const THICKNESS_TOL = 0.005;

// Rule-of-thumb PV potential used by the legacy metric `pvKwp`: module efficiency x usable share of the roof plane.
export const PV_EFFICIENCY_ESTIMATE = 0.18;
export const PV_ROOF_USABLE_SHARE = 0.6;
