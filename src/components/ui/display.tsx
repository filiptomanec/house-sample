// Presentational building blocks that need no client JavaScript: figure, heading block of a tool page.
// Import them from "@/components/ui/controls".

import type { ReactNode } from "react";

/** A number with its unit and a caption. `accent` colours the value mint. */
export function Stat({ value, unit, label, accent }: { value: ReactNode; unit?: string; label: ReactNode; accent?: boolean }) {
  return (
    <div className={accent ? "stat accent" : "stat"}>
      <div className="v">{value}{unit && <small>{unit}</small>}</div>
      <div className="k">{label}</div>
    </div>
  );
}

/**
 * The heading block of a tool page: number (from ROUTES[key].n), optional kicker label, the h1, a lede and an optional
 * aside on the right (a figure, a switch). The page's only h1.
 */
export function ToolHead({ n, kicker, title, lede, aside }: { n: string; kicker?: ReactNode; title: ReactNode; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="shell tool-head">
      <p className="kicker"><span className="n">{n}</span>{kicker && <span className="label">{kicker}</span>}</p>
      <h1 className="h1">{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {aside && <div className="aside">{aside}</div>}
    </header>
  );
}
