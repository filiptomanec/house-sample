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
