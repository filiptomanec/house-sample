import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashModelFiles, isHashedModelFile, sha256Hex, shortHash } from "../hash";
import { repoRoot } from "./helpers";

const ref = (data: string | Uint8Array): string => crypto.createHash("sha256").update(data).digest("hex");

describe("sha256Hex", () => {
  it("matches node:crypto on strings around the block boundaries", () => {
    for (const n of [0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = "a".repeat(n);
      expect(sha256Hex(s), `length ${n}`).toBe(ref(s));
    }
  });
  it("handles unicode and raw bytes", () => {
    const s = "Dům u cesty – žluťoučký kůň ✓";
    expect(sha256Hex(s)).toBe(ref(s));
    const bytes = new Uint8Array(100000).map((_, i) => (i * 31 + 7) & 255);
    expect(sha256Hex(bytes)).toBe(ref(bytes));
  });
  it("known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("hashModelFiles", () => {
  const files = [
    { name: "house.json", content: '{"a":1}\n' },
    { name: "site.json", content: '{"b":2}\n' },
    { name: "house.schema.json", content: "{}" },
    { name: "notes.txt", content: "ignored" },
  ];
  it("follows the documented definition", () => {
    const message = 'house.json\0{"a":1}\n\0site.json\0{"b":2}\n\0';
    expect(hashModelFiles(files)).toBe(ref(message));
  });
  it("ignores generated schemas and non-json files, the order of the list and CRLF", () => {
    const base = hashModelFiles(files);
    expect(hashModelFiles([...files].reverse())).toBe(base);
    expect(hashModelFiles(files.map((f) => ({ ...f, content: f.content.replace(/\n/g, "\r\n") })))).toBe(base);
    expect(isHashedModelFile("house.schema.json")).toBe(false);
    expect(isHashedModelFile("pricebook.json")).toBe(true);
  });
  it("changes when a file changes, is added or renamed", () => {
    const base = hashModelFiles(files);
    expect(hashModelFiles([{ ...files[0], content: '{"a":2}\n' }, files[1]])).not.toBe(base);
    expect(hashModelFiles([files[0]])).not.toBe(base);
    expect(hashModelFiles([{ ...files[0], name: "other.json" }, files[1]])).not.toBe(base);
  });
  it("hashes the real model directory", () => {
    const dir = path.join(repoRoot, "model");
    const real = fs.readdirSync(dir).filter(isHashedModelFile).map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), "utf8") }));
    const h = hashModelFiles(real);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(shortHash(h)).toHaveLength(12);
    expect(real.map((f) => f.name)).toContain("house.json");
  });
});
