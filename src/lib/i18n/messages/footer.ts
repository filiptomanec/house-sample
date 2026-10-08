import { defineMessages } from "../translate";

// Footer. The large wordmark is the house name (SITE.house.name, from the model), not a string here. The footer is one of the
// four places allowed to say that the house is invented (docs/COPY.md): about.text and the one fiction line.
export default defineMessages({
  cs: {
    label: "Patička",
    about: {
      title: "O projektu",
      text: "Portfoliový projekt o přízemním domě, který stojí jen v počítači. Půdorys, 3D model, rendery i výpočty vycházejí z jednoho popisu domu, a proto spolu vždy souhlasí.",
    },
    fiction: "Dům i pozemek jsou vymyšlené. Výpočty jsou orientační a nenahrazují projekt ani odborný posudek.",
    pages: "Stránky",
    project: { title: "Projekt", author: "Návrh a kód: <a>{name}</a>", source: "Zdrojový kód na GitHubu" },
    credits: {
      title: "Zdroje a licence",
      pvgis: "Sluneční data PVGIS (EU JRC)",
      polyhaven: "Textury, modely a HDRI z Poly Haven (CC0)",
      geist: "Písmo Geist (SIL OFL 1.1)",
      instrumentSerif: "Písmo Instrument Serif (SIL OFL 1.1)",
      code: "Zdrojový kód pod licencí MIT",
    },
    rights: "© {year} {name}",
  },
  en: {
    label: "Footer",
    about: {
      title: "About the project",
      text: "A portfolio project about a single-storey house that exists only on screen. The floor plan, the 3D model, the renders and every calculation come from one description of the house, so they always agree.",
    },
    fiction: "The house and the plot are imaginary. All figures are indicative and no substitute for a building design or professional advice.",
    pages: "Pages",
    project: { title: "Project", author: "Designed and built by <a>{name}</a>", source: "Source code on GitHub" },
    credits: {
      title: "Sources and licences",
      pvgis: "Solar data from PVGIS (EU JRC)",
      polyhaven: "Textures, models and HDRIs from Poly Haven (CC0)",
      geist: "Geist typeface (SIL OFL 1.1)",
      instrumentSerif: "Instrument Serif typeface (SIL OFL 1.1)",
      code: "Source code under the MIT licence",
    },
    rights: "© {year} {name}",
  },
});
