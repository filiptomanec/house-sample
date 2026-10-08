// Public API of the house model kernel. See docs/KERNEL-API.md.
export * from "./catalog";
export { HouseSchema, houseJsonSchema } from "./schema";
export type * from "./types";
export { derive, roofInputs, assemblyU, azimuthInRange, ceil5, exitDistance, louvreClosedDeg, outdoorRole, outdoorSurface, type DeriveOptions } from "./derive";
export { computeMetrics, heatedGrossArea, layoutCode, localized, roofIntegrals } from "./metrics";
export { buildRoofFaces, faceContains, faceZAt, roofSurfaceAt, type RoofInput } from "./roofs";
export { layoutPv, type Obstacle, type PvSpec } from "./pv";
export { validateHouse, validateHouseJson, formatReport, longGutterRuns, ISSUE_CODES, type IssueCodeInfo, type ValidateOptions } from "./validate";
export { analyzeHouse, deriveAll, derivedFile, parseHouse, ModelError, type Analysis, type DerivedFile } from "./load";
export { hashModelFiles, isHashedModelFile, sha256Hex, shortHash, type HashedFile } from "./hash";
export { pick, roomTypeName } from "./text";
export { poleOfInaccessibility } from "./polylabel";
export {
  doorSwing,
  facing8,
  furnitureRect,
  inRect,
  rectArea,
  rectHitsSwing,
  ringArea,
  ringCentroid,
  trueAzimuth,
  unionOf,
  wallBody,
  type DoorSwing,
} from "./geom";
