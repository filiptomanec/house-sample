import { defineMessages } from "../translate";

// Navigation: brand, aria labels and the label + one-line description of every page (in navigation order, see routes.ts).
export default defineMessages({
  cs: {
    brand: "House Sample",
    brandSub: "Dům Dlouhá střecha",
    homeAria: "House Sample, úvodní stránka",
    main: "Hlavní navigace",
    items: {
      home: { label: "Úvod", desc: "Přehled domu" },
      plan: { label: "Půdorys", desc: "Místnosti, okna, rozměry a skladby" },
      plot: { label: "Pozemek", desc: "Osazení, odstupy a terén" },
      model: { label: "3D model", desc: "Dům ve 3D, procházení, řez a export" },
      sun: { label: "Slunce", desc: "Stíny a oslunění v kterýkoli den" },
      energy: { label: "Energie", desc: "Vytápění, fotovoltaika a úspora" },
      budget: { label: "Rozpočet", desc: "Výměry a orientační ceny" },
      gallery: { label: "Galerie", desc: "Rendery a video" },
    },
  },
  en: {
    brand: "House Sample",
    brandSub: "Long Roof House",
    homeAria: "House Sample, home page",
    main: "Main navigation",
    items: {
      home: { label: "Home", desc: "Overview of the house" },
      plan: { label: "Floor plan", desc: "Rooms, windows, dimensions and build-ups" },
      plot: { label: "Plot", desc: "Placement, set-backs and terrain" },
      model: { label: "3D model", desc: "The house in 3D: walk-through, section and export" },
      sun: { label: "Sun", desc: "Shadows and sunlight on any day" },
      energy: { label: "Energy", desc: "Heating, photovoltaics and savings" },
      budget: { label: "Budget", desc: "Quantities and indicative prices" },
      gallery: { label: "Gallery", desc: "Renders and video" },
    },
  },
});
