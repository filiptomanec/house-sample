"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { THEME_KEY, nextTheme, type Theme } from "./themeScript";

function readTheme(): Theme {
  const v = document.documentElement.getAttribute("data-theme");
  return v === "light" || v === "dark" ? v : "auto";
}
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

const ICONS: Record<Theme, ReactNode> = {
  // half-filled circle: follows the system
  auto: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></>,
  light: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>,
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
};

/** Cycles system -> light -> dark. The choice is kept in localStorage (when available) and applied as <html data-theme>. */
export default function ThemeSwitch() {
  const t = useT();
  const theme = useSyncExternalStore(subscribe, readTheme, () => "auto" as Theme);
  const label = t("common.theme.switchTo", { mode: t(`common.theme.${theme}`) });
  const press = () => {
    const next = nextTheme(theme);
    if (next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch { /* private mode or blocked storage: the choice just lasts until the page is closed */ }
  };
  return (
    <button type="button" className="icon-btn" onClick={press} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[theme]}</svg>
    </button>
  );
}
