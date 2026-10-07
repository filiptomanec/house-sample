import { defineMessages } from "../translate";

// Namespace "home". The page agent fills in the rest; `meta` is read by buildMetadata() and must stay.
export default defineMessages({
  cs: {
    meta: { title: "Dům Dlouhá střecha", description: "Fiktivní přízemní dům jako datově řízený portfolio projekt: půdorys, pozemek, 3D model, slunce, energie, rozpočet a galerie z jednoho datového modelu." },
    lede: "Fiktivní přízemní dům s dlouhou valbovou střechou, spočítaný a vykreslený z jednoho datového modelu.",
  },
  en: {
    meta: { title: "Long Roof House", description: "A fictional single-storey house as a data-driven portfolio project: floor plan, plot, 3D model, sun, energy, budget and gallery from one data model." },
    lede: "A fictional single-storey house with a long hipped roof, calculated and rendered from a single data model.",
  },
});
