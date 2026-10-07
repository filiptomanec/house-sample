// Output formatting. Findings are printed as category, location and hash8; the matched value is never printed.
// Paths, field names and ref names are passed through scanner.mask() because they can themselves contain a forbidden string.

/** Printable single-line form of a field name or ref (control characters become "_"). */
const clean = (s) => String(s).replace(/\p{Cc}/gu, "_");

function locationOf(f, scanner) {
  let loc = "";
  if (f.line !== undefined) loc = `:${f.line}${f.col !== undefined ? `:${f.col}` : ""}`;
  else if (f.offset !== undefined) loc = ` @${f.offset}`;
  const field = f.field && f.field !== "file-name" ? ` #${clean(scanner.mask(String(f.field))).slice(0, 80)}` : f.field === "file-name" ? " #file-name" : "";
  return `${loc}${field}`;
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || (a.offset ?? 0) - (b.offset ?? 0) || a.category.localeCompare(b.category));
}

function summarize(findings) {
  const byCategory = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  return byCategory;
}

/**
 * @param {import("./scanner.mjs").Scanner} scanner
 * @param {import("./scanner.mjs").Finding[]} findings
 */
export function renderText(scanner, findings, info) {
  const lines = [];
  for (const f of sortFindings(findings)) {
    const view = f.view ? ` (${f.view})` : "";
    lines.push(`${f.category.padEnd(28)} ${clean(scanner.mask(f.path))}${locationOf(f, scanner)}  h=${f.hash8}${view}${f.source && f.source !== "tree" ? `  [${clean(scanner.mask(f.source))}]` : ""}`);
  }
  const by = summarize(findings);
  lines.push("");
  lines.push(
    findings.length
      ? `privacy: ${findings.length} finding(s) in ${Object.keys(by).length} categories; values are never printed (hash8 identifies a value)`
      : `privacy: clean (${info.stats.files} files, ${info.stats.objects} git objects checked${info.stats.cached ? `, ${info.stats.cached} cached` : ""})`,
  );
  if (findings.length) for (const [cat, n] of Object.entries(by).sort()) lines.push(`  ${cat.padEnd(28)} ${n}`);
  for (const w of info.warnings) lines.push(`warning: ${w}`);
  if (info.stats.skipped) lines.push(`note: ${info.stats.skipped} item(s) skipped (too large or unreadable)`);
  return lines.join("\n");
}

export function renderJson(scanner, findings, info) {
  return JSON.stringify(
    {
      version: 1,
      ok: findings.length === 0,
      total: findings.length,
      byCategory: summarize(findings),
      findings: sortFindings(findings).map((f) => ({
        category: f.category,
        path: clean(scanner.mask(f.path)),
        line: f.line,
        col: f.col,
        offset: f.offset,
        field: f.field ? clean(scanner.mask(String(f.field))) : undefined,
        hash8: f.hash8,
        source: f.source ? clean(scanner.mask(f.source)) : undefined,
        view: f.view,
      })),
      stats: info.stats,
      warnings: info.warnings,
    },
    null,
    2,
  );
}
