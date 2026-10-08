// TypeScript types of the house/1 model (inferred from the zod schema) and of the derived data (derive.ts output).
import type { z } from "zod";
import type {
  AccentSchema,
  AssemblySchema,
  CameraSchema,
  FurnitureSchema,
  HouseSchema,
  LayerSchema,
  OpeningSchema,
  OutdoorSchema,
  RoofSchema,
  RoomSchema,
  ScreenSchema,
} from "./schema";
import type { CameraUse, Dir, EdgeKind, Facing8, FloorKind, LocalizedText, OpeningKind, OutdoorSurface, OutdoorType, RoofAttic, RoomRole, RoomType, ZoneKey } from "./catalog";
import type { BBox, Pt, Pt3, Rect } from "./geom";
import type { Label } from "./polylabel";
import type { OutdoorGrade } from "./site/grading";
import type { SiteLayout } from "./site/export";

export type { CameraUse, Dir, EdgeKind, Facing8, FloorKind, LocalizedText, OpeningKind, OutdoorSurface, OutdoorType, RoofAttic, RoomRole, RoomType, ZoneKey, BBox, Pt, Pt3, Rect, Label };
export type Locale = "cs" | "en";

// ------------------------------------------------------------------ input model
export type House = z.infer<typeof HouseSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Roof = z.infer<typeof RoofSchema>;
export type Outdoor = z.infer<typeof OutdoorSchema>;
export type Accent = z.infer<typeof AccentSchema>;
export type FurnitureItem = z.infer<typeof FurnitureSchema>;
export type Screen = z.infer<typeof ScreenSchema>;
export type Assembly = z.infer<typeof AssemblySchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Camera = z.infer<typeof CameraSchema>;

// ------------------------------------------------------------------ derived data
export type WallKind = "exterior" | "bearing" | "partition";

export interface DerivedWall {
  id: string;
  orient: "h" | "v";
  /** Coordinate of the wall axis (y for "h", x for "v"). */
  at: number;
  from: number;
  to: number;
  len: number;
  kind: WallKind;
  ext: boolean;
  /** Thickness, m. */
  t: number;
  /** Rooms on the low side (smaller y or x) and the high side; null = outside. */
  lo: string | null;
  hi: string | null;
  // exterior walls only
  room?: string;
  /** House-frame azimuth of the outward normal (0 = house +y). */
  azimuth?: number;
  /** True azimuth of the outward normal. */
  azimuthTrue?: number;
  facing?: Facing8;
  /** Wall height (top of the wall under the roof), m. */
  height?: number;
  // interior walls only
  /** Set (true) on a wall between a heated and an unheated room (the wall to the garage; assembly `wallToUnheated` when given). */
  toUnheated?: true;
}

export interface Glazing {
  total: number;
  N: number;
  E: number;
  S: number;
  W: number;
}

export interface DerivedRoom {
  id: string;
  name: LocalizedText;
  /** `rooms[].shortName` of the model, else null (use `name`). */
  shortName: LocalizedText | null;
  /**
   * Room number for visitors: "1.01" (storey, then the order of a breadth-first walk through the doors from the room with
   * the main entrance; unreachable rooms follow in model order). Use it instead of the id everywhere on the site.
   */
  displayNo: string;
  type: RoomType;
  role?: RoomRole;
  zone: Exclude<ZoneKey, "outdoor">;
  floor?: FloorKind;
  heated: boolean;
  rects: Rect[];
  /** Net rectangles (wall thickness removed). */
  cleanRects: Rect[];
  /** Net floor area, m2. */
  area: number;
  /** Area between wall axes, m2. */
  axisArea: number;
  bbox: BBox | null;
  rectsClear: { rect: Rect; w: number; d: number }[];
  minWidth: number;
  mainClear: { w: number; d: number };
  glazing: Glazing;
  /** Ids of the openings in the room's walls. */
  openings: string[];
  /** Clear height, m, and net volume (area x clear height), m3. */
  height: number;
  volume: number;
  /** Best label position and the radius of the largest circle around it inside the room. */
  label: Label;
  /** Distance from the label point to the house outline. */
  outlineDistance: number;
  centroid: Pt;
  /** Length of exterior walls of the room (axis length) and their gross area, m / m2. */
  exteriorWallLength: number;
  exteriorWallArea: number;
}

