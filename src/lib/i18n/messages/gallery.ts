import { defineMessages } from "../translate";

// Namespace "gallery" (Gallery page). `meta` is read by buildMetadata() and must stay; `title` (two-voice, render with
// accent()), `lede` and `teaser` are the page frame. Czech is typeset by t() (non-breaking spaces), so write ordinary spaces.
// Titles and alt texts of the pictures come from the media manifest, not from here.
export default defineMessages({
  cs: {
    meta: { title: "Galerie", description: "{house} v renderech z jednoho dne: od ulice, ze zahrady, z terasy, uvnitř i z výšky." },
    title: "Dům <q>od rána do soumraku</q>",
    lede: "Rendery a video z jednoho dne, venku i uvnitř. Slunce na nich stojí tam, kde by v tu hodinu opravdu bylo.",
    ledeStills: "Rendery z jednoho dne, venku i uvnitř. Slunce na nich stojí tam, kde by v tu hodinu opravdu bylo.",
    teaser: "Prohlédněte si dům v renderech jednoho dne.",
    filter: {
      label: "Filtr snímků",
      all: "Vše",
      exterior: "Venku",
      interior: "Uvnitř",
      aerial: "Z výšky",
      detail: "Detaily",
      evening: "Večer",
    },
    shown: { one: "Zobrazen {count} snímek.", few: "Zobrazeny {count} snímky.", other: "Zobrazeno {count} snímků." },
    open: "{title}, snímek {n} / {total}. Otevřít ve velkém.",
    note: "Každý snímek je render modelu domu z Blenderu (Cycles).",
    // a card caption: "21. června, 20:15 · slunce 8° nad obzorem na severozápadě"
    caption: "{date}, {time} · {sun}",
    sun: { above: "slunce {altitude} nad obzorem na {direction}", below: "slunce pod obzorem" },
    // the direction of the sun on the horizon, in the locative ("na severozápadě")
    compass: { N: "severu", NE: "severovýchodě", E: "východě", SE: "jihovýchodě", S: "jihu", SW: "jihozápadě", W: "západě", NW: "severozápadě" },
    moment: { golden: "zlatá hodinka", blue: "modrá hodinka", night: "noc" },
    video: {
      title: "Let kolem domu",
      play: "Přehrát video: {title}, {length}",
      tag: "Video",
      error: "Video se nepodařilo načíst.",
    },
    lightbox: {
      label: "Prohlížeč snímků",
      prev: "Předchozí snímek",
      next: "Další snímek",
      counter: "{n} / {total}",
      zoomIn: "Přiblížit",
      zoomOut: "Oddálit",
      zoomHint: "Dvojitým klepnutím přiblížíte, tažením posunete.",
      close: "Zavřít",
    },
  },
  en: {
    meta: { title: "Gallery", description: "{house} in renders of a single day: from the street, the garden and the terrace, inside and from above." },
    title: "The house <q>from sunrise to dusk</q>",
    lede: "Renders and a film of one day, outside and in. The sun stands where it really would at that hour.",
    ledeStills: "Renders of one day, outside and in. The sun stands where it really would at that hour.",
    teaser: "Browse the house in renders of a single day.",
    filter: {
      label: "Filter images",
      all: "All",
      exterior: "Outside",
      interior: "Inside",
      aerial: "Aerial",
      detail: "Details",
      evening: "Evening",
    },
    shown: { one: "{count} image shown.", other: "{count} images shown." },
    open: "{title}, image {n} of {total}. Open full size.",
    note: "Every image is a Cycles render of the house model.",
    caption: "{date}, {time} · {sun}",
    sun: { above: "sun {altitude} above the horizon in the {direction}", below: "sun below the horizon" },
    compass: { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" },
    moment: { golden: "golden hour", blue: "blue hour", night: "night" },
    video: {
      title: "Fly-around",
      play: "Play video: {title}, {length}",
      tag: "Video",
      error: "The video could not be loaded.",
    },
    lightbox: {
      label: "Image viewer",
      prev: "Previous image",
      next: "Next image",
      counter: "{n} / {total}",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomHint: "Double-tap to zoom, drag to move.",
      close: "Close",
    },
  },
});
