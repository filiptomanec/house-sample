// Scan sources: working tree, staged files, git history, build output, media directories, commit messages.
import fs from "node:fs";
import path from "node:path";
import { AUTHOR_HANDLE, BUILD_SKIP_DIRS, MAX_FILE_BYTES, WALK_SKIP_DIRS } from "./config.mjs";
import { CleanCache } from "./cache.mjs";
import { catFileObjects, currentIdentities, headRef, isGitRepo, listRefs, localConfig, objectFormatBytes, objectPaths, parseTree, stagedFiles, treeFiles } from "./git.mjs";
import { scanContent } from "./scan-file.mjs";

const newStats = () => ({ files: 0, bytes: 0, skipped: 0, objects: 0, cached: 0 });

/** Recursively list files of a directory (relative paths, no symlinks). */
export function walkDir(dir, { skipTop = new Set(), skipAll = new Set() } = {}) {
  const out = [];
  (function rec(rel) {
    const abs = path.join(dir, rel);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) {
        out.push({ rel: r, link: true });
      } else if (ent.isDirectory()) {
        if (skipAll.has(ent.name) || (!rel && skipTop.has(ent.name))) continue;
        rec(r);
      } else if (ent.isFile()) out.push({ rel: r });
    }
  })("");
  return out;
}

function scanOneFile(ctx, absRoot, entry, source, display, stats, findings) {
  const { scanner } = ctx;
  findings.push(...scanner.scanName(display, { path: display, source, field: "file-name" }));
  const abs = path.join(absRoot, entry.rel);
  try {
    if (entry.link) {
      findings.push(...scanner.scanText(fs.readlinkSync(abs), { path: display, source, field: "symlink-target", noisy: true }));
      return;
    }
    const st = fs.statSync(abs);
    if (!st.isFile()) return;
    if (st.size > MAX_FILE_BYTES) {
      stats.skipped++;
      return;
    }
    findings.push(...scanContent(scanner, fs.readFileSync(abs), { path: display, source }, 0, stats));
  } catch (err) {
    if (err && err.code === "ENOENT") return; // tracked but deleted in the working tree
    stats.skipped++;
  }
}

/** Working tree: tracked files plus untracked files that are not ignored (or a plain directory walk outside git). */
export function scanTree(ctx) {
  const stats = newStats();
  const findings = [];
  const root = ctx.root;
  const rels = isGitRepo(root) ? treeFiles(root).map((rel) => ({ rel })) : walkDir(root, { skipAll: WALK_SKIP_DIRS });
  for (const entry of rels) {
    scanOneFile(ctx, root, entry, "tree", entry.rel, stats, findings);
  }
  return { findings, stats };
}

/** Staged files (the index version) and their names. */
export async function scanStaged(ctx) {
  const stats = newStats();
  const findings = [];
  const files = stagedFiles(ctx.root);
  const bySha = new Map();
  for (const f of files) {
    findings.push(...ctx.scanner.scanName(f.path, { path: f.path, source: "staged", field: "file-name" }));
    if (!bySha.has(f.sha)) bySha.set(f.sha, []);
    bySha.get(f.sha).push(f.path);
  }
  if (bySha.size) {
    for await (const obj of catFileObjects(ctx.root, { shas: [...bySha.keys()], maxBytes: MAX_FILE_BYTES })) {
      const paths = bySha.get(obj.sha) ?? [];
      if (!obj.buf) {
        stats.skipped++;
        continue;
      }
      for (const p of paths) findings.push(...scanContent(ctx.scanner, obj.buf, { path: p, source: "staged" }, 0, stats));
    }
  }
  return { findings, stats };
}

/** Build output directory (for example .next or out). Caches and dev artefacts are skipped. */
export function scanBuild(ctx, dir) {
  const stats = newStats();
  const findings = [];
  const abs = path.resolve(ctx.root, dir);
  if (!fs.existsSync(abs)) throw new Error("build directory does not exist");
  for (const entry of walkDir(abs, { skipTop: BUILD_SKIP_DIRS })) {
    scanOneFile(ctx, abs, entry, "build", `${path.basename(abs)}/${entry.rel}`, stats, findings);
  }
  return { findings, stats };
}

/** Media directory: images, video, models, anything. */
export function scanMedia(ctx, dir) {
  const stats = newStats();
  const findings = [];
  const abs = path.resolve(ctx.root, dir);
  if (!fs.existsSync(abs)) throw new Error("media directory does not exist");
  const display = path.relative(ctx.root, abs);
  const prefix = display && !display.startsWith("..") ? display : path.basename(abs);
  for (const entry of walkDir(abs)) {
    scanOneFile(ctx, abs, entry, "media", `${prefix}/${entry.rel}`, stats, findings);
  }
  return { findings, stats };
}

/** A commit message file (commit-msg hook). Comment lines are ignored. */
export function scanMessage(ctx, file) {
  const text = fs.readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n");
  const findings = ctx.scanner.scanText(text, { path: "COMMIT_MESSAGE", source: "message", field: "message", kind: "docs", noisy: true });
  return { findings, stats: newStats() };
}

