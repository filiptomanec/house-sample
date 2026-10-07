import { defineMessages } from "../translate";

export default defineMessages({
  cs: {
    notFound: {
      code: "404",
      label: "Stránka nenalezena",
      title: "Tahle stránka tu není.",
      text: "Odkaz je možná starý nebo je v adrese překlep.",
      home: "Zpět na úvod",
      pages: "Stránky webu",
    },
    error: {
      code: "Chyba",
      title: "Něco se pokazilo.",
      text: "Stránku se nepodařilo zobrazit. Zkuste ji načíst znovu, případně se vraťte na úvod.",
      retry: "Zkusit znovu",
      home: "Zpět na úvod",
      digest: "Kód chyby: {digest}",
    },
    webgl: {
      title: "3D zobrazení není dostupné",
      text: "Prohlížeč nebo zařízení nepodporuje WebGL. Půdorys, výpočty a galerie fungují i bez něj.",
    },
  },
  en: {
    notFound: {
      code: "404",
      label: "Page not found",
      title: "This page does not exist.",
      text: "The link may be old or the address may contain a typo.",
      home: "Back to the home page",
      pages: "Pages of the site",
    },
    error: {
      code: "Error",
      title: "Something went wrong.",
      text: "The page could not be displayed. Try loading it again, or go back to the home page.",
      retry: "Try again",
      home: "Back to the home page",
      digest: "Error code: {digest}",
    },
    webgl: {
      title: "3D view is not available",
      text: "This browser or device does not support WebGL. The floor plan, the calculations and the gallery work without it.",
    },
  },
});
