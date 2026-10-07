// Builds generated/derived.json (geometry derived from the model, read by the Blender pipeline) and exports
// model/house.schema.json from the zod schema.
//
//   npx tsx scripts/build-derived.ts            validate, write generated/derived.json and model/house.schema.json
//   npx tsx scripts/build-derived.ts --check    write nothing; exit 1 when the committed files are stale
//
// Exit codes: 0 ok, 1 model has errors or (with --check) generated files are stale, 2 input/IO problem.
import fs from "node:fs";
import path from "node:path";
import { formatReport, hashModelFiles, houseJsonSchema, isHashedModelFile, validateHouseJson } from "../src/lib/model";

const root = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
const modelDir = path.join(root, "model");
const check = process.argv.includes("--check");

/** Stable JSON text: numbers rounded to 9 decimals so the output does not depend on float noise. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e9) / 1e9 : v), 2) + "\n";

function main(): number {
  let files: { name: string; content: string }[];
  try {
    files = fs
      .readdirSync(modelDir)
      .filter(isHashedModelFile)
      .map((name) => ({ name, content: fs.readFileSync(path.join(modelDir, name), "utf8") }));
  } catch (err) {
    console.error(`Cannot read ${modelDir}: ${(err as Error).message}`);
    return 2;
  }
  const houseFile = files.find((f) => f.name === "house.json");
  if (!houseFile) {
    console.error("model/house.json is missing");
    return 2;
  }
  const inputHash = hashModelFiles(files);
  const res = validateHouseJson(houseFile.content, { inputHash });
  console.log(formatReport(res, "en"));
  if (!res.valid || !res.derived) return 1;

  const outputs: [string, string][] = [
    [path.join(root, "generated", "derived.json"), stable(res.derived)],
    [path.join(modelDir, "house.schema.json"), stable(houseJsonSchema())],
  ];
  if (check) {
    let stale = 0;
    for (const [file, text] of outputs) {
      const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (have !== text) {
        console.error(`STALE: ${path.relative(root, file)}`);
        stale++;
      }
    }
    return stale ? 1 : 0;
  }
  for (const [file, text] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${path.relative(root, file)} (${text.length} bytes)`);
  }
  console.log(`inputHash ${inputHash}`);
  return 0;
}

process.exit(main());
