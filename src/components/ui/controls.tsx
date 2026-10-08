// Barrel of the design system's components. Interactive controls live in ./inputs (a client module), figures, heading
// blocks and the closing blocks of a tool page in ./display (server-safe), so a server page that only uses ToolHead
// ships no client code for it.
export { Chips, NumberField, NumInput, Segmented, Slider, Switch } from "./inputs";
export type { ChipOption } from "./inputs";
export { MethodNote, NextTool, Stat, ToolHead, accentPhrase, nextRoute, plainHeading } from "./display";
export { default as IntentLink } from "./IntentLink";
