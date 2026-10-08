// Allowlist: built-in rules (project author, public tooling hosts) plus the optional local file .privacy/allowlist.json.
//
// Local file format:
//   { "version": 1,
//     "hosts": ["docs.example.org"],                       // extra allowed hosts (suffix match)
//     "findings": [{ "path": "glob", "category": "prefix", "hash8": "abcd1234" }]   // each key optional, all given keys must match
//   }
import fs from "node:fs";
import { AUTHOR_HANDLE, AUTHOR_SITE_HOST } from "./config.mjs";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Convert a glob (`*`, `**`, `?`) to an anchored RegExp. Globs without a slash match the base name anywhere. */
export function globToRegExp(glob) {
  const hasSlash = glob.includes("/");
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += escapeRe(c);
  }
  return new RegExp(hasSlash ? `^${re}$` : `(?:^|/)${re}$`);
}

/** Public tooling and documentation hosts that may be linked from anywhere (suffix match). */
const PUBLIC_HOSTS = [
  "vercel.app", "re.jrc.ec.europa.eu", "polyhaven.com", "polyhaven.org", "www.w3.org", "w3.org", "json-schema.org", "schema.org",
  "localhost", "127.0.0.1", "example.com", "example.org", "example.net", "nextjs.org", "react.dev", "threejs.org", "docs.blender.org",
  "www.blender.org", "developer.mozilla.org", "developer.apple.com", "www.khronos.org", "registry.khronos.org", "creativecommons.org",
  "fonts.googleapis.com", "fonts.gstatic.com", "vercel.com", "playwright.dev", "vitest.dev", "zod.dev", "tailwindcss.com",
  "www.typescriptlang.org", "typescriptlang.org", "eslint.org", "www.npmjs.com", "npmjs.com", "registry.npmjs.org", "nodejs.org",
  "en.wikipedia.org", "cs.wikipedia.org", "usd.dev", "openusd.org", "gltf-transform.dev", "ffmpeg.org",
  "imagemagick.org", "git-scm.com", "keepachangelog.com", "ec.europa.eu", "anthropic.com", "ns.adobe.com", "purl.org", "xmlns.com", "iptc.org",
  "sodipodi.sourceforge.net", "inkscape.org", "www.inkscape.org", "www.metadataworkinggroup.com", "cipa.jp", "ns.useplus.org", AUTHOR_SITE_HOST,
];

// Person rule: the author's full name or handle is allowed in these files, and the handle in public URLs everywhere.
const AUTHOR_FILE_GLOBS = [
  "LICENSE*", "README*.md", "package.json", "package-lock.json", ".github/**", "src/app/layout.tsx", "src/app/**/layout.tsx",
  "src/components/**/Footer*", "src/components/**/footer*", "src/lib/**/site-config*", "src/lib/**/siteConfig*",
  "src/lib/i18n/**", "src/i18n/**", "scripts/privacy/**", "CITATION.cff", "ASSETS.md", "git-config",
].map(globToRegExp);
const AUTHOR_NAME_CTX = new RegExp(`fil[i]p[\\s._,-]*toma${"nec"}|toma${"nec"}[\\s._,-]*fil[i]p|${escapeRe(AUTHOR_HANDLE)}`);
const AUTHOR_HANDLE_CTX = new RegExp(
  `github\\.com[/:]${escapeRe(AUTHOR_HANDLE)}|${escapeRe(AUTHOR_SITE_HOST)}|\\+${escapeRe(AUTHOR_HANDLE)}@users\\.noreply\\.github\\.com|${escapeRe(AUTHOR_HANDLE)}s-projects`,
);
const AUTHOR_DOMAIN = `${AUTHOR_HANDLE}.cz`;

export function createAllowlist(local = null) {
  const extraHosts = Array.isArray(local?.hosts) ? local.hosts.map((h) => String(h).toLowerCase()) : [];
  // Reviewed false positives of the generic detectors in third-party or generated code (minified library chunks, the Draco
  // decoder, Next trace files, the sitemap namespace). Paths of build output are relative to the build directory.
  const BUILTIN_FINDINGS = [
    { path: "public/draco/**", category: "generic/" },
    { path: "static/chunks/**", category: "generic/" },
    { path: "app/**/*.nft.json", category: "generic/" },
    { path: "app/sitemap.xml.body", category: "generic/url" },
  ];
  const entries = [...BUILTIN_FINDINGS, ...(Array.isArray(local?.findings) ? local.findings : [])].map((e) => ({
    path: e.path ? globToRegExp(String(e.path)) : null,
    category: e.category ? String(e.category) : null,
    hash8: e.hash8 ? String(e.hash8).toLowerCase() : null,
  }));
  const hosts = [...PUBLIC_HOSTS, ...extraHosts];

  /** Is a host allowed? `kind` "docs" relaxes the check for documentation links (except the author's other domains). */
  function hostAllowed(host, pathname = "", ctx = {}) {
    const h = host.toLowerCase().replace(/^www\./, "");
    const full = host.toLowerCase();
    if (full === AUTHOR_SITE_HOST) return true;
    if (h === AUTHOR_DOMAIN || h.endsWith(`.${AUTHOR_DOMAIN}`)) return false; // other personal sites
    if (/\.(?:test|invalid|example|localhost)$/.test(full)) return true; // reserved TLDs (RFC 2606)
    if (full === "github.com" || full.endsWith(".github.com")) {
      // third-party repositories may be linked; only the author's other repositories are off limits
      if (!pathname || pathname === "/") return true;
      const own = `/${AUTHOR_HANDLE}`;
      if (pathname.toLowerCase().startsWith(`${own}/`) || pathname.toLowerCase() === own) {
        return pathname.toLowerCase() === own || /^\/[^/]+\/house-sample(?:[/.#?]|$)/i.test(pathname);
      }
      return true;
    }
    if (hosts.some((a) => full === a || full.endsWith(`.${a}`) || h === a)) return true;
    if (ctx.kind === "docs" && !/^\d+\.\d+\.\d+\.\d+$/.test(full)) return true;
    return false;
  }

  function urlAllowed(u, ctx = {}) {
    return hostAllowed(u.hostname, u.pathname, ctx);
  }

  /**
   * Decide whether a finding is allowed.
   * @param {{ category: string, path: string, hash8: string, ctx?: string }} f
   */
  function findingAllowed(f) {
    // project author in the places where a name belongs
    if (f.category.startsWith("denylist/person") && f.ctx) {
      if (AUTHOR_HANDLE_CTX.test(f.ctx)) return true;
      if (AUTHOR_NAME_CTX.test(f.ctx) && AUTHOR_FILE_GLOBS.some((re) => re.test(f.path))) return true;
    }
    for (const e of entries) {
      if (e.path && !e.path.test(f.path)) continue;
      if (e.category && !f.category.startsWith(e.category)) continue;
      if (e.hash8 && e.hash8 !== f.hash8) continue;
      if (!e.path && !e.category && !e.hash8) continue;
      return true;
    }
    return false;
  }

  return { hostAllowed, urlAllowed, findingAllowed, extraHostCount: extraHosts.length, entryCount: entries.length };
}

export function loadLocalAllowlist(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}
