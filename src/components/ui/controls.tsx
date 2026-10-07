// Barrel of the design system's components. Interactive controls live in ./inputs (a client module), figures and
// heading blocks in ./display (server-safe), so a server page that only uses ToolHead ships no client code for it.
export { Chips, NumberField, NumInput, Segmented, Slider, Switch } from "./inputs";
export type { ChipOption } from "./inputs";
export { Stat, ToolHead } from "./display";
