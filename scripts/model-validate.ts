// Validates a house model and prints the report (errors, warnings, metrics, rooms).
//
//   npx tsx scripts/model-validate.ts [path/to/house.json] [--lang cs|en] [--json]
//
// Exit codes: 0 no errors (warnings are fine), 1 the model has errors, 2 input problem (file missing).
import fs from "node:fs";
import path from "node:path";
import { formatReport, validateHouseJson } from "../src/lib/model";

const root = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
const args = process.argv.slice(2);
const langIdx = args.indexOf("--lang");
const lang = langIdx >= 0 && args[langIdx + 1] === "en" ? "en" : "cs";
const asJson = args.includes("--json");
const file = args.find((a, i) => !a.startsWith("--") && !(langIdx >= 0 && i === langIdx + 1)) ?? path.join(root, "model", "house.json");

let text: string;
try {
  text = fs.readFileSync(file, "utf8");
} catch (err) {
  console.error(`Cannot read ${file}: ${(err as Error).message}`);
  process.exit(2);
}

const res = validateHouseJson(text);
if (asJson) {
  console.log(JSON.stringify({ valid: res.valid, errors: res.errors, warnings: res.warnings, metrics: res.metrics }, null, 2));
} else {
  console.log(formatReport(res, lang));
}
process.exit(res.valid ? 0 : 1);