export type OpeningProblem = "no-axis" | "off-wall" | "span";

export interface DerivedOpening {
  id: string;
  kind: OpeningKind;
  orient: "h" | "v";
  cx: number;
  cy: number;
  w: number;
  sill: number;
  head: number;
  swing: "+" | "-" | null;
  hinge: "+" | "-" | null;
  /** Position along the wall and wall axis coordinate. */
  c: number;
  axis: number;
  from: number;
  to: number;
  wallId: string | null;
  problem: OpeningProblem | null;
  exterior: boolean | null;
  wallKind: WallKind | null;
  /** House-frame azimuth of the outward normal (exterior openings). */
  azimuth: number | null;
  room: string | null;
  connects: [string | null, string | null] | null;
  swingRoom: string | null;
  /** Window or slider area w x (head - sill), m2; 0 for doors. */
  glazingArea: number;
  clearStart: number | null;
  clearEnd: number | null;
  // extensions
  azimuthTrue: number | null;
  facing: Facing8 | null;
  /** House-frame direction N/E/S/W the opening faces. */
  dir: Dir | null;
  /** Gross area w x (head - sill), m2. */
  area: number;
  /** Centre in 3D house coordinates (x, y, z of the middle of the opening). */
  center: Pt3 | null;
  /** Does the shading rule give this opening an external blind? */
  blind: boolean;
  /** Number of blind sections (shading.blinds.product.maxSectionWidth); 0 without a blind. */
  blindSections: number;
  /**
   * The roof in front of an exterior opening: `depth` is measured from the outer wall face at the centre of the head along the
   * outward normal to where the plan of the roofs ends (a covered terrace counts in full); `eaveHeight` is the height of the
   * shading edge there: the soffit (clear height) over a covered outdoor area, else the eave of the roof; `wallTop` of that roof (m).
   * Null for interior openings and for openings with no roof above.
   */
  overhang: { depth: number; eaveHeight: number; wallTop: number } | null;
}

export interface DerivedAccent extends Accent {
  wallId: string | null;
  exterior: boolean | null;
  problem: OpeningProblem | null;
  azimuth: number | null;
  azimuthTrue: number | null;
  facing: Facing8 | null;
}

export interface DerivedRoof {
  id: string;
  rect: Rect;
  pitch: number;
  overhang: number;
  wallTop: number;
  w: number;
  d: number;
  ridgeAlong: "x" | "y";
  ridgeLength: number;
  ridgeHeight: number;
  ridgeRise: number;
  ridge: [Pt, Pt];
  eaveRect: Rect;
  eaveHeight: number;
  planAreaWithOverhang: number;
  slopedArea: number;
  /** Ids of the roof faces that belong to this roof. */
  faces: string[];
}

export interface RoofEdge {
  kind: EdgeKind;
  /** Length in 3D, m. Edge i runs from vertex i to vertex i + 1 (cyclic). */
  length: number;
}

export interface RoofFrame {
  /** Origin on the eave line of the plane's group, house coordinates. */
  origin: Pt3;
  /** Unit vector along the eave (horizontal), looking up the slope from outside it points to the right. */
  u: Pt3;
  /** Unit vector up the slope. */
  v: Pt3;
  /** Unit normal, pointing up and out. */
  n: Pt3;
}

/**
 * A roof face: a convex polygon of one roof plane. A plane (`plane`, e.g. "T1.S") may be split into several faces
 * where another roof cuts it; all faces of a plane share the same frame, so (u, v) coordinates are comparable.
 */
export interface RoofFace {
  /** Unique id of the face ("T1.S", or "T2.E#2" when its plane has several faces). */
  id: string;
  /** Id of the plane this face belongs to ("<roofId>.<side>"). */
  plane: string;
  roofId: string;
  /** House-frame direction the slope descends to. */
  side: Dir;
  /** Slope angle, degrees. */
  pitch: number;
  /** House-frame azimuth of the downslope direction. */
  azimuth: number;
  azimuthTrue: number;
  /** PVGIS aspect convention: 0 = south, east negative, west positive (degrees, -180..180). */
  aspect: number;
  facing: Facing8;
  /** Counter-clockwise outline seen from above: plan points and 3D vertices (same order). */
  pts: Pt[];
  pts3: Pt3[];
  /** Local coordinates [u, v] of the vertices in `frame`. */
  uv: Pt[];
  edges: RoofEdge[];
  /** Sloped area and plan (horizontal) area, m2. */
  area: number;
  planArea: number;
  centroid: Pt3;
  zMin: number;
  zMax: number;
  frame: RoofFrame;
}

