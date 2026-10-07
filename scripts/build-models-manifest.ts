// Writes public/models/manifest.json: for every file in public/models (except the manifest itself) the SHA-256 of its
// content and its size; for GLB files also triangle count, node count and bounding box in the house frame (x east, y north,
// z up, metres). The manifest carries the inputHash of generated/derived.json (the model the files were built from) and
// a content hash over all files, which the web uses as the `?v=` cache-buster.
//
//   npx tsx scripts/build-models-manifest.ts            write public/models/manifest.json
//   npx tsx scripts/build-models-manifest.ts --check    write nothing; exit 1 when the manifest is stale
//   options: --dir <models dir>  --derived <derived.json>  --out <manifest path>
//
// Exit codes: 0 ok, 1 stale manifest (--check) or a GLB that cannot be parsed, 2 input problem.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { analyzeGlb, parseGlb } from "./verify-glb";

export interface ManifestFile {
  sha256: string;
  bytes: number;
  triangles?: number;
  nodes?: number;
  bbox?: { min: number[]; max: number[] };
}
export interface ModelsManifest {
  schema: "models/1";
  frame: string;
  inputHash: string | null;
  hash: string;
  files: Record<string, ManifestFile>;
}

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0; // + 0 turns -0 into 0
const sha256 = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");

export function buildManifest(dir: string, inputHash: string | null): ModelsManifest {
  const files: Record<string, ManifestFile> = {};
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== "manifest.json" && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const buf = fs.readFileSync(path.join(dir, name));
    const entry: ManifestFile = { sha256: sha256(buf), bytes: buf.length };
    if (name.endsWith(".glb")) {
      const a = analyzeGlb(parseGlb(buf));
      entry.triangles = a.triangles;
      entry.nodes = a.nodes.length;
      entry.bbox = { min: a.bbox.min.map(r4), max: a.bbox.max.map(r4) };
    }
    files[name] = entry;
  }
  const hash = sha256(Buffer.from(names.map((n) => `${n}:${files[n].sha256}`).join("\n")));
  return { schema: "models/1", frame: "house (x east, y north, z up, metres)", inputHash, hash, files };
}

function main(): number {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const root = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const dir = opt("--dir") ?? path.join(root, "public", "models");
  const derivedPath = opt("--derived") ?? path.join(root, "generated", "derived.json");
  const out = opt("--out") ?? path.join(dir, "manifest.json");
  if (!fs.existsSync(dir)) {
    console.error(`${dir} does not exist`);
    return 2;
  }
  let inputHash: string | null = null;
  if (fs.existsSync(derivedPath)) {
    const d = JSON.parse(fs.readFileSync(derivedPath, "utf8")) as { inputHash?: string };
    inputHash = d.inputHash ?? null;
  } else {
    console.warn(`warning: ${derivedPath} not found, inputHash is null`);
  }
  let manifest: ModelsManifest;
  try {
    manifest = buildManifest(dir, inputHash);
  } catch (e) {
    console.error(`cannot build the manifest: ${(e as Error).message}`);
    return 1;
  }
  const text = JSON.stringify(manifest, null, 2) + "\n";
  if (args.includes("--check")) {
    const have = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    if (have !== text) {
      console.error(`STALE: ${path.relative(root, out)}`);
      return 1;
    }
    console.log(`${path.relative(root, out)} is up to date`);
    return 0;
  }
  fs.writeFileSync(out, text);
  console.log(`wrote ${path.relative(root, out)}: ${Object.keys(manifest.files).length} files, hash ${manifest.hash.slice(0, 12)}`);
  return 0;
}

if (process.argv[1] && /build-models-manifest\.[cm]?[jt]s$/.test(process.argv[1])) process.exit(main());
