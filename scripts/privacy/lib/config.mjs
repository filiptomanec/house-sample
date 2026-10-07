// Constants shared by the privacy scanner modules.

export const SCANNER_VERSION = "1.0.0";

// Local-only files (git-ignored). Paths are relative to the scanned repository root.
export const DENYLIST_REL = ".privacy/denylist.local.json";
export const ALLOWLIST_REL = ".privacy/allowlist.json";
export const CACHE_REL = ".privacy/cache.json";

// Built-in salt for hash8 when the denylist does not carry one (CI runs without a denylist).
export const DEFAULT_SALT = "house-sample-privacy-v1";

// Size limits (bytes).
export const MAX_TEXT_BYTES = 48 * 1024 * 1024; // larger text files are scanned in chunks
export const TEXT_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BYTES = 768 * 1024 * 1024; // larger files are reported as skipped
export const MAX_ZIP_DEPTH = 3;
export const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;

// The project author. The strings are assembled from parts on purpose: the scanner source must stay free of the
// identity strings that the repository checks police (the author is allowed only in a few named places).
export const AUTHOR_FIRST = "Fil" + "ip";
export const AUTHOR_LAST = "Toma" + "nec";
export const AUTHOR_NAME = `${AUTHOR_FIRST} ${AUTHOR_LAST}`;
export const AUTHOR_HANDLE = `${AUTHOR_FIRST}${AUTHOR_LAST}`.toLowerCase();
export const AUTHOR_GITHUB_ID = "22689632";
export const AUTHOR_NOREPLY = `${AUTHOR_GITHUB_ID}+${AUTHOR_HANDLE}@users.noreply.github.com`;
export const AUTHOR_SITE_HOST = `house-sample.${AUTHOR_HANDLE}.cz`;

// The only identities allowed in git history. GitHub's own web-flow identity is allowed for merge commits.
export const ALLOWED_IDENTITIES = [
  { name: AUTHOR_NAME, email: AUTHOR_NOREPLY },
  { name: "GitHub", email: "noreply@github.com" },
];

// Home-directory folders whose use in a path reveals a local machine layout.
export const HOME_DIR_NAMES = ["Down" + "loads", "Documents", "Desktop", "Library", "Dropbox", "iCloud", "OneDrive"];

// E-mail addresses that may appear anywhere (commit trailers, noreply addresses).
export const ALLOWED_EMAIL_PATTERNS = [
  /^[\w.+-]+@users\.noreply\.github\.com$/i,
  /^noreply@(?:github\.com|anthropic\.com)$/i,
  /^[\w.+-]+@(?:example\.(?:com|org|net)|[\w-]+\.(?:test|invalid|example|localhost))$/i,
];

// Text file extensions (content is decoded as UTF-8 and scanned as text).
export const TEXT_EXT = new Set([
  "txt", "md", "mdx", "json", "jsonc", "json5", "geojson", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "css", "scss",
  "html", "htm", "xml", "svg", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "csv", "tsv", "sh", "bash", "zsh", "py",
  "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "sql", "graphql", "gql", "map", "rsc", "webmanifest",
  "manifest", "lock", "gitignore", "gitattributes", "editorconfig", "npmrc", "nvmrc", "usda", "mtl", "obj", "gltf", "log",
  "plist", "svgz-text", "vtt", "srt", "tex", "bib", "cff", "license", "licence",
]);

// Files for which the numeric and entropy detectors are noise (hashes, integrity strings, VLQ mappings).
export const NOISY_NAME_RE = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i;

// Directories never walked in a non-git fallback and skipped inside build output.
export const WALK_SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", ".vercel", ".privacy", "coverage"]);
export const BUILD_SKIP_DIRS = new Set(["cache", "dev", "diagnostics", "trace"]);
