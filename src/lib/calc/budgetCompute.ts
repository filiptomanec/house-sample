// Bill of quantities and indicative budget, part 2: the visitor's settings, the totals and the CSV. Pure functions of the
// price book, the quantities and the settings; no storage, no text of its own. Contract: docs/CALC-API.md, section 8.
import type { Locale } from "@/lib/i18n/config";
import { ruleQuantity, type Pricebook, type Quantities, type QuantityKey, type UnitKey } from "./budgetCore";

// ================================================================================================ settings

/** The visitor's edits; what the Budget page stores (with the fingerprint of the quantities, see storageKeys.ts). */
export interface BudgetSettings {
  /** Contingency share, within `pricebook.reserve` min..max. */
  reserve: number;
  /** State of the optional groups by group id (missing = `defaultOn`). Groups that are not optional are always on. */
  groups: Record<string, boolean>;
  /** Edited quantity and/or unit price per line id (also for the site-overhead line). Absent field = the computed value. */
  overrides: Record<string, { quantity?: number; price?: number }>;
}

/** The book's own choice: default reserve, every optional group in its default state, no edits. */
export function defaultBudgetSettings(book: Pricebook): BudgetSettings {
  const groups: Record<string, boolean> = {};
  for (const g of book.groups) if (g.optional) groups[g.id] = g.defaultOn;
  return { reserve: book.reserve.default, groups, overrides: {} };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** An edit is a finite number from 0 to a trillion (a typo guard: the products stay far from overflow). */
const okEdit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e12;
/** Rounds away binary noise so that a stored 0.07 stays 0.07 (idempotent for values on the step grid). */
const clean = (v: number): number => Math.round(v * 1e9) / 1e9;

/**
 * Turns anything (saved JSON) into valid settings for this book: unknown group and line ids are dropped, non-finite and
 * negative numbers are dropped, the reserve is clamped to its range and snapped to its step, empty override objects are
 * removed, switches of groups that are not optional are ignored, missing switches take the group's default. Idempotent, never throws.
 */
export function sanitizeBudgetSettings(raw: unknown, book: Pricebook): BudgetSettings {
  const out = defaultBudgetSettings(book);
  if (!isRecord(raw)) return out;
  const { min, max, step } = book.reserve;
  if (typeof raw.reserve === "number" && Number.isFinite(raw.reserve)) {
    const snapped = Math.round(raw.reserve / step) * step;
    out.reserve = clean(Math.min(max, Math.max(min, snapped)));
  }
  if (isRecord(raw.groups)) {
    for (const g of book.groups) {
      const v = raw.groups[g.id];
      if (g.optional && typeof v === "boolean") out.groups[g.id] = v;
    }
  }
  if (isRecord(raw.overrides)) {
    const ids = new Set(book.groups.flatMap((g) => g.lines.map((l) => l.id)));
    if (book.siteOverhead) ids.add(book.siteOverhead.id);
    for (const [lineId, o] of Object.entries(raw.overrides)) {
      if (!ids.has(lineId) || !isRecord(o)) continue;
      const e: { quantity?: number; price?: number } = {};
      if (okEdit(o.quantity)) e.quantity = o.quantity;
      if (okEdit(o.price)) e.price = o.price;
      if (e.quantity !== undefined || e.price !== undefined) out.overrides[lineId] = e;
    }
  }
  return out;
}

// ================================================================================================ the budget

export interface BudgetLine {
  id: string;
  groupId: string;
  unit: UnitKey;
  /** Allowance for offcuts when ordering (the price book's `waste`), null when the line is not a material. */
  waste: number | null;
  /** Model quantity the line uses, null for constants and the overhead line. */
  quantityRef: QuantityKey | null;
  /** Effective quantity and price (edited or computed), the computed ones, and the amount = quantity x price (CZK, no VAT). */
  quantity: number;
  price: number;
  defaultQuantity: number;
  defaultPrice: number;
  amount: number;
  quantityEdited: boolean;
  priceEdited: boolean;
  /** True for the computed site-overhead line. */
  overhead: boolean;
}

export interface BudgetGroup {
  id: string;
  optional: boolean;
  /** Is the group included in the totals? Always true for groups that are not optional. */
  on: boolean;
  vatClass: string;
  vatRate: number;
  /** Sum of the amounts of its lines, CZK without VAT (also when the group is off, so the page can show what it would add). */
  subtotal: number;
  lines: BudgetLine[];
}

export interface BudgetResult {
  groups: BudgetGroup[];
  /** Construction work (basis of the overhead), house price (groups that are not optional), switched-on optional groups, CZK without VAT. */
  works: number;
  core: number;
  extras: number;
  /** core + extras, the reserve on it, VAT on (net + reserve) per group rate, and the total, CZK. */
  net: number;
  reserveShare: number;
  reserve: number;
  vat: number;
  total: number;
  /** House price with reserve and VAT (groups that are not optional only), and per m2 of heated floor (null when it is 0). */
  coreWithVat: number;
  perM2: number | null;
  floorArea: number;
  /** VAT per class key, CZK; sums to `vat`. */
  vatByClass: Record<string, number>;
}

const differs = (a: number, b: number): boolean => Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b));