export interface PvPanel {
  id: string;
  plane: string;
  face: string;
  row: number;
  col: number;
  wp: number;
  /** Local rectangle [u0, v0, u1, v1] in the frame of the face. */
  uv: Rect;
  center: Pt3;
  /** Four corners, counter-clockwise seen from above. */
  corners: [Pt3, Pt3, Pt3, Pt3];
}

export interface PvLayout {
  moduleWp: number;
  panels: PvPanel[];
  count: number;
  /** Installed power, kWp, and module area, m2. */
  kwp: number;
  area: number;
  /** Panels per roof face: orientation used, panel count and the number of panels in each row (bottom to top). */
  byFace: { face: string; plane: string; orientation: "portrait" | "landscape"; count: number; rows: number[] }[];
}

/** Levels of an outdoor slab (see site/grading.ts): flat at `top`, or a ramp (drive, path) from `top` to the gate. */
export type DerivedGrade = OutdoorGrade;

/** GLB role of the top of an outdoor slab (docs/ARCHITECTURE.md section 3). */
export type OutdoorRole = "terrace_paving" | "deck" | "drive_paving" | "path" | "pool_coping";

export interface DerivedPool {
  /** Water surface (= `rect`), its level and the floor of the basin (m). */
  water: Rect;
  depth: number;
  waterBelowTop: number;
  coping: number;
  /** Top of the coping (= the outdoor top), the water level and the basin floor, m (absolute, house frame). */
  copingTop: number;
  waterZ: number;
  floorZ: number;
  /** Outer edge of the coping: the water grown by the coping width; the hole in the deck and in the terrain. */
  outer: Rect;
  /** Plan polygons: water, coping ring (outer and inner ring, counter-clockwise), the deck around it with the hole. */
  polygons: { water: Pt[]; copingOuter: Pt[]; copingInner: Pt[]; deck: { outer: Pt[]; hole: Pt[] } | null };
  /** Id of the deck or paving area the pool sits in (null when none: E-BAZEN). */
  deck: string | null;
  /** Water area (m2) and water volume (m3). */
  waterArea: number;
  waterVolume: number;
}

export interface DerivedOutdoor {
  id: string;
  type: OutdoorType;
  /** `outdoor[].name`, else null (use OUTDOOR_TYPE_NAMES). */
  name: LocalizedText | null;
  covered: boolean;
  rect: Rect;
  /** Rect area (m2), and the area without the cut-outs (`holes`). */
  area: number;
  netArea: number;
  /** Cut-outs: the pools (coping outer edge) that lie inside this area. */
  holes: Rect[];
  posts: Pt[];
  /** Side of the posts (m), null without posts. */
  postSize: number | null;
  zone: "outdoor";
  /** Finish and the GLB role of the slab top. */
  surface: OutdoorSurface;
  role: OutdoorRole;
  /** Top at the house end (m) and the levels of the slab (corner heights; drive and path are ramps when the site is known). */
  top: number;
  grade: DerivedGrade;
  /** Pool data (type pool only). */
  pool: DerivedPool | null;
}

export interface DerivedScreen {
  id: string;
  type: "slats";
  orient: "h" | "v";
  /** Axis position and extent along the screen. */
  at: number;
  from: number;
  to: number;
  length: number;
  /** Outward direction. */
  azimuth: number;
  azimuthTrue: number;
  facing: Facing8;
  /**
   * Blades (shading.slats): count = floor(length / pitch), spread evenly (effective pitch = length / count), centre positions
   * along the screen axis, chord (depth) and thickness (width), m.
   */
  blades: { count: number; pitch: number; chord: number; thickness: number; positions: number[] };
  /**
   * Angles of the blades from the wall plane (degrees): closed stop where neighbouring blades touch,
   * ceil5(asin(thickness / pitch)); open = 90 (square to the wall); rest = the static model and the default of the controls.
   */
  closedDeg: number;
  openDeg: number;
  restDeg: number;
  /** Bottom (top of the slab under the screen) and top (the soffit = clear height) of the blades, m. */
  z0: number;
  z1: number;
}

