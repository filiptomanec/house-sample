// Public API of the house model kernel. See docs/KERNEL-API.md.
export * from "./catalog";
export { HouseSchema, houseJsonSchema } from "./schema";
export type * from "./types";
export { derive, roofInputs, assemblyU, azimuthInRange, type DeriveOptions } from "./derive";
export { computeMetrics, roofIntegrals } from "./metrics";
export { buildRoofFaces, faceContains, faceZAt, roofSurfaceAt, type RoofInput } from "./roofs";
export { layoutPv, type Obstacle, type PvSpec } from "./pv";
export { validateHouse, validateHouseJson, formatReport, ISSUE_CODES, type IssueCodeInfo, type ValidateOptions } from "./validate";
export { analyzeHouse, deriveAll, parseHouse, ModelError, type Analysis } from "./load";
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