/**
 * Totals. With r the reserve share, `subtotal(g)` = Σ quantity x price:
 *   works = Σ subtotal over groups that are on and have `siteOverheadBasis`;   overhead default price = round(share x works / roundTo) x roundTo
 *   core = Σ non-optional;   extras = Σ optional and on;   net = core + extras;   reserve = r x net
 *   vat = Σ over groups on of subtotal x (1 + r) x rate(g);          total = net + reserve + vat
 *   coreWithVat = Σ non-optional of subtotal x (1 + r) x (1 + rate(g));   perM2 = coreWithVat / quantities.floorAreaHeated
 * The overhead line is computed from the effective amounts of the basis groups (edits included) and does not count itself in
 * its basis. An edit of one line never changes another line except the overhead. Never NaN; negative edits are ignored
 * (the settings go through `sanitizeBudgetSettings` first).
 */
export function computeBudget(book: Pricebook, quantities: Quantities, settings?: BudgetSettings): BudgetResult {
  const s = sanitizeBudgetSettings(settings ?? defaultBudgetSettings(book), book);
  const r = s.reserve;
  const fallbackRate = book.vat.classes[book.vat.default] ?? 0;

  const groups: BudgetGroup[] = book.groups.map((g) => {
    const lines: BudgetLine[] = g.lines.map((l) => {
      const defaultQuantity = ruleQuantity(l.quantity, quantities);
      const ov = s.overrides[l.id];
      const quantity = ov?.quantity ?? defaultQuantity;
      const price = ov?.price ?? l.price;
      return {
        id: l.id, groupId: g.id, unit: l.unit, waste: l.waste ?? null, quantityRef: "ref" in l.quantity ? l.quantity.ref : null,
        quantity, price, defaultQuantity, defaultPrice: l.price, amount: quantity * price,
        quantityEdited: ov?.quantity !== undefined && differs(ov.quantity, defaultQuantity),
        priceEdited: ov?.price !== undefined && differs(ov.price, l.price),
        overhead: false,
      };
    });
    const on = !g.optional || (s.groups[g.id] ?? g.defaultOn);
    return { id: g.id, optional: g.optional, on, vatClass: g.vat, vatRate: book.vat.classes[g.vat] ?? fallbackRate, subtotal: 0, lines };
  });

  // the site overhead: a share of the construction work, itself not part of that work
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const works = sum(groups.filter((g, i) => g.on && book.groups[i].siteOverheadBasis).flatMap((g) => g.lines.map((l) => l.amount)));
  const oh = book.siteOverhead;
  if (oh) {
    const home = groups.find((g) => g.id === oh.groupId);
    if (home) {
      const defaultPrice = Math.round((oh.share * works) / oh.roundTo) * oh.roundTo;
      const ov = s.overrides[oh.id];
      const quantity = ov?.quantity ?? 1;
      const price = ov?.price ?? defaultPrice;
      home.lines.push({
        id: oh.id, groupId: home.id, unit: "set", waste: null, quantityRef: null, quantity, price, defaultQuantity: 1, defaultPrice, amount: quantity * price,
        quantityEdited: ov?.quantity !== undefined && differs(ov.quantity, 1),
        priceEdited: ov?.price !== undefined && differs(ov.price, defaultPrice),
        overhead: true,
      });
    }
  }
  for (const g of groups) g.subtotal = sum(g.lines.map((l) => l.amount));

  const core = sum(groups.filter((g) => !g.optional).map((g) => g.subtotal));
  const extras = sum(groups.filter((g) => g.optional && g.on).map((g) => g.subtotal));
  const net = core + extras;
  const reserve = r * net;
  const vatByClass: Record<string, number> = Object.fromEntries(Object.keys(book.vat.classes).map((k) => [k, 0]));
  for (const g of groups) if (g.on) vatByClass[g.vatClass] = (vatByClass[g.vatClass] ?? 0) + g.subtotal * (1 + r) * g.vatRate;
  const vat = sum(Object.values(vatByClass));
  const coreWithVat = sum(groups.filter((g) => !g.optional).map((g) => g.subtotal * (1 + r) * (1 + g.vatRate)));
  const floorArea = quantities.floorAreaHeated;
  return {
    groups, works, core, extras, net, reserveShare: r, reserve, vat, total: net + reserve + vat,
    coreWithVat, perM2: floorArea > 0 ? coreWithVat / floorArea : null, floorArea, vatByClass,
  };
}

