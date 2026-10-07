<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# House Sample

A fictional house as a data-driven portfolio project. Read `docs/ARCHITECTURE.md` first: it defines the conventions and the
contracts between the data model, the web app and the Blender pipeline. Rules that always apply:

* One data model (`model/*.json`) drives everything; no house numbers in JSX or Python, no branching on IDs.
* Nothing about any real building, person or place may enter the repo (see section 7 of the architecture document).
* Czech and English text via the i18n dictionaries; Czech typography with non-breaking spaces.
* Verify with `npm run typecheck && npm run lint && npm test` before finishing; `npm run build` for larger changes.
