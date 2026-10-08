// Presentational building blocks that need no client JavaScript: the accent phrase of a heading, a figure, the heading
// block of a tool page and its two closing blocks (MethodNote, NextTool). Import them from "@/components/ui/controls".

import type { ReactNode } from "react";
import { NBSP } from "@/lib/i18n/format";
import type { T } from "@/lib/i18n/messages";
import { accent as renderAccent, plainText } from "@/lib/i18n/rich";
import { ROUTES, ROUTE_KEYS, routePath, type RouteKey } from "@/lib/routes";
import IntentLink from "./IntentLink";

// ------------------------------------------------------------------------------------------------ the accent phrase

/**
 * A heading text with its second voice: "Kolik dům stojí, <q>položku po položce</q>" -> the phrase in <q> becomes
 * <span class="accent"> (Instrument Serif italic in --ink-2, no quotation marks). One phrase per heading; never body,
 * UI or numbers. Anything that is not a string is returned unchanged, so a component can take a title prop that is
 * either a dictionary string or ready markup. The rendering rule itself is accent() in src/lib/i18n/rich.tsx (one
 * implementation for the whole site); this is its component-side entry point.
 */
export function accentPhrase(text: ReactNode): ReactNode {
  return typeof text === "string" ? renderAccent(text) : text;
}

/** The text of a two-voice heading without its markup (for aria-labels, titles and metadata): plainText() of rich.tsx. */
export const plainHeading: (text: string) => string = plainText;

// ------------------------------------------------------------------------------------------------ Stat

/**
 * A figure with its caption. The unit (and a prefix, for "CZK 11.74M") is set small in sans and joined by a no-break
 * space inside the unit element, so the text reads "166,2 m²" when copied or read aloud. `suffix` attaches without a
 * space ("M", "/m²"). `accent` marks the one figure that matters on the page (mint).
 */
export function Stat({ value, unit, prefix, suffix, label, accent }: {
  value: ReactNode; unit?: string; prefix?: string; suffix?: string; label: ReactNode; accent?: boolean;
}) {
  return (
    <div className={accent ? "stat signal" : "stat"}>
      <div className="v">
        {prefix && <small className="pre">{prefix}{NBSP}</small>}
        {value}
        {suffix && <small className="suf">{suffix}</small>}
        {unit && <small>{NBSP}{unit}</small>}
      </div>
      <div className="k">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ ToolHead

/**
 * The heading block of a tool page and its only h1: the kicker ("— 03 — Pozemek": `n` from ROUTES[key].n, `kicker`
 * the page label), the two-voice claim (`title`; a string's <q>…</q> becomes the accent phrase), and in the right
 * column the lede and an optional aside (a link, a switch).
 */
export function ToolHead({ n, kicker, title, lede, aside }: { n: string; kicker?: ReactNode; title: ReactNode; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="shell tool-head">
      <p className="kicker">{n && <span className="n">{n}</span>}{kicker && <span className="kicker-label">{kicker}</span>}</p>
      <h1 className="h1">{accentPhrase(title)}</h1>
      {(lede || aside) && (
        <div className="tool-side">
          {lede && <p className="lede">{lede}</p>}
          {aside && <div className="aside">{aside}</div>}
        </div>
      )}
    </header>
  );
}

// ------------------------------------------------------------------------------------------------ MethodNote

/**
 * "How it is calculated": the same closing block on every tool page. A disclosure (works without JavaScript) whose
 * summary is a mono label with the mint hairline; the body flows in columns of about 34 characters.
 * `title` is the label (common dictionary), `children` the method text (paragraphs, short lists, h3 for parts).
 */
export function MethodNote({ title, children, open, id }: { title: ReactNode; children: ReactNode; open?: boolean; id?: string }) {
  return (
    <section className="shell" id={id}>
      <details className="method" open={open}>
        <summary><span className="label">{title}</span><span className="method-icon" aria-hidden /></summary>
        <div className="method-body">{children}</div>
      </details>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ NextTool

/** The page after `from` in the order of ROUTE_KEYS (the menu order); after the last tool comes Home. */
export function nextRoute(from: RouteKey): RouteKey {
  return ROUTE_KEYS[(ROUTE_KEYS.indexOf(from) + 1) % ROUTE_KEYS.length];
}

/**
 * The hand-off to the next page, after MethodNote: kicker ("Další", number and page label: common.next.label), the next
 * page's two-voice title (`<key>.title`, else its menu label) and its teaser (`<key>.teaser`, else its menu
 * description), a long arrow. The landmark is named by common.next.aria ("Další stránka: Slunce").
 * Pass the server translator: `<NextTool from="plot" t={getT(locale)} />`. A next title that needs a value (plot.title
 * takes {area}) cannot be filled here: pass it ready as `title` (`title={t("plot.title", { area })}` on the Plan page);
 * without it NextTool shows the menu label rather than a raw "{area}".
 */
export function NextTool({ from, t, title: given }: { from: RouteKey; t: T; title?: ReactNode }) {
  const key = nextRoute(from);
  const label = t.dyn(`nav.items.${key}.label`);
  const claim = given === undefined && t.has(`${key}.title`) ? t.dyn(`${key}.title`) : label;
  const title = given ?? (/\{\w+\}/.test(claim) ? label : claim);
  const teaser = t.has(`${key}.teaser`) ? t.dyn(`${key}.teaser`) : t.dyn(`nav.items.${key}.desc`);
  const next = t("common.next.label");
  return (
    <nav className="shell next-tool" aria-label={t("common.next.aria", { page: label })}>
      <IntentLink href={routePath(t.locale, key)} heavy={ROUTES[key].heavy === true}>
        <span className="kicker">
          <span className="kicker-label">{next}</span>
          {ROUTES[key].n && <span className="n">{ROUTES[key].n}</span>}
          <span className="kicker-label">{label}</span>
        </span>
        <b>{accentPhrase(title)}</b>
        <span className="d">{teaser}</span>
        <span className="arrow" aria-hidden />
      </IntentLink>
    </nav>
  );
}
