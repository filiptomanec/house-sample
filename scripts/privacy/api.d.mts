// Type declarations for the privacy scanner API (the implementation is plain ESM JavaScript).

export interface Finding {
  category: string;
  path: string;
  source?: string;
  line?: number;
  col?: number;
  offset?: number;
  field?: string;
  view?: string;
  hash8: string;
  ctx?: string;
}

export interface Stats {
  files: number;
  bytes: number;
  skipped: number;
  objects: number;
  cached: number;
}

export interface Scanner {
  scanText(text: string, loc: { path: string; source?: string; field?: string; kind?: string; noisy?: boolean }): Finding[];
  accept(findings: Finding[]): Finding[];
  mask(s: string): string;
  hash8(value: string): string;
}

export interface Context {
  root: string;
  scanner: Scanner;
  warnings: string[];
  hasDenylist: boolean;
}

export interface ContextOptions {
  root?: string;
  denylist?: string;
  denylistData?: object;
  allowlist?: string;
  allowlistData?: object;
  strict?: boolean;
  identities?: { name: string; email: string }[];
  numbers?: boolean;
  generic?: boolean;
  cache?: boolean;
}

export interface Modes {
  tree?: boolean;
  staged?: boolean;
  history?: boolean;
  identity?: boolean;
  build?: string[];
  media?: string[];
  message?: string;
  remoteUrl?: string;
}

export class RefusalError extends Error {}

export function createContext(opts?: ContextOptions): Context;
export function runScan(ctx: Context, modes: Modes): Promise<{ findings: Finding[]; rawCount: number; stats: Stats; warnings: string[] }>;
export function scanBufferContent(ctx: Context, buf: Buffer | string, filePath?: string): Finding[];
export function renderText(scanner: Scanner, findings: Finding[], info: { stats: Stats; warnings: string[] }): string;
export function renderJson(scanner: Scanner, findings: Finding[], info: { stats: Stats; warnings: string[] }): string;

export const AUTHOR_HANDLE: string;
export const AUTHOR_NAME: string;
export const AUTHOR_NOREPLY: string;

export function normalizeText(s: string): { text: string; map: Uint32Array | null };
export function decodeViews(raw: string): { name: string; text: string }[];
export function runGeneric(text: string, ctx: { allowlist: unknown; kind?: string; skip?: Set<string>; binary?: boolean }): { category: string; index: number; length: number; value: string }[];
export function extractNumbers(text: string, mode: "point" | "comma"): { vals: number[]; starts: number[]; ends: number[]; thousands: { v: number; start: number; end: number }[] };
export class NumberIndex {
  constructor(categories: Record<string, object>);
  empty: boolean;
  scan(text: string): { category: string; index: number; length: number; value: string; kind: string }[];
}
export class LiteralMatcher {
  constructor(entries: { category: string; spec: unknown }[]);
  scanNormalized(norm: string): { start: number; end: number; entry: number }[];
}
