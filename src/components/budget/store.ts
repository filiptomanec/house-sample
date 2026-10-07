// What the Budget page keeps in the browser: the switches, the reserve and the edited numbers, saved together with a
// fingerprint of the model's quantities, so that edits made for another model are dropped instead of applied to it.
import { defaultBudgetSettings, sanitizeBudgetSettings, type BudgetSettings } from "@/lib/calc/budgetCompute";
import { quantityFingerprintParts, type Pricebook, type Quantities } from "@/lib/calc/budgetCore";
import { clearStored, fingerprint, readStored, writeStored } from "@/lib/calc/storageKeys";

/** Fingerprint of the model-dependent quantities (the PV choice is left out: it has its own store and must not wipe the edits). */
export function budgetFingerprint(base: Quantities): string {
  return fingerprint(quantityFingerprintParts(base));
}

/** True when the settings are the book's own choice (nothing worth keeping). */
export function isDefaultSettings(s: BudgetSettings, book: Pricebook): boolean {
  const d = defaultBudgetSettings(book);
  return s.reserve === d.reserve && Object.keys(s.overrides).length === 0 && Object.entries(d.groups).every(([id, on]) => s.groups[id] === on);
}

/** The saved settings for this model, or null when nothing usable is saved. Browser only, after mount. */
export function loadBudgetSettings(book: Pricebook, fp: string): BudgetSettings | null {
  return readStored("budget", { parse: (data) => sanitizeBudgetSettings(data, book), fingerprint: fp });
}

/** Saves the settings; the book's own choice removes the entry instead. */
export function saveBudgetSettings(settings: BudgetSettings, book: Pricebook, fp: string): void {
  if (isDefaultSettings(settings, book)) clearStored("budget");
  else writeStored("budget", settings, { fingerprint: fp });
}

/**
 * One edit of one field of one line. A value equal to the computed one, or `null`, removes the edit (the overhead line then
 * follows the work again); other values replace it. Negative or non-finite numbers are ignored.
 */
export function withOverride(settings: BudgetSettings, lineId: string, field: "quantity" | "price", value: number | null, computed: number): BudgetSettings {
  if (value !== null && !(Number.isFinite(value) && value >= 0)) return settings;
  const current = { ...settings.overrides[lineId] };
  if (value === null || Math.abs(value - computed) <= 1e-9 * Math.max(1, Math.abs(computed))) delete current[field];
  else current[field] = value;
  const overrides = { ...settings.overrides };
  if (current.quantity === undefined && current.price === undefined) delete overrides[lineId];
  else overrides[lineId] = current;
  return { ...settings, overrides };
}