// ================================================================================================ CSV

export interface CsvLabels {
  group: string;
  item: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  /** Row labels of the summary block. */
  net: string;
  /** Receives the reserve in percent, for example "Reserve 8 %". */
  reserve: (percent: number) => string;
  vat: string;
  total: string;
}

export interface CsvOptions {
  locale: Locale;
  labels: CsvLabels;
  /** Visitor-facing label of a unit key (the page's dictionary). */
  unitLabel: (unit: UnitKey) => string;
}

/** A number for a spreadsheet: at most `digits` decimals, trailing zeros dropped, no thousands separators, decimal comma in Czech. */
function csvNumber(v: number, digits: number, locale: Locale): string {
  const s = String(Number(Number.isFinite(v) ? v.toFixed(digits) : 0));
  return locale === "cs" ? s.replace(".", ",") : s;
}

/**
 * CSV of the switched-on groups for spreadsheets: UTF-8 with a byte-order mark, CRLF, header row, one row per line (group, item,
 * quantity, unit, unit price, amount), a blank row, then the summary rows (net, reserve, VAT, total). Czech: separator ";" and
 * decimal comma; English: "," and decimal point. Numbers carry no thousands separators; a cell containing the separator, a quote
 * or a line break is quoted with doubled quotes. Names come from the book in the requested language. Amounts are rounded to whole
 * crowns, quantities and unit prices to two decimals.
 */
export function toCsv(result: BudgetResult, book: Pricebook, opts: CsvOptions): string {
  const { locale, labels } = opts;
  const sep = locale === "cs" ? ";" : ",";
  const cell = (v: string) => (v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const row = (cells: readonly string[]) => cells.map(cell).join(sep);
  const num = (v: number, digits: number) => csvNumber(v, digits, locale);

  const names = new Map<string, string>();
  for (const g of book.groups) for (const l of g.lines) names.set(l.id, l.name[locale]);
  if (book.siteOverhead) names.set(book.siteOverhead.id, book.siteOverhead.name[locale]);
  const groupName = new Map(book.groups.map((g) => [g.id, g.name[locale]]));

  const rows: string[] = [row([labels.group, labels.item, labels.quantity, labels.unit, labels.unitPrice, labels.amount])];
  for (const g of result.groups) {
    if (!g.on) continue;
    for (const l of g.lines) {
      rows.push(row([groupName.get(g.id) ?? g.id, names.get(l.id) ?? l.id, num(l.quantity, 2), opts.unitLabel(l.unit), num(l.price, 2), num(l.amount, 0)]));
    }
  }
  rows.push("");
  const summary = (label: string, value: number) => row(["", label, "", "", "", num(value, 0)]);
  rows.push(
    summary(labels.net, result.net),
    summary(labels.reserve(Math.round(result.reserveShare * 1000) / 10), result.reserve),
    summary(labels.vat, result.vat),
    summary(labels.total, result.total),
  );
  return `﻿${rows.join("\r\n")}\r\n`;
}
