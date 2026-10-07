# Privacy checks

House Sample is a public portfolio project about a **fictional** house. Nothing about a real building, plot, person or
place may reach the repository, the build output or the website. The scanner in `scripts/privacy/` enforces this. It is
plain Node (22+, ESM, no dependencies) and runs locally, in git hooks and in CI.

The scanner works from a **local, git-ignored denylist** (`.privacy/denylist.local.json`). The denylist is the only place
where forbidden strings and numbers live. They never appear in the repository, in the scanner's output, in its logs or
in its tests (the tests use a synthetic denylist with harmless made-up strings).

## Usage

```
node scripts/privacy/scan.mjs [--staged] [--tree] [--history] [--build <dir>] [--media <dir>] [--all]
                              [--message <file>] [--remote-url <url>] [--identity] [--json] [--strict]
                              [--root <dir>] [--denylist <file>] [--allowlist <file>] [--no-cache]
```

| Mode | What is scanned |
| --- | --- |
| `--staged` | the staged version (index) of every added or changed file, and the file names |
| `--tree` | the working tree: tracked files plus untracked files that are not ignored (a plain directory walk outside git) |
| `--history` | every git object in the database, reachable or not (deleted files included), each exactly once; commit and tag messages; author, committer and tagger identities; ref names; the repository configuration (remote URLs) |
| `--build <dir>` | build output such as `.next` or `out`; cache directories (`cache`, `dev`, `diagnostics`, `trace`) are skipped |
| `--media <dir>` | images, video, models and anything else, including embedded metadata |
| `--all` | `--tree --history`, plus `--media public` and `--build .next` when those directories exist (`npm run privacy`) |
| `--message <file>` | a commit message file (the `commit-msg` hook) |
| `--remote-url <url>` | the target of a push (the `pre-push` hook): a network remote other than the project repository is refused |
| `--identity` | the author and committer identity git would use for the next commit |

Exit codes: `0` clean, `1` findings, `2` refusal or usage error. `--json` prints machine-readable output.
`--strict` refuses to run without the denylist (the hooks use it; set `PRIVACY_ALLOW_NO_DENYLIST=1` to run only the
generic checks, which is also what CI does).

### Output never contains a value

A finding is printed as a **category**, a **location** and **hash8**:

```
denylist/place   src/app/page.tsx:12:7   h=1a2b3c4d
generic/email    docs/notes.md:3:20      h=9f8e7d6c
meta/gps         public/media/a.jpg @214 #exif:GPS:GPSInfo   h=0c1d2e3f
```

* Location is `path:line:column` for text, `@byteOffset` and `#field` for binary metadata (`#exif:IFD0:Artist`,
  `#mp4:udta/loci`, `#glb:json`, `#zip:entry-name`, ...). Offsets in decoded views are approximate.
* `hash8` is the first 8 hex digits of `sha256(salt + value)`. The salt is stored in the denylist, so the hash cannot be
  reversed with a dictionary from outside. For a literal it identifies the denylist entry, not the spelling found.
* Paths, field names, ref names and sources are masked too (`‹redacted›`) when they contain a forbidden string, for
  example a file whose name carries a place name.
* Parser failures and exceptions never echo file content.

## What is detected

### 1. Denylist literals

Every literal is normalised (Unicode NFKD without combining marks, lower case, folded whitespace and dashes, zero-width
characters dropped) and matched against the normalised text. Variants cover:

* separators and slugs: `a b`, `a-b`, `a_b`, `a.b`, `a/b`, `a%20b`, `a+b`, `ab`, camel case;
* Czech inflection and missing diacritics (use stems with `{ "v": "stem", "mode": "sub" }`);
* URL escapes (`%C4%9B`), `\uXXXX` and `\xHH` escapes, HTML entities (`&ecaron;`, `&#283;`), also nested;
* file names, directory names, branch and tag names, commit messages, author and committer lines;
* binary files as UTF-8 and as UTF-16LE (both alignments).

Literal modes: `auto` (substring from 6 characters, whole word below), `sub`, `word`, `prefix`, `exact` (the normalised
literal only), `word-cs` (case- and diacritics-sensitive whole word, for short common words). Denylist `regexes` are
matched against the normalised text, so write them in lower case without diacritics.

