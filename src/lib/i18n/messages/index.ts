// All dictionaries. SERVER ONLY: importing this file from a client component would ship every language and namespace
// to the browser. Client components get the namespaces they need through <I18n namespaces={[...]}> (see ../Provider.tsx).

import type { Locale } from "../config";
import type { LeafPaths, Tree, TFunction } from "../translate";
import budget from "./budget";
import common from "./common";
import energy from "./energy";
import errors from "./errors";
import footer from "./footer";
import gallery from "./gallery";
import home from "./home";
import model from "./model";
import nav from "./nav";
import plan from "./plan";
import plot from "./plot";
import sun from "./sun";

export const MESSAGES = { common, nav, footer, home, plan, plot, model, sun, energy, budget, gallery, errors } as const;

export type Namespace = keyof typeof MESSAGES;
export const NAMESPACES = Object.keys(MESSAGES) as Namespace[];

/** The shape of all dictionaries (taken from the Czech side; English mirrors it). */
export type Messages = { [N in Namespace]: (typeof MESSAGES)[N]["cs"] };
export type MessageKey = LeafPaths<Messages>;
export type T = TFunction<Messages>;

/** Plain serialisable object with the given namespaces of one locale, for the client provider. */
export function messagesFor(locale: Locale, namespaces: readonly Namespace[]): Partial<Record<Namespace, Tree>> {
  const out: Partial<Record<Namespace, Tree>> = {};
  for (const ns of namespaces) out[ns] = MESSAGES[ns][locale] as Tree;
  return out;
}
