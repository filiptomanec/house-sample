import { defineMessages } from "../translate";

// Shared UI strings. Czech is typeset by t() (non-breaking spaces), so write ordinary spaces here.
export default defineMessages({
  cs: {
    skip: "Přeskočit na obsah",
    loading: "Načítání…",
    close: "Zavřít",
    back: "Zpět",
    retry: "Zkusit znovu",
    externalLink: "(otevře se v nové záložce)",
    menu: { open: "Menu", close: "Zavřít", label: "Menu" },
    language: { label: "Jazyk", cs: "Čeština", en: "English" },
    theme: { label: "Vzhled", auto: "Podle systému", light: "Světlý", dark: "Tmavý", switchTo: "Vzhled: {mode}. Změnit." },
    validation: { number: "Zadejte číslo.", min: "Nejméně {value}.", max: "Nejvýše {value}." },
    fiction: "Fiktivní dům na fiktivním pozemku.",
    count: {
      rooms: { one: "{count} místnost", few: "{count} místnosti", other: "{count} místností" },
      days: { one: "{count} den", few: "{count} dny", other: "{count} dní" },
    },
  },
  en: {
    skip: "Skip to content",
    loading: "Loading…",
    close: "Close",
    back: "Back",
    retry: "Try again",
    externalLink: "(opens in a new tab)",
    menu: { open: "Menu", close: "Close", label: "Menu" },
    language: { label: "Language", cs: "Čeština", en: "English" },
    theme: { label: "Appearance", auto: "System", light: "Light", dark: "Dark", switchTo: "Appearance: {mode}. Change." },
    validation: { number: "Enter a number.", min: "At least {value}.", max: "At most {value}." },
    fiction: "A fictional house on a fictional plot.",
    count: {
      rooms: { one: "{count} room", other: "{count} rooms" },
      days: { one: "{count} day", other: "{count} days" },
    },
  },
});
