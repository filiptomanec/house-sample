// Types of generated/render-inputs.json (schema "render-inputs/1"). Field meanings: docs/RENDER-INPUTS.md.
// House frame, metres, degrees. Texts are {cs, en}.
import type { Fov } from "./render-camera";
import type { Vec2, Vec3 } from "./render-schema";

export type Text = { cs: string; en: string };
export type Poly = [number, number][];

export interface SunInfo {
  azimuthTrueDeg: number;
  azimuthHouseDeg: number;
  /** Apparent elevation (refraction included). */
  elevationDeg: number;
  elevationGeomDeg: number;
  /** Unit vector towards the sun, house frame. */
  direction: Vec3;
  phase: "night" | "astronomical" | "nautical" | "civil" | "golden" | "day";
  blender: { sunElevationRad: number; sunRotationRad: number };
}

export interface TimeInfo {
  date: string;
  local: string;
  iso: string;
  utc: string;
  utcOffsetMinutes: number;
}

export interface CameraOut {
  position: Vec3;
  target: Vec3;
  forward: Vec3;
  up: Vec3;
  roll: number;
  focalMm: number;
  sensorWidthMm: number;
  shift: Vec2;
  near: number;
  far: number;
  fov: Fov;
  /** The viewing axis is horizontal; `shift` includes the vertical shift that keeps the target in place. */
  level: boolean;
  /** Ground height under the camera (graded terrain) and the eye height above it, m. */
  groundZ: number;
  aboveGround: number;
}

export interface LightLevels {
  mode: string;
  interior: number;
  exterior: number;
}

export interface BlindState {
  /** 0 = raised (only the box), 1 = lowered over the whole opening. */
  drop: number;
  /** 0 = slats horizontal (open) .. 90 = closed; a tilted slat has its OUTER edge lower (like every real external blind). */
  slatAngleDeg: number;
  /** Direct clear-sky irradiance on the sunlit part of the glazing (W/m2, roof-edge shade removed) used by the rule. */
  irradiance: number;
}

/** Angle of the louvre walls of a shot: `angleDeg` of the first wall (the common one) and one entry per `screens[i]`. */
export interface ScreenState {
  mode: string;
  angleDeg: number;
  items: { angleDeg: number }[];
}

/** Open fraction of the gates of a shot (0 closed, 1 open). */
export interface GateState {
  driveway: number;
  walkway: number;
}

export interface SunScreen {
  x: number;
  y: number;
  inFrame: boolean;
  /**
   * The sun disc can be seen from the camera: in the frame, above the horizon and not hidden by the roof that covers the
   * camera (a camera under an eave sees only the sun that is lower than the eave edge). Neighbouring buildings and trees
   * are not considered.
   */
  visible: boolean;
}

export interface Shot {
  id: string;
  file: string;
  size: [number, number];
  time: TimeInfo;
  camera: CameraOut;
  sun: SunInfo;
  lights: LightLevels;
  blinds: BlindState[];
  sunScreen: SunScreen | null;
  gates: GateState;
  /** Open fraction of the garage doors (0 closed, 1 raised). */
  garageDoor: number;
  screens: ScreenState;
  /** Feature words that must be visible (render.json `subjects`), for the framing tests. */
  subjects: string[];
}

export interface StillShot extends Shot {
  label: Text;
  alt: Text;
  category: "exterior" | "interior" | "evening" | "aerial";
  notes?: string;
}

export interface DayFrame {
  index: number;
  id: string;
  file: string;
  time: TimeInfo;
  sun: SunInfo;
  lights: LightLevels;
  blinds: BlindState[];
  sunScreen: SunScreen | null;
  gates: GateState;
  garageDoor: number;
  screens: ScreenState;
  /** The same moment for the phone camera (`day.portrait`): its file and where the sun is on that image. */
  portrait: { file: string; sunScreen: SunScreen | null };
}

/** A feature the home page names while the orbit plays, with the frames in which its caption shows. */
export interface OrbitCaption {
  feature: string;
  /** House azimuth of the feature seen from the orbit target (outdoor areas) or of its facing (openings, roof planes). */
  azimuthDeg: number;
  /** A point of the feature (for visibility checks) and its outward normal (null for areas seen from every side). */
  point: [number, number, number];
  normal: [number, number, number] | null;
  /** Frame indexes (of the full loop) in which the camera azimuth is within `halfWindowDeg` of `azimuthDeg`. */
  frames: number[];
}

export interface OrbitFrame {
  index: number;
  /** 0..scrollCount-1 for every scrollStep-th frame, else null. */
  scrollIndex: number | null;
  /** Azimuth (house frame, degrees) of the direction from the target to the camera. */
  angleDeg: number;
  /** Elevation of the camera seen from the target (the variant's elevation plus the lifts), degrees. */
  elevationDeg: number;
  /** Horizontal distance from the orbit target (m). */
  radius: number;
  file: string;
  camera: CameraOut;
}

export interface OrbitVariant {
  id: string;
  size: [number, number];
  frameSelection: "all" | "scroll";
  /** Margin used to fit the building box into the frame (fraction of the half size; negative = may be cropped). */
  fitMargin: number;
  radiusMin: number;
  radiusMax: number;
  elevationDeg: number;
  focalMm: number;
  fov: Fov;
  frames: OrbitFrame[];
}
