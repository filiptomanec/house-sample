// Type-safe translation: dictionaries are plain nested objects, keys are "namespace.path.to.leaf", parameters are
// {placeholders} that the types read from the Czech string, plurals are { one, few?, other } objects with a {count}.
// This file knows nothing about the actual dictionaries (see messages/index.ts), so it is safe to import anywhere.

import type { Locale } from "./config";
import { getFormatter, nb } from "./format";
import { pluralCategory } from "./plural";

export type PluralForms = { one: string; few?: string; other: string };
export type Leaf = string | PluralForms;
export type Tree = { [key: string]: Leaf | Tree };

/** The English dictionary must have the same shape as the Czech one (plural leaves may differ in forms). */
export type Mirror<T> = T extends PluralForms ? PluralForms : T extends string ? string : { readonly [K in keyof T]: Mirror<T[K]> };

/** Declares one namespace. TypeScript fails when `en` lacks a key of `cs` (or has a different leaf kind). */
export function defineMessages<const C extends Tree>(m: { cs: C; en: NoInfer<Mirror<C>> }): { cs: C; en: Mirror<C> } {
  return m;
}

// ------------------------------------------------------------------------------------------- key and parameter types

type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`;

/** "ns.a.b" for every leaf of a dictionary tree. */
export type LeafPaths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? Join<P, K> : LeafPaths<T[K], Join<P, K>>;
}[keyof T & string];

export type ValueAt<T, P extends string> = P extends `${infer H}.${infer R}` ? (H extends keyof T ? ValueAt<T[H], R> : never) : P extends keyof T ? T[P] : never;

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never;
type Forms<L> = L extends PluralForms ? L["one"] | L["other"] | (L["few"] extends string ? L["few"] : never) : L;
/** Names of the {placeholders} of a leaf; plurals always need `count`. */
export type ParamNames<L> = L extends PluralForms ? "count" | Placeholders<Forms<L>> : Placeholders<L>;

export type ParamValue = string | number;
export type ParamArgs<L> = [ParamNames<L>] extends [never] ? [] : [params: Record<ParamNames<L>, ParamValue>];

export interface TFunction<M> {
  <K extends LeafPaths<M>>(key: K, ...args: ParamArgs<ValueAt<M, K>>): string;
  readonly locale: Locale;
  /** True when the key exists (also for namespaces that were not loaded: false). Untyped on purpose, for dynamic keys. */
  has(key: string): boolean;
  /** Untyped lookup for keys built at run time; returns the key itself when missing. */
  dyn(key: string, params?: Record<string, ParamValue>): string;
}

// ------------------------------------------------------------------------------------------- runtime

const isPlural = (v: unknown): v is PluralForms => typeof v === "object" && v !== null && typeof (v as PluralForms).other === "string";

function lookup(messages: unknown, key: string): Leaf | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || isPlural(node) ? node : undefined;
}

function interpolate(text: string, params: Record<string, ParamValue> | undefined, locale: Locale, key: string): string {
  if (!text.includes("{")) return text;
  const f = getFormatter(locale);
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params?.[name];
    if (v === undefined) {
      if (process.env.NODE_ENV !== "production") console.warn(`[i18n] missing parameter "${name}" for "${key}"`);
      return whole;
    }
    return typeof v === "number" ? (Number.isInteger(v) ? f.int(v) : f.num(v, 0, 2)) : v;
  });
}

const warned = new Set<string>();

/** Looks a key up in a (possibly partial) set of namespaces, picks the plural form, fills in parameters, applies nb(). */
export function translate(locale: Locale, messages: unknown, key: string, params?: Record<string, ParamValue>): string {
  const leaf = lookup(messages, key);
  if (leaf === undefined) {
    if (process.env.NODE_ENV !== "production" && !warned.has(`${locale}:${key}`)) {
      warned.add(`${locale}:${key}`);
      console.warn(`[i18n] missing message "${key}" (${locale}); is its namespace loaded for this page?`);
    }
    return key;
  }
  let text: string;
  if (typeof leaf === "string") text = leaf;
  else {
    const n = Number(params?.count);
    text = leaf[pluralCategory(locale, Number.isFinite(n) ? n : 0)] ?? leaf.other;
  }
  return nb(interpolate(text, params, locale, key), locale);
}

/** A translator bound to a locale and a set of loaded namespaces. */
export function createT<M>(locale: Locale, messages: unknown): TFunction<M> {
  const t = ((key: string, params?: Record<string, ParamValue>) => translate(locale, messages, key, params)) as unknown as TFunction<M>;
  Object.defineProperties(t, {
    locale: { value: locale, enumerable: true },
    has: { value: (key: string) => lookup(messages, key) !== undefined },
    dyn: { value: (key: string, params?: Record<string, ParamValue>) => translate(locale, messages, key, params) },
  });
  return t;
}
