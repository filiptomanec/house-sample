// Rich text in translations: a string such as "See <a>the floor plan</a> or <b>read on</b>." becomes React nodes.
// Only the tags you pass are interpreted; everything else stays text. Tags do not nest in the same name.

import { Fragment, type ReactNode } from "react";

export type RichTags = Record<string, (children: ReactNode) => ReactNode>;

export function rich(text: string, tags: RichTags): ReactNode[] {
  const out: ReactNode[] = [];
  const names = Object.keys(tags);
  if (!names.length) return [text];
  const open = new RegExp(`<(${names.join("|")})>`);
  let rest = text, i = 0;
  while (rest) {
    const m = open.exec(rest);
    if (!m) { out.push(rest); break; }
    const close = `</${m[1]}>`;
    const end = rest.indexOf(close, m.index + m[0].length);
    if (end === -1) { out.push(rest); break; }
    if (m.index) out.push(rest.slice(0, m.index));
    const inner = rest.slice(m.index + m[0].length, end);
    out.push(<Fragment key={i++}>{tags[m[1]](rich(inner, tags))}</Fragment>);
    rest = rest.slice(end + close.length);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- two-voice headings

/**
 * Tags of a two-voice heading. A title such as "Dům a zahrada <q>ve 3D</q>" marks its accent phrase with <q>; it renders
 * as <span class="accent"> (the italic serif of --font-accent, docs/DESIGN.md), never as a quotation. One accent per heading.
 */
export const ACCENT_TAGS: RichTags = { q: (c) => <span className="accent">{c}</span> };

/** A heading with its accent phrase rendered: <h1>{accent(t("plot.title", { area }))}</h1>. Text without <q> comes back as is. */
export const accent = (text: string): ReactNode[] => rich(text, ACCENT_TAGS);

/** The text of a rich string without its tags, for <title>, og:title, aria-label and alt: "Dům a zahrada ve 3D". */
export const plainText = (text: string): string => text.replace(/<\/?[a-z]+>/g, "");
