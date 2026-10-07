import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(__dirname, "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });

describe("client bundles stay small", () => {
  // A client component must not import the dictionaries index, the server translator or the server provider:
  // that would ship every namespace of both languages to the browser. It gets what it needs from useT() / the provider.
  const forbidden = [/from\s+["'](?:@\/lib\/i18n|\.\.?(?:\/\.\.)*|\.)\/messages["']/, /from\s+["'](?:@\/lib\/i18n|\.\/|\.\.\/i18n)\/?(?:server|Provider|metadata)["']/];
  it("no 'use client' file imports i18n/messages (the index), server, Provider or metadata at run time", () => {
    const offenders = walk(src)
      .filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => /^import\s/.test(l) && !/^import\s+type\s/.test(l) && forbidden.some((re) => re.test(l))).map((l) => `${f.replace(src, "src")}: ${l.trim()}`));
    expect(offenders).toEqual([]);
  });
});
