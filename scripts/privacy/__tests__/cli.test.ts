import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AUTHOR_NAME, AUTHOR_NOREPLY } from "../api.mjs";
import { HOOKS_DIR, PLANT, buildPng, cleanupTmp, commitAll, git, identityEnv, makeRepo, pngText, runCli, tmpDir, write, type Identity } from "./helpers";

afterAll(cleanupTmp);
// every case starts node processes and git repositories: allow for a busy machine
vi.setConfig({ testTimeout: 120000 });

const AUTHOR: Identity = { name: AUTHOR_NAME, email: AUTHOR_NOREPLY };
const STRANGER: Identity = { name: "Some Body", email: ["somebody", "mail-host.net"].join("@") };
const FORBIDDEN = [/zorblax/i, /plonk/i, /quuxvil/i, /zq-4711/i, /1234[.,]5/];

/** Output must contain no planted value (in any of its spellings). */
function expectNoValues(text: string): void {
  for (const re of FORBIDDEN) expect(text).not.toMatch(re);
}

function repoWith(files: Record<string, string | Buffer>): string {
  const dir = makeRepo();
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}

describe("tree scan and output", () => {
  it("passes on a clean tree", () => {
    const dir = repoWith({ "src/a.ts": "export const x = 1;\n", "README.md": "# Fictional house\n" });
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("privacy: clean");
  });

  it("reports category, position and hash8 but never the value", () => {
    const dir = repoWith({
      "src/a.ts": `// near ${PLANT.place}\nconst note = "area 1234.5 m2";\nconst c = "${PLANT.regexHit}";\n`,
      [`assets/${PLANT.slug}.txt`]: "harmless",
      "img/a.png": buildPng([pngText("Comment", PLANT.person)]),
      "enc.txt": "Zorblax%20Village and Quuxv\\u00edl",
    });
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/denylist\/place\s+src\/a\.ts:1:\d+\s+h=[0-9a-f]{8}/);
    expect(r.stdout).toMatch(/denylist\/plot\s+src\/a\.ts:2:\d+/);
    expect(r.stdout).toMatch(/denylist\/domain\s+assets\/.*redacted.*\.txt @\d+ #file-name/);
    expect(r.stdout).toMatch(/img\/a\.png @\d+ #png:Comment/);
    expect(r.stdout).toMatch(/enc\.txt/);
    expectNoValues(r.stdout);
    expectNoValues(r.stderr);
    const j = runCli(["--tree", "--strict", "--json"], { cwd: dir });
    expect(j.status).toBe(1);
    expectNoValues(j.stdout);
    const parsed = JSON.parse(j.stdout) as { total: number; findings: { hash8: string; path: string }[]; byCategory: Record<string, number> };
    expect(parsed.total).toBeGreaterThanOrEqual(5);
    expect(parsed.findings.every((f) => /^[0-9a-f]{8}$/.test(f.hash8))).toBe(true);
    expect(Object.keys(parsed.byCategory)).toContain("denylist/place");
  });

  it("masks forbidden strings in directory names and ref names", () => {
    const dir = repoWith({ [`${PLANT.slug}/inner/a.txt`]: "x" });
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.stdout).toContain("redacted");
    expectNoValues(r.stdout);
  });

  it("merges the hand-written extension of the denylist", () => {
    const dir = repoWith({ "a.txt": "a frobnitz appears" });
    expect(runCli(["--tree", "--strict"], { cwd: dir }).status).toBe(0);
    write(dir, ".privacy/denylist.extra.json", JSON.stringify({ categories: { extra: { literals: ["Frobnitz"] }, place: { literals: ["Other Place"] } } }));
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/denylist\/extra\s+a\.txt:1:3/);
    expect(r.stdout).not.toMatch(/frobnitz/i);
  });

  it("does not follow ignored files and honours --root", () => {
    const dir = repoWith({ "ignored.txt": PLANT.place });
    fs.appendFileSync(path.join(dir, ".gitignore"), "ignored.txt\n");
    const other = tmpDir();
    expect(runCli(["--tree", "--strict", "--root", dir], { cwd: other }).status).toBe(0);
  });

  it("scans build output and skips its cache directory", () => {
    const dir = repoWith({ "src/a.ts": "ok" });
    write(dir, "out/static/chunk.js", `var a = "${PLANT.place}";`);
    write(dir, "out/static/chunk.js.map", JSON.stringify({ version: 3, sources: ["a.ts"], sourcesContent: [`x ${PLANT.person}`], mappings: "AAAA", names: [] }));
    write(dir, "out/cache/big.bin", PLANT.place);
    const r = runCli(["--build", "out", "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/out\/static\/chunk\.js:1/);
    expect(r.stdout).toMatch(/chunk\.js\.map:\d+:\d+ #map:sourcesContent/);
    expect(r.stdout).not.toContain("cache/big.bin");
    expectNoValues(r.stdout);
  });

  it("scans media directories including file names", () => {
    const dir = repoWith({});
    write(dir, "public/media/a.png", buildPng([pngText("Author", PLANT.person)]));
    write(dir, `public/media/${PLANT.stem}.jpg`, "x");
    const r = runCli(["--media", "public/media", "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/meta\/personal-field/);
    expectNoValues(r.stdout);
  });
});

describe("refusals", () => {
  it("refuses to run when the denylist is tracked by git", () => {
    const dir = makeRepo();
    git(dir, ["add", "-f", ".privacy/denylist.local.json"]);
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("tracked by git");
    expectNoValues(r.stdout + r.stderr);
  });

  it("refuses when the denylist is not covered by an ignore rule", () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("gitignore");
  });

  it("refuses when other files under .privacy are tracked", () => {
    const dir = makeRepo();
    write(dir, ".privacy/notes.txt", "x");
    git(dir, ["add", "-f", ".privacy/notes.txt"]);
    expect(runCli(["--tree"], { cwd: dir }).status).toBe(2);
  });

  it("refuses without a denylist in strict mode and warns otherwise", () => {
    const dir = makeRepo({ denylist: false });
    write(dir, "a.txt", "x");
    expect(runCli(["--tree", "--strict"], { cwd: dir }).status).toBe(2);
    const r = runCli(["--tree"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("only the generic detectors ran");
  });

  it("rejects an invalid denylist without echoing it", () => {
    const dir = makeRepo({ denylist: false });
    write(dir, ".privacy/denylist.local.json", `{ "categories": ${PLANT.place} `);
    const r = runCli(["--tree", "--strict"], { cwd: dir });
    expect(r.status).toBe(2);
    expectNoValues(r.stdout + r.stderr);
  });

  it("prints usage for an unknown option and for no mode", () => {
    expect(runCli(["--nope"]).status).toBe(2);
    expect(runCli([]).status).toBe(2);
  });

  it("keeps .privacy ignored in the real repository", () => {
    const root = path.resolve(HOOKS_DIR, "..");
    const r = git(root, ["check-ignore", "-q", ".privacy/denylist.local.json"]);
    expect(r.status).toBe(0);
  });
});

describe("staged files", () => {
  it("scans the index version, not the working tree", () => {
    const dir = repoWith({ "a.txt": "clean" });
    git(dir, ["add", "-A"]);
    write(dir, "a.txt", `dirty ${PLANT.place}`); // unstaged change
    expect(runCli(["--staged", "--strict"], { cwd: dir }).status).toBe(0);
    git(dir, ["add", "a.txt"]);
    const r = runCli(["--staged", "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/a\.txt:1/);
    expectNoValues(r.stdout);
  });

  it("scans staged file names and binary metadata", () => {
    const dir = repoWith({});
    write(dir, `${PLANT.slug}.png`, buildPng([pngText("Comment", "x")]));
    write(dir, "b.png", buildPng([pngText("Author", PLANT.person)]));
    git(dir, ["add", "-A"]);
    const r = runCli(["--staged", "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/#file-name/);
    expect(r.stdout).toMatch(/b\.png @\d+ #png:Author/);
    expectNoValues(r.stdout);
  });
});

describe("history", () => {
  it("finds deleted files and names, unreachable blobs, messages, branches, tags and identities in one pass", () => {
    const dir = repoWith({ "secret.txt": `visit ${PLANT.place}`, [`gone-${PLANT.slug}.txt`]: "x", "keep.txt": "clean" });
    commitAll(dir, "Add files", AUTHOR);
    fs.rmSync(path.join(dir, "secret.txt"));
    fs.rmSync(path.join(dir, `gone-${PLANT.slug}.txt`));
    commitAll(dir, `Remove them (${PLANT.stem})`, AUTHOR);
    git(dir, ["branch", `topic-${PLANT.slug}`]);
    git(dir, ["tag", "-a", "-m", `tag note ${PLANT.person}`, "v1"], identityEnv(AUTHOR));
    git(dir, ["tag", `tag-${PLANT.slug}`]);
    write(dir, "temp.txt", `lost ${PLANT.place}`);
    git(dir, ["add", "temp.txt"]);
    git(dir, ["rm", "-q", "--cached", "temp.txt"]); // the blob stays in the object database, unreachable
    fs.rmSync(path.join(dir, "temp.txt"));
    write(dir, "later.txt", "y");
    commitAll(dir, "Add later file", STRANGER);
    expect(runCli(["--tree", "--strict"], { cwd: dir }).status).toBe(0); // the working tree itself is clean
    const r = runCli(["--history", "--strict", "--no-cache"], { cwd: dir });
    expect(r.status).toBe(1);
    expectNoValues(r.stdout + r.stderr);
    expect(r.stdout).toMatch(/denylist\/place\s+secret\.txt:1:\d+/); // deleted blob, found with its former path
    expect(r.stdout).toMatch(/denylist\/domain\s+.*#entry-name/); // deleted file name inside a tree
    expect(r.stdout).toMatch(/commit:[0-9a-f]{8}:/); // commit message
    expect(r.stdout).toMatch(/ref:refs\/heads\/topic-.*redacted/); // branch name
    expect(r.stdout).toMatch(/ref:refs\/tags\/tag-.*redacted/); // lightweight tag
    expect(r.stdout).toMatch(/tag:[0-9a-f]{8}:/); // annotated tag message
    expect(r.stdout).toMatch(/blob:[0-9a-f]{8}:1/); // unreachable blob without a path
    expect(r.stdout).toContain("identity/author");
    expect(r.stdout).toContain("identity/committer");
    expect(r.stdout).not.toContain("somebody");
    expect(r.stdout).not.toContain("Some Body");
  });

  it("passes on a clean history by the project author, accepts the assistant trailer and caches clean objects", () => {
    const dir = repoWith({ "a.txt": "clean", "b.txt": "clean too" });
    commitAll(dir, `Add\n\nCo-Authored-By: Claude <${["noreply", "anthropic.com"].join("@")}>`, AUTHOR);
    const first = JSON.parse(runCli(["--history", "--strict", "--json"], { cwd: dir }).stdout) as { ok: boolean; stats: { cached: number; objects: number } };
    const second = JSON.parse(runCli(["--history", "--strict", "--json"], { cwd: dir }).stdout) as { ok: boolean; stats: { cached: number; objects: number } };
    expect(first.ok).toBe(true);
    expect(first.stats.cached).toBe(0);
    expect(second.ok).toBe(true);
    expect(second.stats.cached).toBe(second.stats.objects);
    expect(fs.statSync(path.join(dir, ".privacy/cache.json")).mode & 0o077).toBe(0);
  });

  it("flags a remote URL that is not the project repository", () => {
    const dir = repoWith({ "a.txt": "x" });
    const bad = ["https", "://", "git-host.invalid/other/repo.git"].join("");
    expect(runCli(["--remote-url", bad, "--strict"], { cwd: dir }).stdout).toContain("remote/url");
    expect(runCli(["--remote-url", "../local/bare.git", "--strict"], { cwd: dir }).status).toBe(0);
    expect(runCli(["--remote-url", `git@github.com:${AUTHOR_NOREPLY.split("+")[1].split("@")[0]}/house-sample.git`, "--strict"], { cwd: dir }).status).toBe(0);
  });
});

describe("identity and message checks", () => {
  it("checks the identity git would use", () => {
    const dir = repoWith({});
    expect(runCli(["--identity", "--strict"], { cwd: dir, env: identityEnv(AUTHOR) }).status).toBe(0);
    const r = runCli(["--identity", "--strict"], { cwd: dir, env: identityEnv(STRANGER) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("identity/author");
  });

  it("scans a commit message file and ignores comment lines", () => {
    const dir = repoWith({});
    const msg = write(dir, "MSG", `Fix things\n\n# ${PLANT.place} in a comment line\n`);
    expect(runCli(["--message", msg, "--strict"], { cwd: dir }).status).toBe(0);
    fs.writeFileSync(msg, `Fix ${PLANT.place}\n`);
    const r = runCli(["--message", msg, "--strict"], { cwd: dir });
    expect(r.status).toBe(1);
    expectNoValues(r.stdout);
  });
});

describe("git hooks", () => {
  function hookRepo(files: Record<string, string> = {}): string {
    const dir = repoWith(files);
    git(dir, ["config", "core.hooksPath", HOOKS_DIR]);
    return dir;
  }
  const commit = (dir: string, msg: string, id: Identity = AUTHOR) => git(dir, ["commit", "-q", "-m", msg], identityEnv(id));

  it("pre-commit lets a clean commit through and blocks a forbidden value without printing it", () => {
    const dir = hookRepo({ "a.txt": "clean" });
    git(dir, ["add", "-A"]);
    expect(commit(dir, "Add clean file").status).toBe(0);
    write(dir, "b.txt", `leak ${PLANT.place}`);
    git(dir, ["add", "-A"]);
    const r = commit(dir, "Add leak");
    expect(r.status).not.toBe(0);
    expect(r.out + r.err).toContain("denylist/place");
    expectNoValues(r.out + r.err);
  });

  it("pre-commit blocks an identity other than the project author", () => {
    const dir = hookRepo({ "a.txt": "clean" });
    git(dir, ["add", "-A"]);
    const r = commit(dir, "Add", STRANGER);
    expect(r.status).not.toBe(0);
    expect(r.out + r.err).toContain("identity/");
  });

  it("commit-msg blocks a forbidden value in the message", () => {
    const dir = hookRepo({ "a.txt": "clean" });
    git(dir, ["add", "-A"]);
    const r = commit(dir, `About ${PLANT.place}`);
    expect(r.status).not.toBe(0);
    expectNoValues(r.out + r.err);
  });

  it("the hooks refuse to run without a denylist unless explicitly allowed", () => {
    const dir = hookRepo({ "a.txt": "clean" });
    fs.rmSync(path.join(dir, ".privacy/denylist.local.json"));
    git(dir, ["add", "-A"]);
    expect(commit(dir, "Add").status).not.toBe(0);
    const allowed = git(dir, ["commit", "-q", "-m", "Add"], { ...identityEnv(AUTHOR), PRIVACY_ALLOW_NO_DENYLIST: "1" });
    expect(allowed.status).toBe(0);
  });

  it("pre-push scans the history and the push target", () => {
    const dir = hookRepo({ "a.txt": "clean" });
    git(dir, ["add", "-A"]);
    expect(commit(dir, "Add").status).toBe(0);
    const bare = tmpDir("privacy-bare-");
    git(bare, ["init", "-q", "--bare", "-b", "main"]);
    git(dir, ["remote", "add", "origin", bare]);
    expect(git(dir, ["push", "-q", "origin", "main"]).status).toBe(0);
    // a leak committed with --no-verify is stopped at the push
    write(dir, "leak.txt", `x ${PLANT.place}`);
    commitAll(dir, "Leak", AUTHOR);
    const r = git(dir, ["push", "-q", "origin", "main"]);
    expect(r.status).not.toBe(0);
    expect(r.out + r.err).toContain("denylist/place");
    expectNoValues(r.out + r.err);
  });
});
