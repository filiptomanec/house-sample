// Pure, client-safe exports of the i18n layer. The dictionaries themselves are not re-exported here (see messages/index.ts).
export * from "./config";
export * from "./format";
export * from "./plural";
export { createT, defineMessages, translate } from "./translate";
export type { LeafPaths, Mirror, ParamNames, PluralForms, TFunction } from "./translate";