### 2. Generic detectors (no denylist needed)

E-mail (except noreply, example and reserved domains), phone numbers, URLs and bare domains (allowlist below), URLs with
credentials, IPv4 addresses, absolute home-directory paths that contain a user name (macOS, Linux and Windows layouts),
temporary directories of the local machine (`/private/tmp`, `/var/folders`),
home-folder paths, parcel and cadastre patterns (`parc. č.`, `p. č.`, `k. ú.`, `LV`), house numbers
(`č. p.`), Czech national id numbers (validated), IBAN and Czech bank accounts, S-JTSK and UTM coordinate pairs,
latitude and longitude (keyed values, pairs, degrees-minutes-seconds), UUIDs, MAC addresses, `.local` host names, tokens
(private keys, cloud and VCS tokens, JWT, `key = value` credential assignments) and high-entropy strings.

### 3. Numeric fingerprints

The denylist can hold numbers of the real house and plot with a tolerance (areas, dimensions, levels, angles, polygon
vertices, climate series). Random numbers collide easily in numeric JSON, so three rules keep false positives rare:

* a single number counts only when it is **labelled**: next to a unit or a measure word that fits its kind
  (`123,4 m²`, `"area": 123.4`), or next to one of the `keys` given for it;
* a **sequence** of 4 or more consecutive numbers that equals a stored sequence (copied polygon vertices, area tables);
* a **cluster** of three distinct rare numbers within 30 numeric tokens.

Formats handled: decimal comma and point, non-breaking and thin-space thousands, `1,234.5`, `2.365,8`, signs.
Fingerprints that collide with the numbers of the fictional baseline design are dropped when the denylist is built.

### 4. Binary metadata

Pixel and sample data are never read; metadata is.

| Format | Inspected |
| --- | --- |
| JPEG | EXIF (all IFDs, GPS, MakerNote strings, thumbnails), XMP, IPTC/Photoshop, comments, ICC text, trailing data |
| PNG | `tEXt`, `zTXt`, `iTXt`, `eXIf`, ImageMagick raw profiles, XMP, private chunks |
| WebP / GIF / TIFF | `EXIF`, `XMP `, `ICCP` chunks; GIF comments; TIFF as EXIF |
| MP4 / MOV | `udta`, `meta`, `ilst`, `keys`, `loci`, the location atom, XMP `uuid` box, handler names; `mdat` is skipped |
| GLB / glTF | the JSON chunk (asset, extras, node, mesh, material and image names, `uri`), images embedded in the binary chunk; Draco bytes are never searched with expressions |
| USDZ / ZIP | entry names and comments, every entry (recursively, depth 3) |
| SVG | the whole text (comments, metadata) plus editor data (`docname`, export file name, RDF creator) |
| STL | the 80-byte header (binary) or the text (ASCII) |
| PDF | the info dictionary, XMP, flate streams that decode to text |
| source maps | `sources`, `sourceRoot`, `file`, `names`, `sourcesContent` (never `mappings`) |

Structural findings: `meta/gps` (any GPS data or location atom), `meta/personal-field` (artist, copyright, owner,
serial numbers, author fields), `meta/comment`, `meta/iptc`, `meta/external-uri` (a glTF that points outside itself),
`meta/junk-entry` (`__MACOSX`, `.DS_Store`), `meta/trailing-data`, `meta/editor-data`. Comments that encoders write on their own
(`Blender:oiio:...`, `CREATOR: gd-jpeg`, `Lavc...`) and plain EXIF such as resolution or software are not findings, but their text is
scanned like everything else. Strip metadata in the media
pipeline (`magick ... -strip`, `ffmpeg -map_metadata -1 -fflags +bitexact`) and the scanner stays quiet.

### 5. Git history

`--history` reads every object with `git cat-file --batch-all-objects`: blobs (also deleted or unreachable ones),
commits, tags and trees (file names). Allowed identity: the project author with the GitHub noreply address; GitHub's own
web-flow identity is allowed for merge commits. Anything else is reported as `identity/author`, `identity/committer` or
`identity/tagger`. The trailer `Co-Authored-By: Claude ...` is allowed. Objects found clean are remembered in
`.privacy/cache.json` (keyed by denylist, allowlist and scanner version), so repeated pushes are fast.

