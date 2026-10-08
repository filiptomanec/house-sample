// The project's house, derived once at import time. Pages import from here:
//   import { house, derived, metrics } from "@/lib/model/instance";
// The module is deliberately light (derive + metrics, no validator): the zod schema is about 100 KB gzipped and would travel to
// every page that shows a number of the house. Validity of the model is enforced by `npx tsx scripts/build-derived.ts`, the
// tests and CI; a test (src/lib/calc/__tests__/jsonIdentity.test.ts) also checks that parsing model/house.json with the schema
// returns the very same data, which is what makes the type assertion below safe. Do not import it from scripts that must work
// without JSON resolution (use `analyzeHouse` from "@/lib/model" there).
import houseJson from "../../../model/house.json";
import { derive } from "./derive";
import { computeMetrics } from "./metrics";
import type { House } from "./types";

export const house = houseJson as unknown as House;
export const derived = derive(house);
export const metrics = computeMetrics(house, derived);
