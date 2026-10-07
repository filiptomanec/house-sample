// Theme preference: "light" or "dark" is stored under THEME_KEY in localStorage; no entry means "follow the system".
// THEME_SCRIPT runs in <head> before first paint, so a stored preference never flashes the wrong scheme.

export const THEME_KEY = "theme";
export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** The next preference when the switch is pressed: auto -> light -> dark -> auto. */
export const nextTheme = (t: Theme): Theme => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