## Local files (`.privacy/`, git-ignored, mode 600)

* `denylist.local.json`: `{ "version", "salt", "categories": { "<name>": { "literals", "regexes", "numbers", "sequences" } } }`.
  Literals are strings or `{ "v", "mode" }`. Numbers are `{ "value", "tol", "label", "kind", "strength", "keys" }` with
  `kind` one of `area`, `volume`, `length`, `level`, `angle`, `geo`, `any`. Sequences are `{ "values", "tol", "label", "min" }`.
  Category names are free; they appear in the output as `denylist/<name>`.
* `denylist.extra.json` (optional): hand-written additions in the same shape; merged into the generated denylist, so the
  generated file can be rebuilt without losing them.
* `allowlist.json` (optional): `{ "hosts": ["docs.example.org"], "findings": [{ "path": "glob", "category": "prefix", "hash8": "abcd1234" }] }`.
  Every key of a finding entry is optional; all given keys must match. Use it for a reviewed false positive, preferably
  with `path` and `hash8`.
* `cache.json`: clean git objects (see above).
* `build-denylist.local.mjs`: the author's builder that derives the denylist from the earlier private project. It is
  local-only and not part of the repository.

The scanner **refuses to run** (exit 2) when the denylist is tracked by git, when it is not covered by a gitignore
rule, or when any file under `.privacy/` is tracked. `--strict` also refuses when the denylist is missing. A denylist that
other users can read produces a warning.

## Built-in allowlist

* the project author's name in `LICENSE`, `README*.md`, `package.json`, the footer component, the i18n dictionaries,
  site configuration, `.github/` and the scanner itself; the author's GitHub handle in public URLs and the noreply address
  everywhere;
* hosts: the project site and `vercel.app`, the PVGIS service, Poly Haven, the author's own repository (other repositories
  of the author are flagged), public documentation and tooling hosts (W3C, MDN, Khronos, Next.js, npm, ...), XMP and
  schema namespaces, reserved test domains; in documentation files (`docs/`, `*.md`) any ordinary https host except
  the author's other personal sites;
* e-mail: GitHub noreply addresses, `noreply@anthropic.com` (trailers), reserved example domains.

## Hooks and scripts

```
git config core.hooksPath .githooks        # once per clone (done by the orchestrator)
```

* `.githooks/pre-commit`: `--staged --identity --strict`
* `.githooks/commit-msg`: `--message <file> --strict`
* `.githooks/pre-push`: `--history --tree --remote-url <url> --strict`

Suggested `package.json` scripts: `"privacy": "node scripts/privacy/scan.mjs --all"` and
`"privacy:staged": "node scripts/privacy/scan.mjs --staged --identity"`. Quality gate order: `... npm run build && npm run check:bundles && npm run privacy`.

## When a finding appears

1. Read the category and location (the value is never printed; open the file at the position).
2. Remove or replace the content. For history findings the commit must be rewritten before the first push
   (`git rebase`, `git filter-repo`); a deleted file is still in history.
3. Only if the finding is a reviewed false positive, add a narrow entry to `.privacy/allowlist.json` (path, category and
   `hash8`).

Typical causes: absolute paths compiled into `__pycache__/*.pyc` or build caches (ignore them), metadata written by Blender,
ImageMagick or ffmpeg (strip it), a coincidental number that matches a fingerprint (allowlist by `hash8`).

## Limits

The scanner finds strings, numbers and metadata. It cannot see text rendered into pixels, geometry that was rotated,
mirrored or rescaled, or a description that was reworded. The numeric rules are tuned for a low false-positive rate, which
means that a single unlabelled number is not reported. Keep copying of data from the real project out of the workflow
altogether; the scanner is the safety net, not the policy.

## Tests

`npx vitest run scripts/privacy` covers all vectors with a synthetic denylist: text, escapes and encodings, file names,
git history in temporary repositories (deleted blobs, messages, authors, branches, tags), EXIF/XMP/comments in JPEG,
PNG and WebP, MP4 metadata, GLB extras, ZIP/USDZ entries, SVG comments, STL headers, PDF, source maps and UTF-16 text;
no value in the output; refusal rules; clean trees pass; the hooks.
