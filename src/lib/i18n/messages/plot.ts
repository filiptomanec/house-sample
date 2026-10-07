import { defineMessages } from "../translate";

// Namespace "plot". The page agent fills in the rest; `meta` is read by buildMetadata() and must stay.
export default defineMessages({
  cs: {
    meta: { title: "Pozemek", description: "Osazení fiktivního domu na fiktivním pozemku: hranice, odstupy, terén, příjezd a zeleň." },
    lede: "Osazení domu na pozemku, odstupy od hranic a terén.",
  },
  en: {
    meta: { title: "Plot", description: "Placement of the fictional house on a fictional plot: boundary, set-backs, terrain, access and planting." },
    lede: "Placement of the house on the plot, set-backs and terrain.",
  },
});
