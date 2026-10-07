// Thin git helpers (no shell, argument arrays only).
import { spawn, spawnSync } from "node:child_process";

const BASE_ARGS = ["-c", "core.quotepath=false", "-c", "core.fsmonitor=false"];

/** Run git synchronously. Returns { status, stdout: Buffer, stderr: string }. */
export function git(root, args, input) {
  const r = spawnSync("git", [...BASE_ARGS, ...args], { cwd: root, input, maxBuffer: 1 << 30, stdio: ["pipe", "pipe", "pipe"] });
  return { status: r.status ?? 1, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr ? r.stderr.toString("utf8") : "" };
}

/** Run git and return trimmed stdout text, or null on failure. */
export function gitText(root, args) {
  const r = git(root, args);
  return r.status === 0 ? r.stdout.toString("utf8").trim() : null;
}

export function repoRoot(dir) {
  return gitText(dir, ["rev-parse", "--show-toplevel"]);
}

const repoCache = new Map();

/** Memoised per directory: repositories do not appear or vanish during one run. */
export function isGitRepo(dir) {
  if (!repoCache.has(dir)) repoCache.set(dir, gitText(dir, ["rev-parse", "--is-inside-work-tree"]) === "true");
  return repoCache.get(dir);
}

/** Tracked paths below a directory prefix (cheap alternative to listing every tracked file). */
export function trackedUnder(root, prefix) {
  const r = git(root, ["ls-files", "-z", "--", prefix]);
  return r.status === 0 ? splitZ(r.stdout) : [];
}

/** NUL-separated list helper. */
const splitZ = (buf) => buf.toString("utf8").split("\0").filter(Boolean);

/** Tracked files plus untracked files that are not ignored (the working tree as it would be committed). */
export function treeFiles(root) {
  const r = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (r.status !== 0) throw new Error("git ls-files failed");
  return [...new Set(splitZ(r.stdout))];
}

export function trackedFiles(root) {
  const r = git(root, ["ls-files", "-z"]);
  if (r.status !== 0) throw new Error("git ls-files failed");
  return splitZ(r.stdout);
}

/** Staged additions, copies, modifications and renames with their index blob ids. */
export function stagedFiles(root) {
  const d = git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  if (d.status !== 0) throw new Error("git diff --cached failed");
  const names = new Set(splitZ(d.stdout));
  if (!names.size) return [];
  const s = git(root, ["ls-files", "-z", "--stage"]);
  if (s.status !== 0) throw new Error("git ls-files --stage failed");
  const out = [];
  for (const rec of splitZ(s.stdout)) {
    const tab = rec.indexOf("\t");
    const [mode, sha, stage] = rec.slice(0, tab).split(" ");
    const path = rec.slice(tab + 1);
    if (names.has(path) && stage === "0" && mode !== "160000") out.push({ path, sha, mode });
  }
  return out;
}

export function isTracked(root, rel) {
  return git(root, ["ls-files", "--error-unmatch", "--", rel]).status === 0;
}

/** True when git would ignore the path (it need not exist). */
export function isIgnored(root, rel) {
  return git(root, ["check-ignore", "-q", "--no-index", "--", rel]).status === 0;
}

export function listRefs(root) {
  const r = git(root, ["for-each-ref", "--format=%(refname)"]);
  return r.status === 0 ? r.stdout.toString("utf8").split("\n").filter(Boolean) : [];
}

export function headRef(root) {
  return gitText(root, ["symbolic-ref", "-q", "HEAD"]);
}

export function localConfig(root) {
  const r = git(root, ["config", "--local", "--list"]);
  return r.status === 0 ? r.stdout.toString("utf8") : "";
}

/** Map of object id to path for reachable objects (first path wins). */
export function objectPaths(root) {
  const map = new Map();
  const r = git(root, ["rev-list", "--objects", "--all", "--reflog"]);
  if (r.status !== 0) return map;
  for (const line of r.stdout.toString("utf8").split("\n")) {
    const sp = line.indexOf(" ");
    if (sp > 0 && !map.has(line.slice(0, sp))) map.set(line.slice(0, sp), line.slice(sp + 1));
  }
  return map;
}

