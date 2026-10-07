// Bill of quantities and indicative budget. `deriveQuantities` turns the model (house, derived data, plot) into named
// quantities in SI units; `model/pricebook.json` says which quantity each priced line uses and at what unit price;
// `computeBudget` adds reserve and VAT and applies the visitor's edits. No three.js, no text (names are bilingual data in the
// price book, labels of the CSV are passed in), no house numbers: quantities come from the geometry, prices from the book.
//
// Contract: docs/CALC-API.md, section 8. The module is split so that a client component can leave the plot code out:
//   budgetCore.ts        quantity table, PV quantities, material take-off, price book
//   budgetCompute.ts     settings, totals, CSV
//   budgetQuantities.ts  deriveQuantities (needs the plot model; run it on the server)
// This file re-exports all three; client code imports from the first two.
export * from "./budgetCore";
export * from "./budgetCompute";
export { deriveQuantities } from "./budgetQuantities";