/**
 * A remote URL: the denylist always applies; network remotes must be the project repository. Local paths are fine
 * (they are never published), so the generic detectors do not look at them.
 */
function remoteUrlFindings(ctx, url, source) {
  const networked = /^(?:https?|ssh|git|ftp):\/\//i.test(url) || /^[\w.-]+@[\w.-]+:/.test(url);
  const findings = ctx.scanner.scanText(url, { path: "remote-url", source, noisy: true, field: "url", skipGeneric: !networked });
  const allowed = new RegExp(`^(?:https:\\/\\/github\\.com\\/|git@github\\.com:|ssh:\\/\\/git@github\\.com\\/)${AUTHOR_HANDLE}\\/house-sample(?:\\.git)?\\/?$`, "i");
  if (networked && !allowed.test(url)) {
    findings.push({ category: "remote/url", path: "remote-url", source, field: "url", hash8: ctx.scanner.hash8(`remote:${url.toLowerCase()}`) });
  }
  return findings;
}

/** The URL a push goes to: network remotes must be the project repository. */
export function checkRemoteUrl(ctx, url) {
  return { findings: remoteUrlFindings(ctx, url, "push"), stats: newStats() };
}

function identityFindings(ctx, label, line, sha8, source) {
  const m = /^(.*?) <([^>]*)> \d+ [+-]\d{4}$/.exec(line);
  const out = [];
  if (!m) return out;
  const ok = ctx.identities.some((i) => i.name === m[1] && i.email.toLowerCase() === m[2].toLowerCase());
  if (!ok) out.push({ category: `identity/${label}`, path: `commit:${sha8}`, source, field: label, hash8: ctx.scanner.hash8(`id:${m[1]}<${m[2].toLowerCase()}>`) });
  return out;
}

/** Check the identities git would use for the next commit. */
export function checkCurrentIdentity(ctx) {
  const ids = currentIdentities(ctx.root);
  const findings = [];
  for (const [label, line] of Object.entries(ids)) {
    if (line) findings.push(...identityFindings(ctx, label, line, "config", "config"));
  }
  return { findings, stats: newStats() };
}

/**
 * Whole history: refs, every object in the database (reachable or not, once per object id), commit and tag headers, tree entry
 * names, remote URLs.
 */
export async function scanHistory(ctx) {
  const { scanner, root } = ctx;
  const stats = newStats();
  const findings = [];
  if (!isGitRepo(root)) return { findings, stats };

  // ref names, HEAD and repository configuration (remote URLs)
  for (const ref of [...listRefs(root), headRef(root)].filter(Boolean)) {
    findings.push(...scanner.scanName(ref, { path: `ref:${ref}`, source: "ref", field: "ref-name" }));
  }
  const config = localConfig(root);
  findings.push(...scanner.scanText(config, { path: "git-config", source: "config", kind: "code", noisy: true, skipGeneric: true }));
  for (const line of config.split("\n")) {
    const m = /^remote\.[^=]*\.(?:push)?url=(.*)$/.exec(line);
    if (m) findings.push(...remoteUrlFindings(ctx, m[1], "config"));
  }

  const paths = objectPaths(root);
  const hashBytes = objectFormatBytes(root);
  const cache = ctx.useCache ? new CleanCache(root, ctx.fingerprint) : null;

  for await (const obj of catFileObjects(root, { all: true, maxBytes: MAX_FILE_BYTES })) {
    stats.objects++;
    if (cache?.has(obj.sha)) {
      stats.cached++;
      continue;
    }
    const sha8 = obj.sha.slice(0, 8);
    const source = `history:${sha8}`;
    const before = findings.length;
    if (!obj.buf) {
      stats.skipped++;
      continue;
    }
    if (obj.type === "commit" || obj.type === "tag") {
      const text = obj.buf.toString("utf8");
      const display = `${obj.type}:${sha8}`;
      findings.push(...scanner.scanText(text, { path: display, source, kind: "docs", noisy: true, field: obj.type }));
      const head = text.split("\n\n")[0];
      for (const line of head.split("\n")) {
        const kind = /^(author|committer|tagger) /.exec(line);
        if (kind) findings.push(...identityFindings(ctx, kind[1], line.slice(kind[0].length), sha8, source));
      }
    } else if (obj.type === "tree") {
      const hint = paths.get(obj.sha) ?? `tree:${sha8}`;
      for (const ent of parseTree(obj.buf, hashBytes)) {
        findings.push(...scanner.scanName(ent.name, { path: hint, source, field: "entry-name" }));
      }
    } else if (obj.type === "blob") {
      const display = paths.get(obj.sha) ?? `blob:${sha8}`;
      findings.push(...scanContent(scanner, obj.buf, { path: display, source }, 0, stats));
    }
    if (cache && findings.length === before) cache.add(obj.sha);
  }
  cache?.save();
  return { findings, stats };
}
