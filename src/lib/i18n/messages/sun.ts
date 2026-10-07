import { defineMessages } from "../translate";

// Namespace "sun". The page agent fills in the rest; `meta` is read by buildMetadata() and must stay.
export default defineMessages({
  cs: {
    meta: { title: "Slunce", description: "Stíny a oslunění fiktivního domu v kterýkoli den a hodinu: dráha slunce, hodiny přímého slunce a zastínění." },
    lede: "Stíny a oslunění domu v kterýkoli den a hodinu.",
  },
  en: {
    meta: { title: "Sun", description: "Shadows and sunlight on the fictional house on any day and hour: sun path, hours of direct sun and shading." },
    lede: "Shadows and sunlight on the house on any day and hour.",
  },
});
