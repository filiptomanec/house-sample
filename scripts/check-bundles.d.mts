export const LOCALES: string[];
export const ROUTES: Record<string, { cs: string; en: string }>;
export const THREE_ROUTES: Set<string>;
export const THREE_SIGNATURE: string;
export const BUDGET_KB: { plain: number; three: number };
export function chunkRefs(text: string): Set<string>;
export function externalResources(html: string): string[];
export function findHtml(appDir: string, locale: string, key: string): string | null;
export type BundleRow = {
  locale: string; key: string; path: string; html: string; initial: Set<string>;
  chunks: number; lazy: number; kb: number; three: boolean; threeIn: string[]; missing: string[];
};
export function analyzeBuild(buildDir: string): { rows: BundleRow[]; errors: string[]; warnings: string[] };