export interface DerivedCamera {
  id: string;
  name: LocalizedText;
  /** `cameras[].short`, else null (use `name`). */
  short: LocalizedText | null;
  kind: "perspective" | "orthographic";
  /** Position with the z resolved: ground + aboveGround when the camera has `aboveGround` and the site is known. */
  position: Pt3;
  target: Pt3;
  fov: number | null;
  orthoHeight: number | null;
  use: CameraUse[];
  default: boolean;
  defaultFor: string[];
  aboveGround: number | null;
  /** Graded ground under the camera (null without the site). */
  ground: number | null;
}

export interface DerivedLightpipe {
  x: number;
  y: number;
  diameter: number;
  /** Room below, roof face above and the roof surface height at the point. */
  room: string | null;
  face: string | null;
  z: number | null;
}

export interface DerivedFurniture {
  index: number;
  type: string;
  x: number;
  y: number;
  rot: number;
  w: number;
  d: number;
  rect: Rect;
  room: string | null;
  outdoor: string | null;
}

export interface DerivedAccess {
  entryOpening: string | null;
  entryRoom: string | null;
  /** Doors connecting rooms. */
  edges: { a: string; b: string; opening: string }[];
  /** Number of doors to pass from the entry room; unreachable rooms are absent. */
  depth: Record<string, number>;
  unreachable: string[];
}

export interface DerivedFacing {
  dir: Dir;
  houseAzimuthDeg: number;
  azimuthDeg: number;
  facing: Facing8;
  /** Length of exterior walls facing this way (axis length), gross wall area and opening areas, m / m2. */
  wallLength: number;
  wallArea: number;
  glazingArea: number;
  doorArea: number;
  /** Glazing area that gets an external blind. */
  blindedGlazingArea: number;
  /** Sloped area of roof faces descending this way. */
  roofArea: number;
}

export interface DerivedAssembly {
  /** Total thickness, m. */
  thickness: number;
  /** Resistance of the layers (without surface films) and U-value, m2K/W and W/(m2K). */
  R: number;
  U: number;
}

export interface Overlap {
  a: string;
  b: string;
  area: number;
  bbox: BBox | null;
  same: boolean;
}
export interface Hole {
  area: number;
  bbox: BBox | null;
}
export interface Component {
  rooms: string[];
  area: number;
}

export interface DerivedOutline {
  rects: Rect[];
  polygons: { pts: Pt[]; area: number }[];
  bbox: BBox | null;
  area: number;
  perimeter: number;
}

export interface DerivedBBox extends BBox {
  /** Lowest and highest point of the building (floor level to ridge), m. */
  z0: number;
  z1: number;
  h: number;
}

/** Output of `derive(house)`: the content of `generated/derived.json`. */
export interface Derived {
  schemaVersion: 1;
  /** Hash of model/*.json that this data was built from (set by scripts/build-derived.ts), else null. */
  inputHash: string | null;
  houseId: string;
  /** Bearing of the house +y axis from true north, degrees. */
  houseAxisBearingDeg: number;
  wall: { ext: number; bearing: number; part: number };
  defaultWallTop: number;
  grid: { xs: number[]; ys: number[] };
  overlaps: Overlap[];
  holes: Hole[];
  components: Component[];
  walls: DerivedWall[];
  rooms: DerivedRoom[];
  /** Compatibility views for the Blender pipeline: net room rectangles and the outer polygon. */
  netRooms: { id: string; type: RoomType; floor?: FloorKind; heated: boolean; rects: Rect[]; area: number }[];
  outer: { pts: Pt[]; area: number } | null;
  outline: DerivedOutline;
  bbox: DerivedBBox;
  openings: DerivedOpening[];
  accents: DerivedAccent[];
  roofs: DerivedRoof[];
  roofPlanes: RoofFace[];
  outdoor: DerivedOutdoor[];
  screens: DerivedScreen[];
  lightpipes: DerivedLightpipe[];
  furniture: DerivedFurniture[];
  access: DerivedAccess;
  facings: Record<Dir, DerivedFacing>;
  assemblies: Record<string, DerivedAssembly>;
  pv: PvLayout;
  // ---- extensions (R2)
  /** Roof build-up and the assembly that closes the heated volume at the top ("roof" for a warm roof, "ceiling" for a cold attic). */
  attic: RoofAttic;
  topEnvelope: "roof" | "ceiling";
  /** Cameras with resolved heights, in model order. */
  cameras: DerivedCamera[];
  /** Plan rects where the terrain has a hole (pool basins: the coping outer edge), from GROUND_VOID_OUTDOOR. */
  groundVoids: Rect[];
  /** Outdoor unit of the heat pump: plan footprint (corners counter-clockwise), size [w, d, h], rotation and the ground under it (null without the site). */
  outdoorUnit: { center: Pt; size: Pt3; rot: number; footprint: Pt[]; z: number | null } | null;
  /** Catalogue lists the pipeline needs (so Python never copies a list from TypeScript). */
  catalog: { groundVoidOutdoor: OutdoorType[]; sunSampledOutdoor: OutdoorType[]; waterOutdoor: OutdoorType[]; bedroomTypes: RoomType[] };
  /** The plot resolved for this house (null when derived without the site): fences, gates, pillars, street, trees, ... */
  site: SiteLayout | null;
}

