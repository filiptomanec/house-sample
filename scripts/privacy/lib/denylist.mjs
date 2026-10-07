// Loading and compiling the local denylist (.privacy/denylist.local.json, git-ignored).
//
// Shape: { version, salt?, categories: { <name>: { literals: [...], regexes: [...], numbers: [...], sequences: [...] } } }
//   literals   strings or { v, mode } (see matcher.mjs)
//   regexes    JavaScript regular expression sources, matched against the NORMALISED (lower-case, ASCII) text
//   numbers    { value, tol, label, strength?, keys? }
//   sequences  { values, tol, label, min? }
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SALT, DENYLIST_REL } from "./config.mjs";
import { LiteralMatcher } from "./matcher.mjs";
import { NumberIndex } from "./numbers.mjs";
import { isGitRepo, isIgnored, isTracked } from "./git.mjs";

/**
 * Compile a denylist object (already parsed) into matching rules.
 * @param {any} data
 */
export function compileRules(data) {
  const categories = data && typeof data === "object" && data.categories && typeof data.categories === "object" ? data.categories : {};
  const entries = [];
  const regexes = [];
  let invalid = 0;
  const stats = { literals: 0, regexes: 0, numbers: 0, sequences: 0 };
  for (const [cat, body] of Object.entries(categories)) {
    if (!body || typeof body !== "object") continue;
    for (const spec of Array.isArray(body.literals) ? body.literals : []) {
      entries.push({ category: cat, spec });
      stats.literals++;
    }
    for (const src of Array.isArray(body.regexes) ? body.regexes : []) {
      try {
        regexes.push({ category: cat, re: new RegExp(String(src), "giu") });
        stats.regexes++;
      } catch {
        invalid++;
      }
    }
    stats.numbers += Array.isArray(body.numbers) ? body.numbers.length : 0;
    stats.sequences += Array.isArray(body.sequences) ? body.sequences.length : 0;
  }
  const numbers = new NumberIndex(categories);
  return {
    matcher: new LiteralMatcher(entries),
    regexes,
    numbers,
    salt: typeof data?.salt === "string" && data.salt ? data.salt : DEFAULT_SALT,
    stats,
    invalid,
    isEmpty: entries.length === 0 && regexes.length === 0 && numbers.empty,
  };
}

/** Rules without any denylist (generic detectors only). */
export function emptyRules() {
  return compileRules({ categories: {} });
}

/**
 * Safety checks before the denylist is used. Problems are returned as plain messages (never the content).
 * - the file must not be tracked by git and must be covered by an ignore rule when it lives inside the repository
 * - the file should not be readable by other users
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function checkDenylistSafety(root, file) {
  const problems = [];
  const warnings = [];
  const rel = path.relative(root, file);
  const inside = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  if (inside && isGitRepo(root)) {
    if (isTracked(root, rel)) problems.push("the denylist file is tracked by git");
    else if (!isIgnored(root, rel)) problems.push("the denylist file is not covered by a gitignore rule");
    // any other tracked file inside .privacy/ is also suspicious
  }
  try {
    const st = fs.statSync(file);
    if (st.mode & 0o077) warnings.push("the denylist file is accessible to other users (chmod 600 recommended)");
  } catch {
    // missing file is handled by the caller
  }
  return { problems, warnings };
}

/** Read and parse the denylist file. Returns null when the file does not exist. Throws on invalid JSON without echoing content. */
export function readDenylist(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || typeof data.categories !== "object") throw new Error("shape");
    return data;
  } catch {
    throw new Error("the denylist file is not valid (expected JSON with a `categories` object)");
  }
}

/** Merge a second denylist (same shape) into the first: categories are united, arrays concatenated. */
export function mergeDenylists(a, b) {
  const out = { ...a, categories: { ...a.categories } };
  for (const [name, body] of Object.entries(b.categories ?? {})) {
    const into = (out.categories[name] = { ...(out.categories[name] ?? {}) });
    for (const key of ["literals", "regexes", "numbers", "sequences"]) {
      if (Array.isArray(body?.[key])) into[key] = [...(into[key] ?? []), ...body[key]];
    }
  }
  return out;
}

/** Name of the optional hand-written extension of the generated denylist (same directory, same safety rules). */
export const EXTRA_DENYLIST_NAME = "denylist.extra.json";

export function defaultDenylistPath(root) {
  return path.join(root, DENYLIST_REL);
}
