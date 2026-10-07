// The project's house, parsed and derived once at import time. Pages import from here:
//   import { house, derived, metrics } from "@/lib/model/instance";
// The module is deliberately light (schema parse + derive + metrics, no validator): validity of the model is enforced by
// `npx tsx scripts/build-derived.ts`, the tests and CI. Do not import it from scripts that must work without JSON
// resolution (use `analyzeHouse` from "@/lib/model" there).
import houseJson from "../../../model/house.json";
import { derive } from "./derive";
import { computeMetrics } from "./metrics";
import { HouseSchema } from "./schema";

export const house = HouseSchema.parse(houseJson);
export const derived = derive(house);
export const metrics = computeMetrics(house, derived);
