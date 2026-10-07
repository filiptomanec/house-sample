import { defineMessages } from "../translate";

// Namespace "budget". The page agent fills in the rest; `meta` is read by buildMetadata() and must stay.
export default defineMessages({
  cs: {
    meta: { title: "Rozpočet", description: "Výměry a orientační ceny fiktivního domu: položky, jednotkové ceny a celkový rozsah nákladů." },
    lede: "Výměry a orientační ceny, které si můžete upravit.",
  },
  en: {
    meta: { title: "Budget", description: "Quantities and indicative prices of the fictional house: items, unit prices and the overall cost range." },
    lede: "Quantities and indicative prices that you can adjust.",
  },
});
