// Convenience entry points for pages and scripts: parse / analyse a house model in one call.
import { derive } from "./derive";
import { computeMetrics } from "./metrics";
import { HouseSchema } from "./schema";
import type { Derived, House, Issue, Metrics } from "./types";
import { formatReport, validateHouse } from "./validate";

export class ModelError extends Error {
  readonly issues: Issue[];
  constructor(message: string, issues: Issue[]) {
    super(message);
    this.name = "ModelError";
    this.issues = issues;
  }
}

/** Parses a value as a house/1 model (structure only). Throws a ModelError with the list of problems. */
export function parseHouse(input: unknown): House {
  const r = HouseSchema.safeParse(input);
  if (r.success) return r.data;
  const res = validateHouse(input);
  throw new ModelError(`Invalid house model:\n${formatReport(res, "en")}`, res.errors);
}

export interface Analysis {
  house: House;
  derived: Derived;
  metrics: Metrics;
  warnings: Issue[];
}

/**
 * Validates a house model and derives geometry and metrics. Throws a ModelError when the model has errors
 * (warnings are returned). This is what pages call once at module level: `analyzeHouse(houseJson)`.
 */
export function analyzeHouse(input: unknown, options: { inputHash?: string | null } = {}): Analysis {
  const res = validateHouse(input, options);
  if (!res.valid || !res.house || !res.derived || !res.metrics) {
    throw new ModelError(`Invalid house model:\n${formatReport(res, "en")}`, res.errors);
  }
  return { house: res.house, derived: res.derived, metrics: res.metrics, warnings: res.warnings };
}

/** Derives geometry and metrics of an already parsed model without running the design rules. */
export function deriveAll(house: House, options: { inputHash?: string | null } = {}): { derived: Derived; metrics: Metrics } {
  const derived = derive(house, options);
  return { derived, metrics: computeMetrics(house, derived) };
}
