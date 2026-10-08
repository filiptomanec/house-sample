import { defineMessages } from "../translate";

// Navigation: aria labels and the label + one-line description of every page (in navigation order, see routes.ts), plus the
// "About" entry (a section of the home page, links.ts aboutHref). The brand is the house name, which comes from the model
// (SITE.house.name), never from here: the bar renders it and labels the link with brandAria.
export default defineMessages({
  cs: {
    /** @deprecated The bar shows the house name (layout.tsx passes it to Nav). */
    brand: "House Sample",
    /** @deprecated No sub-line under the house name. */
    brandSub: "Studie domu",
    /** @deprecated Use brandAria (the same text). Takes { house } like it, so a leftover reader never shows another name. */
    homeAria: "{house}, úvodní stránka",
    brandAria: "{house}, úvodní stránka",
    main: "Hlavní navigace",
    items: {
      home: { label: "Úvod", desc: "Dům v kostce" },
      model: { label: "3D prohlídka", desc: "Obejděte dům a projděte se uvnitř" },
      plan: { label: "Půdorys", desc: "Místnosti, rozměry a skladby stěn" },
      plot: { label: "Pozemek", desc: "Zahrada, odstupy a terén" },
      sun: { label: "Slunce", desc: "Kam a kdy svítí slunce" },
      energy: { label: "Energie", desc: "Teplo, elektřina a co si dům vyrobí" },
      budget: { label: "Rozpočet", desc: "Kolik by dům stál, položku po položce" },
      gallery: { label: "Galerie", desc: "Rendery a video z jednoho dne" },
    },
    about: { label: "O projektu", desc: "Jak dům vznikl" },
  },
  en: {
    brand: "House Sample",
    brandSub: "House study",
    homeAria: "{house}, home page",
    brandAria: "{house}, home page",
    main: "Main navigation",
    items: {
      home: { label: "Home", desc: "The house at a glance" },
      model: { label: "3D tour", desc: "Walk round it, then step inside" },
      plan: { label: "Floor plan", desc: "Rooms, dimensions and wall build-ups" },
      plot: { label: "Plot", desc: "Garden, setbacks and levels" },
      sun: { label: "Sun", desc: "Where the sun falls, and when" },
      energy: { label: "Energy", desc: "Heat, power and what the roof generates" },
      budget: { label: "Budget", desc: "What it would cost, line by line" },
      gallery: { label: "Gallery", desc: "Renders and a film of one day" },
    },
    about: { label: "About", desc: "How it was made" },
  },
});
