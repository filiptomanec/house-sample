import { defineMessages } from "../translate";

// Namespace "gallery" (Gallery page). `meta` is read by buildMetadata() and must stay. Czech is typeset by t() (non-breaking
// spaces), so write ordinary spaces. Titles and alt texts of the pictures come from the media manifest, not from here.
export default defineMessages({
  cs: {
    meta: { title: "Galerie", description: "Rendery fiktivního domu Dlouhá střecha v různých hodinách dne: pohledy od ulice, ze zahrady i z výšky." },
    lede: "Rendery a video domu v průběhu dne.",
    ledeStills: "Rendery domu v průběhu dne.",
    filter: {
      label: "Filtr snímků",
      all: "Vše",
      exterior: "Exteriér",
      interior: "Interiér",
      aerial: "Z výšky",
      detail: "Detail",
      evening: "Večer",
    },
    shown: { one: "Zobrazen {count} snímek.", few: "Zobrazeny {count} snímky.", other: "Zobrazeno {count} snímků." },
    open: "{title}, snímek {n} z {total}. Otevřít ve velkém.",
    note: "Dům i pozemek jsou fiktivní. Snímky vznikají z modelu domu, každý s jiným denním světlem.",
    video: {
      title: "Oblet kolem domu",
      play: "Přehrát video: {title}, {length}",
      tag: "Video",
      error: "Video se nepodařilo načíst.",
    },
    lightbox: {
      label: "Prohlížeč snímků",
      prev: "Předchozí snímek",
      next: "Další snímek",
      counter: "{n} z {total}",
    },
  },
  en: {
    meta: { title: "Gallery", description: "Renders of the fictional Long Roof House at different hours of the day: views from the street, from the garden and from above." },
    lede: "Renders and video of the house through the day.",
    ledeStills: "Renders of the house through the day.",
    filter: {
      label: "Picture filter",
      all: "All",
      exterior: "Exterior",
      interior: "Interior",
      aerial: "Aerial",
      detail: "Detail",
      evening: "Evening",
    },
    shown: { one: "{count} picture shown.", other: "{count} pictures shown." },
    open: "{title}, picture {n} of {total}. Open full size.",
    note: "The house and the plot are fictional. Every picture is rendered from the house model in a different daylight.",
    video: {
      title: "Flight around the house",
      play: "Play video: {title}, {length}",
      tag: "Video",
      error: "The video could not be loaded.",
    },
    lightbox: {
      label: "Picture viewer",
      prev: "Previous picture",
      next: "Next picture",
      counter: "{n} of {total}",
    },
  },
});