export function objectFormatBytes(root) {
  return gitText(root, ["rev-parse", "--show-object-format"]) === "sha256" ? 32 : 20;
}

/** Author and committer identity lines as git would use them now: "Name <email> ts tz". */
export function currentIdentities(root) {
  return { author: gitText(root, ["var", "GIT_AUTHOR_IDENT"]), committer: gitText(root, ["var", "GIT_COMMITTER_IDENT"]) };
}

class ByteReader {
  constructor(stream) {
    this.it = stream[Symbol.asyncIterator]();
    this.cur = Buffer.alloc(0);
    this.eof = false;
  }

  async _next() {
    if (this.eof) return false;
    const { value, done } = await this.it.next();
    if (done) {
      this.eof = true;
      return false;
    }
    this.cur = value;
    return true;
  }

  async readBytes(n) {
    const parts = [];
    let need = n;
    while (need > 0) {
      if (this.cur.length === 0 && !(await this._next())) throw new Error("unexpected end of git output");
      const take = Math.min(need, this.cur.length);
      parts.push(this.cur.subarray(0, take));
      this.cur = this.cur.subarray(take);
      need -= take;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }

  async skip(n) {
    let need = n;
    while (need > 0) {
      if (this.cur.length === 0 && !(await this._next())) throw new Error("unexpected end of git output");
      const take = Math.min(need, this.cur.length);
      this.cur = this.cur.subarray(take);
      need -= take;
    }
  }

  async readLine() {
    const parts = [];
    for (;;) {
      if (this.cur.length === 0 && !(await this._next())) return parts.length ? Buffer.concat(parts).toString("latin1") : null;
      const i = this.cur.indexOf(10);
      if (i >= 0) {
        parts.push(this.cur.subarray(0, i));
        this.cur = this.cur.subarray(i + 1);
        return Buffer.concat(parts).toString("latin1");
      }
      parts.push(this.cur);
      this.cur = Buffer.alloc(0);
    }
  }
}

/**
 * Stream objects from `git cat-file --batch`. With `all`, every object in the database (reachable or not) is listed,
 * once each. With `shas`, only those objects. Objects larger than `maxBytes` are yielded with `buf: null`.
 * @returns {AsyncGenerator<{ sha: string, type: string, size: number, buf: Buffer | null }>}
 */
export async function* catFileObjects(root, { all = false, shas = null, maxBytes = Infinity } = {}) {
  const args = [...BASE_ARGS, "cat-file", ...(all ? ["--batch-all-objects"] : []), "--batch"];
  const child = spawn("git", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const errChunks = [];
  child.stderr.on("data", (c) => errChunks.push(c));
  const exit = new Promise((resolve) => child.on("close", resolve));
  child.stdin.on("error", () => {});
  child.stdin.end(shas ? `${shas.join("\n")}\n` : "");
  const rd = new ByteReader(child.stdout);
  for (;;) {
    const line = await rd.readLine();
    if (line === null) break;
    const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(line);
    if (!m) continue; // "<sha> missing"
    const size = Number(m[3]);
    let buf = null;
    if (size > maxBytes) await rd.skip(size);
    else buf = size ? await rd.readBytes(size) : Buffer.alloc(0);
    await rd.skip(1); // trailing newline
    yield { sha: m[1], type: m[2], size, buf };
  }
  const code = await exit;
  if (code !== 0) throw new Error(`git cat-file failed (${code})`);
}

/** Parse a tree object into entries. */
export function parseTree(buf, hashBytes = 20) {
  const entries = [];
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    const nul = buf.indexOf(0, sp);
    if (sp < 0 || nul < 0) break;
    entries.push({ mode: buf.subarray(i, sp).toString("latin1"), name: buf.subarray(sp + 1, nul).toString("utf8"), sha: buf.subarray(nul + 1, nul + 1 + hashBytes).toString("hex") });
    i = nul + 1 + hashBytes;
  }
  return entries;
}
