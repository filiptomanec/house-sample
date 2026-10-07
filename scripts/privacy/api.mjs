// Programmatic API of the privacy scanner (used by scan.mjs and by the tests).
import fs from "node:fs";
import path from "node:path";
import { ALLOWLIST_REL, ALLOWED_IDENTITIES } from "./lib/config.mjs";
import { createAllowlist, loadLocalAllowlist } from "./lib/allowlist.mjs";
import { EXTRA_DENYLIST_NAME, checkDenylistSafety, compileRules, defaultDenylistPath, emptyRules, mergeDenylists, readDenylist } from "./lib/denylist.mjs";
import { isGitRepo, repoRoot, trackedUnder } from "./lib/git.mjs";
import { renderJson, renderText } from "./lib/report.mjs";
import { Scanner } from "./lib/scanner.mjs";
import { scanContent } from "./lib/scan-file.mjs";
import { checkCurrentIdentity, checkRemoteUrl, scanBuild, scanHistory, scanMedia, scanMessage, scanStaged, scanTree } from "./lib/sources.mjs";

/** An error that makes the scanner refuse to run (exit code 2). */
export class RefusalError extends Error {}

/**
 * Create a scanning context.
 * @param {{ root?: string, denylist?: string, denylistData?: object, allowlist?: string, allowlistData?: object, strict?: boolean,
 *           identities?: { name: string, email: string }[], numbers?: boolean, generic?: boolean, cache?: boolean }} opts
 */
export function createContext(opts = {}) {
  const cwd = process.cwd();
  const root = path.resolve(opts.root ?? repoRoot(cwd) ?? cwd);
  const warnings = [];
  const denylistPath = opts.denylist ? path.resolve(opts.denylist) : defaultDenylistPath(root);

  let data = opts.denylistData ?? null;
  if (!data) {
    if (fs.existsSync(denylistPath)) {
      const safety = checkDenylistSafety(root, denylistPath);
      if (safety.problems.length) throw new RefusalError(`refusing to run: ${safety.problems.join("; ")}`);
      warnings.push(...safety.warnings);
      try {
        data = readDenylist(denylistPath);
        const extra = path.join(path.dirname(denylistPath), EXTRA_DENYLIST_NAME);
        if (fs.existsSync(extra)) {
          const more = readDenylist(extra);
          if (more) data = mergeDenylists(data, more);
        }
      } catch (err) {
        throw new RefusalError(String(err.message));
      }
    } else if (opts.strict) {
      throw new RefusalError("refusing to run: the local denylist is missing (create it, or run without --strict for the generic checks only)");
    } else {
      warnings.push("no local denylist found: only the generic detectors ran");
    }
  }
  if (isGitRepo(root)) {
    if (trackedUnder(root, ".privacy").length) throw new RefusalError("refusing to run: files under .privacy/ are tracked by git");
  }
  const rules = data ? compileRules(data) : emptyRules();
  if (rules.invalid) warnings.push(`${rules.invalid} denylist regular expression(s) could not be compiled`);

  const localAllow = opts.allowlistData ?? loadLocalAllowlist(opts.allowlist ? path.resolve(opts.allowlist) : path.join(root, ALLOWLIST_REL));
  const allowlist = createAllowlist(localAllow);
  const identities = opts.identities ?? ALLOWED_IDENTITIES;
  const scanner = new Scanner({ rules, allowlist, options: { numbers: opts.numbers !== false, generic: opts.generic !== false } });
  const fingerprint = JSON.stringify([data ?? null, localAllow ?? null, identities, opts.numbers !== false, opts.generic !== false]);
  return { root, scanner, rules, allowlist, identities, warnings, fingerprint, useCache: opts.cache !== false, hasDenylist: Boolean(data) };
}

/**
 * Run the selected scans.
 * @param {ReturnType<typeof createContext>} ctx
 * @param {{ tree?: boolean, staged?: boolean, history?: boolean, identity?: boolean, build?: string[], media?: string[], message?: string, remoteUrl?: string }} modes
 */
export async function runScan(ctx, modes) {
  const parts = [];
  if (modes.staged) parts.push(await scanStaged(ctx));
  if (modes.tree) parts.push(scanTree(ctx));
  if (modes.history) parts.push(await scanHistory(ctx));
  if (modes.identity) parts.push(checkCurrentIdentity(ctx));
  for (const d of modes.build ?? []) parts.push(scanBuild(ctx, d));
  for (const d of modes.media ?? []) parts.push(scanMedia(ctx, d));
  if (modes.message) parts.push(scanMessage(ctx, modes.message));
  if (modes.remoteUrl) parts.push(checkRemoteUrl(ctx, modes.remoteUrl));
  const raw = parts.flatMap((p) => p.findings);
  const findings = ctx.scanner.accept(raw);
  const stats = { files: 0, bytes: 0, skipped: 0, objects: 0, cached: 0 };
  for (const p of parts) for (const k of Object.keys(stats)) stats[k] += p.stats[k] ?? 0;
  return { findings, rawCount: raw.length, stats, warnings: ctx.warnings };
}

/** Scan a text or buffer directly (tests and tooling). Returns findings after the allowlist. */
export function scanBufferContent(ctx, buf, filePath = "memory.txt") {
  const stats = { files: 0, bytes: 0, skipped: 0 };
  return ctx.scanner.accept(scanContent(ctx.scanner, Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8"), { path: filePath, source: "memory" }, 0, stats));
}

export { renderJson, renderText };
export { AUTHOR_HANDLE, AUTHOR_NAME, AUTHOR_NOREPLY } from "./lib/config.mjs";
export { decodeViews, normalizeText } from "./lib/normalize.mjs";
export { runGeneric } from "./lib/generic.mjs";
export { NumberIndex, extractNumbers } from "./lib/numbers.mjs";
export { LiteralMatcher } from "./lib/matcher.mjs";
