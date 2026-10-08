import { defineMessages } from "../translate";

// Namespace "home": the start page. `meta` is read by buildMetadata() and must stay. Numbers are never written here: they arrive
// as {placeholders} from the model and the calc modules, formatted by format.ts. Facts about this particular house (where the
// rooms lie, what the garden holds) live in the model (house.tagline, house.idea, room names), not here. Render every section
// title with accent() from rich.tsx: about.title marks its accent phrase with <q>; the other section titles get theirs once the
// page renders them that way (the page of pass 1 prints them as plain text). Voice and glossary: docs/COPY.md.
export default defineMessages({
  cs: {
    meta: {
      /** Not used for the home <title> (titleFull is), but every route key has a meta.title. */
      title: "Úvod",
      titleFull: "{house} · studie přízemního domu",
      // also the description of the web app manifest (read raw, so no placeholders here)
      description: "Studie přízemního rodinného domu na jižní Moravě. Projděte si ho ve 3D, sledujte slunce na terase a spočítejte, kolik by stál a kolik spotřebuje.",
    },
    /** @deprecated The hero lede is house.tagline from the model. */
    lede: "Přízemní rodinný dům se zahradou, spočítaný od slunce po rozpočet.",
    hero: {
      kicker: "Studie rodinného domu · jižní Morava",
      note: "Dům je vymyšlený. Slunce, teplo i ceny jsou spočítané doopravdy.",
      hint: "Posouvejte dolů, den poběží s vámi",
      alt: "Dům během jednoho dne, od ranního slunce po rozsvícená okna",
      cta: "3D prohlídka",
    },
    /** End of the day hero: a link to the Sun page. */
    dayCta: "Nasimulovat jiný den",
    /** End of the orbit: a link to the 3D tour. */
    orbitCta: "Obejít dům ve 3D",
    day: {
      // textAt variants take the time with its preposition from f.at() / f.atHours() ("ve 4:48"); the plain `text`
      // variants are deprecated and stay only until the page passes the at* parameters
      moments: {
        morning: {
          title: "Ráno",
          text: "Východ slunce {sunrise}, na {direction}.",
          textAt: "Slunce vychází {atSunrise} na {direction} a táhne přes zahradu dlouhé stíny.",
          textAlways: "Slunce je nad obzorem celý den.",
        },
        noon: {
          title: "Poledne",
          text: "Slunce je nejvýš, {altitude} nad obzorem ({noon}). Přesah střechy {overhang} stíní okna před vysokým sluncem.",
          textAt: "Slunce stojí nejvýš {atNoon}, {altitude} nad obzorem. Přesah střechy {overhang} stíní většinu jižního skla.",
        },
        evening: { title: "Večer", text: "Nízké slunce se opře do terasy. Natočené lamely jí vrátí stín." },
        afterSunset: {
          title: "Po západu",
          text: "Západ slunce {sunset}. Dům se rozsvítí.",
          textAt: "Slunce zapadá {atSunset}. V domě se rozsvítí.",
        },
      },
      hud: {
        sun: "Slunce: výška {altitude}, azimut {azimuth}",
        readout: "výška {altitude} · azimut {azimuth}",
        compass: { E: "V", S: "J", W: "Z" },
        /** Ends of the sun arc: time and compass point ({dir} from hud.dir). */
        sunrise: "východ {time} · {dir}",
        sunset: "západ {time} · {dir}",
        dir: { N: "S", NE: "SV", E: "V", SE: "JV", S: "J", SW: "JZ", W: "Z", NW: "SZ" },
        loading: "Načítám snímky dne…",
      },
    },
    numbers: {
      kicker: "Dům",
      title: "Jedno podlaží, zahrada na dosah",
      lede: "Plochy, rozměry a dispozice, jak je kreslí půdorys.",
      area: { unit: "m²", label: "užitná plocha bez garáže" },
      /** @deprecated The stat shows the layout code (layout.label). */
      rooms: { label: "místností včetně garáže" },
      /** Under metrics.layoutCode ("5+kk"). */
      layout: { label: "dispozice" },
      size: { unit: "m", label: "vnější rozměry" },
      plot: { unit: "m²", label: "pozemek" },
    },
    orbit: {
      label: "Dům ze všech stran",
      alt: "Kamera obletí dům v pozdním odpoledni",
      terrace: { title: "Terasa pod střechou", text: "{area} terasy, z toho {covered} pod střechou.", textCovered: "{area} terasy, celá pod střechou." },
      louvres: { title: "Lamely terasy", text: "Natáčecí dřevěné lamely chrání terasu před nízkým sluncem." },
      roof: { title: "Valbová střecha", text: "Sklon {pitch}, přesah {overhang}, hřeben {ridge} nad podlahou." },
      pv: { title: "Panely na střeše", text: "{panels}, dohromady {kwp}." },
      garage: { title: "Garáž", text: "Garáž má {area}, vrata jsou na {side} straně." },
      garageDrive: { title: "Garáž a příjezd", text: "Garáž má {area}, před ní vede příjezd až k bráně." },
      entry: { title: "Vstup", text: "Závětří na {side} straně chrání vstup před deštěm." },
      pool: { title: "Bazén", text: "Hladina {area}, hloubka {depth}." },
    },
    // a facade of the house, as an adjective: "na severní straně"
    side: { N: "severní", E: "východní", S: "jižní", W: "západní" },
    // the direction of the sunrise on the horizon, in the locative ("na severovýchodě")
    compass: { N: "severu", NE: "severovýchodě", E: "východě", SE: "jihovýchodě", S: "jihu", SW: "jihozápadě", W: "západě", NW: "severozápadě" },
    plan: {
      kicker: "Dispozice",
      title: "Den, noc a provoz na jednom podlaží",
      text: "Barvy ukazují zóny domu. Plochy jsou čisté, bez zdí.",
      link: "Celý půdorys",
      alt: "Půdorys barevně rozdělený na zóny",
      terrace: "Terasa",
    },
    compare: {
      kicker: "Světlo",
      title: "Stejný dům, jiná hodina",
      lede: "Posuňte předěl: vlevo {a}, vpravo {b}.",
      slider: "Předěl mezi snímky, vlevo {a}, vpravo {b}",
    },
    energy: {
      kicker: "Energie",
      title: "Teplo z čerpadla, proud ze střechy",
      /** @deprecated Use ledeCount with panels = t("common.count.panels", { count }). */
      lede: "Výchozí nastavení: panely na střeše ({panels} ks, {kwp}) a tepelné čerpadlo. Vlastní předpoklady zadáte na stránce Energie.",
      ledeCount: "{panels} na střeše ({kwp}) a tepelné čerpadlo. Vlastní předpoklady zadáte na stránce Energie.",
      designLoad: { unit: "kW", label: "tepelná ztráta při {outdoor}" },
      heat: { unit: "kWh/m²", label: "na vytápění za rok" },
      pv: { unit: "MWh", label: "elektřiny ze střechy za rok" },
      self: { unit: "%", label: "spotřeby pokryje střecha, s baterií {battery}" },
      selfNoBattery: { unit: "%", label: "spotřeby pokryje střecha, bez baterie" },
      link: "Zkusit vlastní čísla",
    },
    gallery: {
      kicker: "Galerie",
      title: "Pohledy zvenku i zevnitř",
      label: "Rendery domu",
      link: "Celá galerie",
      prev: "Předchozí snímek",
      next: "Další snímek",
    },
    explore: {
      kicker: "Prozkoumat",
      title: "Dům do posledního detailu",
    },
    // "Jak dům vznikl" (#o-projektu): the one place that names the data model, and one of the four places that say the house
    // is invented. Each step card shows one live number from the manifests with its `figure` plural.
    about: {
      kicker: "Jak dům vznikl",
      title: "Jeden model, <q>celý dům</q>",
      lede: "Dům je popsaný jedním datovým modelem: osy zdí, místnosti, okna, střecha a pozemek. Kreslí se z něj půdorys, staví 3D model i rendery a počítá slunce, energie a rozpočet. Posunete zeď a přepočítá se všechno.",
      steps: {
        plan: {
          title: "Půdorys",
          text: "Zdi, okna, dveře a plochy místností se kreslí přímo z modelu.",
          figure: { one: "{count} místnost", few: "{count} místnosti", other: "{count} místností" },
        },
        model: {
          title: "3D model",
          text: "Blender z modelu postaví dům pro web, pro rozšířenou realitu i pro 3D tisk.",
          figure: { one: "{count} trojúhelník", few: "{count} trojúhelníky", other: "{count} trojúhelníků" },
        },
        renders: {
          title: "Rendery",
          text: "Cycles kreslí světlo se sluncem přesně tam, kde by v tu hodinu opravdu stálo.",
          figure: { one: "{count} snímek", few: "{count} snímky", other: "{count} snímků" },
        },
        sun: {
          title: "Slunce a energie",
          text: "Stíny počítají paprsky nad 3D modelem, výrobu panelů hodinová data PVGIS.",
          figure: { one: "{count} hodina dat", few: "{count} hodiny dat", other: "{count} hodin dat" },
        },
        budget: {
          title: "Rozpočet",
          text: "Výměry se měří v modelu, ceny jsou z ceníku. Každou položku si můžete přepsat.",
          figure: { one: "{count} položka", few: "{count} položky", other: "{count} položek" },
        },
      },
      stack: "Next.js, React a three.js na webu, Blender a Cycles pro modely a rendery, PVGIS pro sluneční data.",
      fiction: "Dům, pozemek i sousedé jsou vymyšlení. Výpočty jsou skutečné, jen orientační.",
      source: "Zdrojový kód na GitHubu",
    },
  },
  en: {
    meta: {
      title: "Home",
      titleFull: "{house} · a single-storey house study",
      description: "A design study for a single-storey family house in South Moravia. Walk through it in 3D, follow the sun across the terrace and work out what it would cost to build and run.",
    },
    lede: "A single-storey family house with a garden, worked out from sunlight to budget.",
    hero: {
      kicker: "Family house study · South Moravia",
      note: "The house is imaginary. Its sunlight, heat and costs are calculated for real.",
      hint: "Keep scrolling and the day moves with you",
      alt: "The house through one day, from morning sun to lit windows",
      cta: "3D tour",
    },
    dayCta: "Try another day",
    orbitCta: "Walk round it in 3D",
    day: {
      moments: {
        morning: {
          title: "Morning",
          text: "Sunrise {sunrise}, in the {direction}.",
          textAt: "The sun rises {atSunrise} in the {direction}, casting long shadows across the garden.",
          textAlways: "The sun stays up all day.",
        },
        noon: {
          title: "Noon",
          text: "The sun is highest, {altitude} above the horizon ({noon}). The {overhang} overhang shades the windows from the high sun.",
          textAt: "The sun is highest {atNoon}, {altitude} above the horizon; the {overhang} overhang shades most of the south-facing glass.",
        },
        evening: { title: "Evening", text: "Low sun slants under the terrace roof; turn the louvres and the shade comes back." },
        afterSunset: {
          title: "After sunset",
          text: "Sunset {sunset}. The lights come on.",
          textAt: "The sun sets {atSunset}. The lights come on inside.",
        },
      },
      hud: {
        sun: "Sun: altitude {altitude}, azimuth {azimuth}",
        readout: "altitude {altitude} · azimuth {azimuth}",
        compass: { E: "E", S: "S", W: "W" },
        sunrise: "sunrise {time} · {dir}",
        sunset: "sunset {time} · {dir}",
        dir: { N: "N", NE: "NE", E: "E", SE: "SE", S: "S", SW: "SW", W: "W", NW: "NW" },
        loading: "Loading the day…",
      },
    },
    numbers: {
      kicker: "The house",
      title: "One level, the garden on the doorstep",
      lede: "Areas, dimensions and layout, as the floor plan draws them.",
      area: { unit: "m²", label: "floor area, excluding the garage" },
      rooms: { label: "rooms, garage included" },
      layout: { label: "layout: rooms + kitchenette" },
      size: { unit: "m", label: "overall dimensions" },
      plot: { unit: "m²", label: "plot" },
    },
    orbit: {
      label: "All the way round",
      alt: "The camera circles the house in the late afternoon",
      terrace: { title: "Covered terrace", text: "{area} of terrace, {covered} of it under the roof.", textCovered: "{area} of terrace, all of it under the roof." },
      louvres: { title: "Terrace louvres", text: "Pivoting timber louvres shield the terrace from the low sun." },
      roof: { title: "Hipped roof", text: "{pitch} pitch, {overhang} eaves, ridge {ridge} above the floor." },
      pv: { title: "Solar panels", text: "{panels}, {kwp} in all." },
      garage: { title: "Garage", text: "A {area} garage; the door faces {side}." },
      garageDrive: { title: "Garage and drive", text: "A {area} garage, with the drive running out to the gate." },
      entry: { title: "Entrance", text: "A porch on the {side} side keeps the rain off the front door." },
      pool: { title: "Pool", text: "{area} of water, {depth} deep." },
    },
    side: { N: "north", E: "east", S: "south", W: "west" },
    compass: { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" },
    plan: {
      kicker: "Layout",
      title: "Day, night and service on one level",
      text: "Colours mark the zones of the house. Areas are net, walls excluded.",
      link: "The full floor plan",
      alt: "Floor plan coloured by zone",
      terrace: "Terrace",
    },
    compare: {
      kicker: "Light",
      title: "Same house, another hour",
      lede: "Drag the divider: {a} on the left, {b} on the right.",
      slider: "Divider between the images, {a} on the left, {b} on the right",
    },
    energy: {
      kicker: "Energy",
      title: "Heat from the pump, power from the roof",
      lede: "Default setup: solar panels on the roof ({panels}, {kwp}) and a heat pump. Try your own assumptions on the Energy page.",
      ledeCount: "{panels} on the roof ({kwp}) and a heat pump. Try your own assumptions on the Energy page.",
      designLoad: { unit: "kW", label: "design heat load at {outdoor}" },
      heat: { unit: "kWh/m²", label: "space heating a year" },
      pv: { unit: "MWh", label: "solar yield a year" },
      self: { unit: "%", label: "of the power used comes from the roof, with a {battery} battery" },
      selfNoBattery: { unit: "%", label: "of the power used comes from the roof, no battery" },
      link: "Try your own numbers",
    },
    gallery: {
      kicker: "Gallery",
      title: "Views outside and in",
      label: "Renders of the house",
      link: "Open the gallery",
      prev: "Previous image",
      next: "Next image",
    },
    explore: {
      kicker: "Explore",
      title: "The house in every detail",
    },
    about: {
      kicker: "How it was made",
      title: "One model, <q>the whole house</q>",
      lede: "The house is one data model: wall axes, rooms, windows, roof and plot. The floor plan, the 3D model, the renders and the sun, energy and budget figures all come from it. Move a wall and everything follows.",
      steps: {
        plan: {
          title: "Floor plan",
          text: "Walls, windows, doors and room areas are drawn straight from the model.",
          figure: { one: "{count} room", other: "{count} rooms" },
        },
        model: {
          title: "3D model",
          text: "Blender builds the house from the model for the web, for AR and for 3D printing.",
          figure: { one: "{count} triangle", other: "{count} triangles" },
        },
        renders: {
          title: "Renders",
          text: "Cycles paints the light with the sun exactly where it would stand at that hour.",
          figure: { one: "{count} image", other: "{count} images" },
        },
        sun: {
          title: "Sun and energy",
          text: "Rays cast over the 3D model give the shadows; hourly PVGIS data give the solar yield.",
          figure: { one: "{count} hour of data", other: "{count} hours of data" },
        },
        budget: {
          title: "Budget",
          text: "Quantities are measured in the model, prices come from a price book. You can change every line.",
          figure: { one: "{count} line", other: "{count} lines" },
        },
      },
      stack: "Next.js, React and three.js on the web, Blender and Cycles for the models and renders, PVGIS for the solar data.",
      fiction: "The house, the plot and the neighbours are imaginary. The calculations are real, if indicative.",
      source: "Source code on GitHub",
    },
  },
});
