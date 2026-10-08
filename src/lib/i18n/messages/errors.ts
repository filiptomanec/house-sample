import { defineMessages } from "../translate";

// Error states: the 404 (global-not-found.tsx and [locale]/not-found.tsx through StateViews), the error boundary and the
// missing-WebGL notice. notFound.title is a two-voice heading: render it with accent() from rich.tsx.
export default defineMessages({
  cs: {
    notFound: {
      code: "404",
      label: "Stránka nenalezena",
      title: "Tyhle dveře <q>nikam nevedou.</q>",
      text: "Odkaz je možná starý, nebo je v adrese překlep. Zkuste to znovu od vchodu.",
      home: "Zpět na úvod",
      pages: "Kam dál",
    },
    error: {
      code: "Chyba",
      title: "Něco se pokazilo.",
      text: "Stránku se nepodařilo zobrazit. Zkuste ji načíst znovu, nebo se vraťte na úvod.",
      retry: "Zkusit znovu",
      home: "Zpět na úvod",
      digest: "Kód chyby: {digest}",
    },
    webgl: {
      title: "3D zobrazení tu nefunguje",
      text: "Tento prohlížeč neumí 3D zobrazení. Půdorys, výpočty i galerie fungují i bez něj.",
    },
  },
  en: {
    notFound: {
      code: "404",
      label: "Page not found",
      title: "This door <q>leads nowhere.</q>",
      text: "The link may be out of date, or the address has a typo. Try again from the front door.",
      home: "Back to home",
      pages: "Where next",
    },
    error: {
      code: "Error",
      title: "Something went wrong.",
      text: "The page couldn't be shown. Try loading it again, or go back to the home page.",
      retry: "Try again",
      home: "Back to home",
      digest: "Error code: {digest}",
    },
    webgl: {
      title: "3D view unavailable",
      text: "This browser or device doesn't support WebGL. The floor plan, the calculations and the gallery still work.",
    },
  },
});
