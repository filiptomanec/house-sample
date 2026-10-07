#!/usr/bin/env node
// Privacy scanner: keeps anything about a real building, plot or person out of the public repository and website.
//
//   node scripts/privacy/scan.mjs [--staged] [--tree] [--history] [--build <dir>] [--media <dir>] [--all]
//                                 [--message <file>] [--identity] [--json] [--strict] [--root <dir>] [--denylist <file>]
//                                 [--allowlist <file>] [--no-cache] [--no-numbers] [--no-generic] [--quiet]
//
// Exit codes: 0 clean, 1 findings, 2 refusal or usage error. The scanner never prints a matched value: only the
// category, the location (path, line and column or byte offset) and hash8. See docs/PRIVACY.md.
import fs from "node:fs";
import path from "node:path";
import { createContext, renderJson, renderText, RefusalError, runScan } from "./api.mjs";

const HELP = `usage: node scripts/privacy/scan.mjs [options]
  --staged          staged files (index version) and their names
  --tree            working tree (tracked files and untracked files that are not ignored)
  --history         every git object (also deleted ones), commit messages, authors, tags, ref names, remote URLs
  --build <dir>     build output (for example .next or out); cache directories are skipped
  --media <dir>     media and model files with their embedded metadata
  --all             --tree --history, plus --media public and --build .next/static and .next/server/app when those exist
  --message <file>  a commit message file (commit-msg hook)
  --remote-url <u>  the URL of a push target (pre-push hook): network remotes must be the project repository
  --identity        check the author and committer identity git would use for the next commit
  --json            machine-readable output
  --strict          refuse to run without the local denylist
  --root <dir>      repository root (default: the git top level of the current directory)
  --denylist <f>    denylist file (default: .privacy/denylist.local.json under the root)
  --allowlist <f>   allowlist file (default: .privacy/allowlist.json under the root)
  --no-cache        do not use the clean-object cache for history scans
  --no-numbers      disable the numeric fingerprint detector
  --no-generic      disable the generic detectors (denylist only)
  --quiet           print findings only, no summary when clean`;

function parseArgs(argv) {
  const o = { build: [], media: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new RefusalError(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--staged": o.staged = true; break;
      case "--tree": o.tree = true; break;
      case "--history": o.history = true; break;
      case "--build": o.build.push(next()); break;
      case "--media": o.media.push(next()); break;
      case "--all": o.all = true; break;
      case "--message": o.message = next(); break;
      case "--remote-url": o.remoteUrl = next(); break;
      case "--identity": o.identity = true; break;
      case "--json": o.json = true; break;
      case "--strict": o.strict = true; break;
      case "--root": o.root = next(); break;
      case "--denylist": o.denylist = next(); break;
      case "--allowlist": o.allowlist = next(); break;
      case "--no-cache": o.noCache = true; break;
      case "--no-numbers": o.noNumbers = true; break;
      case "--no-generic": o.noGeneric = true; break;
      case "--quiet": o.quiet = true; break;
      case "-h":
      case "--help": o.help = true; break;
      default: throw new RefusalError(`unknown option ${a}`);
    }
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(HELP);
    return 0;
  }
  const ctx = createContext({ root: o.root, denylist: o.denylist, allowlist: o.allowlist, strict: o.strict, numbers: !o.noNumbers, generic: !o.noGeneric, cache: !o.noCache });
  const modes = { tree: o.tree, staged: o.staged, history: o.history, identity: o.identity, build: o.build, media: o.media, message: o.message, remoteUrl: o.remoteUrl };
  if (o.all) {
    modes.tree = true;
    modes.history = true;
    if (fs.existsSync(path.join(ctx.root, "public"))) modes.media.push("public");
    // only what is actually served: client chunks and the prerendered pages; the server bundle, source maps and
    // required-server-files are build internals that are never deployed to the public (and carry local paths)
    for (const d of [".next/static", ".next/server/app"]) if (fs.existsSync(path.join(ctx.root, d))) modes.build.push(d);
  }
  if (!(modes.tree || modes.staged || modes.history || modes.identity || modes.message || modes.remoteUrl || modes.build.length || modes.media.length)) {
    console.log(HELP);
    return 2;
  }
  const result = await runScan(ctx, modes);
  const out = o.json ? renderJson(ctx.scanner, result.findings, result) : renderText(ctx.scanner, result.findings, result);
  if (!(o.quiet && !result.findings.length && !o.json)) console.log(out);
  return result.findings.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // never echo arbitrary exception text: it could contain content of a scanned file
    console.error(err instanceof RefusalError ? err.message : `privacy scanner failed (${err?.code ?? err?.name ?? "error"})`);
    process.exit(2);
  },
);
