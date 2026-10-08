// "Jak dům vznikl" / "How it was made" (#o-projektu, the menu's About entry): one model drives five outputs. Each step is a card
// that leads to its page and carries one live number counted from the files the site is built from (aboutFacts.ts); under them
// the stack, the one fiction line of the page and the source code. A server component (its links are small client islands).

import IntentLink from "@/components/ui/IntentLink";
import { accentPhrase } from "@/components/ui/display";
import type { AboutCard } from "./content";

export default function AboutSection({ id, kicker, title, lede, cards, stack, fiction, source }: {
  /** Fragment id of the section (links.ts ABOUT_ANCHOR). */
  id: string;
  kicker: string;
  /** Two-voice heading (a <q> phrase becomes the accent). */
  title: string;
  lede: string;
  cards: AboutCard[];
  stack: string;
  fiction: string;
  source: { href: string; label: string; newTab: string };
}) {
  return (
    <section className="section about" id={id} aria-labelledby={`${id}-title`}>
      <div className="shell">
        <p className="kicker rv"><span className="label">{kicker}</span></p>
        <div className="split-head">
          <h2 className="h1 rv" id={`${id}-title`}>{accentPhrase(title)}</h2>
          <p className="lede rv">{lede}</p>
        </div>
        <ol className="steps stagger rv" role="list">
          {cards.map((c) => (
            <li key={c.key}>
              <IntentLink className="step" href={c.href} heavy={c.heavy}>
                <span className="step-n mono" aria-hidden>{c.n}</span>
                <h3 className="step-title">{c.title}</h3>
                <p className="step-figure">
                  {c.figure.before}{c.figure.number && <b>{c.figure.number}</b>}<span>{c.figure.after}</span>
                </p>
                <p className="step-text">{c.text}</p>
                <span className="arrow" aria-hidden>→</span>
              </IntentLink>
            </li>
          ))}
        </ol>
        <div className="about-foot rv">
          <p className="about-stack mono">{stack}</p>
          <p className="about-fiction">{fiction}</p>
          <a className="link-arrow" href={source.href} target="_blank" rel="noopener noreferrer">
            {source.label}<span className="sr-only"> {source.newTab}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
