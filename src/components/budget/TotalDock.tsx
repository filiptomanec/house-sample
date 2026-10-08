"use client";

// The total on a phone while the visitor edits lines far below the headline: a bar fixed to the bottom edge, shown only while
// the headline figures are above the window and the breakdown below it (budget.css hides it on wider screens). A tap jumps to
// the breakdown. It repeats a number the page already shows, so it starts hidden and nothing depends on it.

import { useEffect, useState } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { millionText } from "./view";

export function TotalDock({ total, statsId, sideId }: { total: number; statsId: string; sideId: string }) {
  const t = useT();
  const f = useFormat();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const stats = document.getElementById(statsId), side = document.getElementById(sideId);
    if (!stats || !side || typeof IntersectionObserver === "undefined") return;
    const state = { statsAbove: false, sideBelow: true };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const out = !e.isIntersecting;
        if (e.target === stats) state.statsAbove = out && e.boundingClientRect.top < 0;
        else state.sideBelow = out && e.boundingClientRect.top > 0;
      }
      setShow(state.statsAbove && state.sideBelow);
    });
    io.observe(stats);
    io.observe(side);
    return () => io.disconnect();
  }, [statsId, sideId]);

  return (
    <a className="budget-dock" href={`#${sideId}`} data-show={show ? "" : undefined} tabIndex={show ? undefined : -1} aria-hidden={show ? undefined : true}>
      <span className="label">{t("budget.side.total")}</span>
      <b className="num">{millionText(t, f, total)}</b>
    </a>
  );
}
