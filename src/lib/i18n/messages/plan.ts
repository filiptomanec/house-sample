import { defineMessages } from "../translate";

// Namespace "plan". The page agent fills in the rest; `meta` is read by buildMetadata() and must stay.
export default defineMessages({
  cs: {
    meta: { title: "Půdorys", description: "Půdorys fiktivního přízemního domu Dlouhá střecha: místnosti, okna, dveře a rozměry odvozené z jednoho datového modelu." },
    lede: "Místnosti, okna a rozměry domu, odvozené z datového modelu.",
  },
  en: {
    meta: { title: "Floor plan", description: "Floor plan of the fictional single-storey Long Roof House: rooms, windows, doors and dimensions derived from one data model." },
    lede: "Rooms, windows and dimensions of the house, derived from the data model.",
  },
});
