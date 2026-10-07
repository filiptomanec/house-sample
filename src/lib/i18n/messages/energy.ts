import { defineMessages } from "../translate";

// Namespace "energy". The page agent fills in the rest; `meta` is read by buildMetadata() and must stay.
export default defineMessages({
  cs: {
    meta: { title: "Energie", description: "Orientační výpočet vytápění, fotovoltaiky a úspor fiktivního domu podle zadaných předpokladů a dat PVGIS." },
    lede: "Vytápění, fotovoltaika a úspora podle zadaných předpokladů.",
  },
  en: {
    meta: { title: "Energy", description: "Indicative calculation of heating, photovoltaics and savings of the fictional house from adjustable assumptions and PVGIS data." },
    lede: "Heating, photovoltaics and savings from adjustable assumptions.",
  },
});