export interface Metrics {
  id: string;
  name: LocalizedText;
  /** Net floor area without the garage (heated), garage floor area, m2. */
  netArea: number;
  garageArea: number;
  areaByType: Partial<Record<RoomType, number>>;
  roomCount: number;
  /** Footprint including the walls, m2, its bounding box and perimeter. */
  footprintArea: number;
  footprintBBox: { w: number; d: number };
  footprintPerimeter: number;
  /** Enclosed volume (floor to roof surface over the footprint), of which walls part and roof part, m3. */
  volume: number;
  volumeWalls: number;
  volumeRoof: number;
  /** Sloped roof area including overhangs / over the footprint only, m2. */
  roofArea: number;
  roofAreaOverFootprint: number;
  ridges: { id: string; height: number; length: number }[];
  ridgeMax: number | null;
  terraceCovered: number;
  terraceUncovered: number;
  outdoorByType: Partial<Record<OutdoorType, number>>;
  /** Window and slider area by house-frame direction. */
  glazing: Glazing;
  glazingRatio: number | null;
  envelopeArea: number;
  /** Surface to volume ratio A/V, 1/m. */
  envelopeToVolume: number | null;
  /** Sloped area of the roof faces descending south, and by direction. */
  roofSouthArea: number;
  roofAreaByAzimuth: { N: number; E: number; S: number; W: number };
  /** PV potential by the rule of thumb (south roof area x 18 % x 60 %), kWp. */
  pvKwp: number;
  // extensions
  pvLayoutKwp: number;
  pvModuleCount: number;
  /** Heated part: net floor area (m2) and volume (m3), length of its exterior walls (m), gross wall area, openings and opaque wall area (m2). */
  heated: { floorArea: number; volume: number; perimeter: number; wallGross: number; glazing: number; doors: number; wallOpaque: number };
  uValues: { exteriorWall: number; roof: number; groundFloor: number; windows: number };
  // ---- extensions (R2)
  /** Czech layout code: number of rooms of LAYOUT_ROOM_TYPES + "kk" (kitchen corner) or "1" (a separate kitchen): "5+kk". */
  layoutCode: string;
  /** Rooms of BEDROOM_TYPES. */
  bedroomCount: number;
  /** Built-up area (zastavěná plocha): the footprint plus the roofed outdoor areas outside it, m2. */
  builtUpArea: number;
  /** Net heated floor area (= heated.floorArea), m2. */
  heatedArea: number;
  /** Gross heated area (energy reference area): heated rooms to the outer face of the exterior walls and to the axis of the walls to unheated rooms, m2. */
  heatedAreaGross: number;
  /** Walls and doors between heated and unheated rooms: wall area without the doors, door area (clear height x length), m2. */
  unheatedBoundary: { wallArea: number; doorArea: number };
}

// ------------------------------------------------------------------ validation
export type Severity = "error" | "warning";

export interface Issue {
  code: string;
  severity: Severity;
  message: LocalizedText;
}

export interface ValidationResult {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Present when the structure is valid (geometry could be derived). */
  house: House | null;
  derived: Derived | null;
  metrics: Metrics | null;
}
