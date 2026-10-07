// The Scanner turns text into findings. A finding carries a category, a location and hash8, never the matched value.
import crypto from "node:crypto";
import { MAX_TEXT_BYTES, NOISY_NAME_RE, TEXT_CHUNK_BYTES } from "./config.mjs";
import { runGeneric } from "./generic.mjs";
import { decodeViews, lineCol, lineStarts, normalizeText, originalIndex } from "./normalize.mjs";

/** @typedef {{ category: string, path: string, source: string, line?: number, col?: number, offset?: number, field?: string, view?: string, hash8: string, ctx?: string }} Finding */

const NOISY_SKIP = new Set(["generic/entropy", "generic/uuid"]);
const LOCK_SKIP = new Set(["generic/entropy", "generic/uuid", "generic/url", "generic/domain"]);
const DOC_RE = /(?:^|\/)(?:docs\/.*|[^/]*\.md)$/i;

/** "docs" for documentation files (links to public sites are fine there), otherwise "code". */
export function kindOf(p) {
  return DOC_RE.test(p) ? "docs" : "code";
}

export class Scanner {
  /**
   * @param {{ rules: ReturnType<typeof import("./denylist.mjs").compileRules>, allowlist: ReturnType<typeof import("./allowlist.mjs").createAllowlist>, options?: { numbers?: boolean, generic?: boolean } }} cfg
   */
  constructor({ rules, allowlist, options = {} }) {
    this.rules = rules;
    this.allowlist = allowlist;
    this.options = { numbers: true, generic: true, ...options };
  }

  hash8(value) {
    return crypto.createHash("sha256").update(`${this.rules.salt}\0${value}`).digest("hex").slice(0, 8);
  }

  /**
   * Scan a text. Returns raw findings (before the allowlist).
   * @param {string} text
   * @param {{ path: string, source?: string, field?: string, kind?: string, noisy?: boolean, lineBase?: number, skip?: Set<string>, binary?: boolean, skipGeneric?: boolean }} loc
   * @returns {Finding[]}
   */
  scanText(text, loc) {
    if (text.length > MAX_TEXT_BYTES) return this._scanChunked(text, loc);
    return this._scanOne(text, loc);
  }

  _scanChunked(text, loc) {
    const out = [];
    const overlap = 4096;
    let lineBase = loc.lineBase ?? 0;
    for (let i = 0; i < text.length; i += TEXT_CHUNK_BYTES) {
      const chunk = text.slice(i, Math.min(text.length, i + TEXT_CHUNK_BYTES + overlap));
      out.push(...this._scanOne(chunk, { ...loc, lineBase }));
      lineBase += (text.slice(i, i + TEXT_CHUNK_BYTES).match(/\n/g) ?? []).length;
    }
    return out;
  }

  _scanOne(text, loc) {
    const { rules } = this;
    const source = loc.source ?? "tree";
    const kind = loc.kind ?? kindOf(loc.path);
    const noisy = loc.noisy ?? NOISY_NAME_RE.test(loc.path);
    const lineBase = loc.lineBase ?? 0;
    /** @type {Finding[]} */
    const findings = [];
    const seen = new Set();
    const rawCounts = new Map();
    const viewCounts = new Map();
    const push = (category, view, starts, offset, value, ctx) => {
      const { line, col } = lineCol(starts, Math.max(0, offset));
      const h = this.hash8(value);
      const key = `${category}|${line}|${h}`;
      if (view === "raw") {
        const sk = `${key}|${col}`;
        const pk = `${category}|${line}|${col}`; // two detectors of one category on the same spot count once
        if (seen.has(sk) || seen.has(pk)) return;
        seen.add(sk);
        seen.add(pk);
        rawCounts.set(key, (rawCounts.get(key) ?? 0) + 1);
      } else {
        // a decoded view repeats what the raw view already found; keep only the surplus
        const n = (viewCounts.get(key) ?? 0) + 1;
        viewCounts.set(key, n);
        if (n <= (rawCounts.get(key) ?? 0)) return;
      }
      findings.push({ category, path: loc.path, source, line: line + lineBase, col, offset, field: loc.field, view: view === "raw" ? undefined : view, hash8: h, ctx });
    };

    for (const view of decodeViews(text)) {
      const starts = lineStarts(view.text);
      const vt = view.text;
      if (!rules.isEmpty) {
        const { text: norm, map } = normalizeText(vt);
        const ctxOf = (s, e) => norm.slice(Math.max(0, s - 48), e + 48);
        for (const m of rules.matcher.scanNormalized(norm)) {
          const cat = rules.matcher.entries[m.entry].category;
          push(`denylist/${cat}`, view.name, starts, originalIndex(map, m.start), `L:${rules.matcher.entries[m.entry].canon}`, ctxOf(m.start, m.end));
        }
        for (const m of rules.matcher.scanRaw(vt)) {
          const cat = rules.matcher.entries[m.entry].category;
          push(`denylist/${cat}`, view.name, starts, m.start, `L:${rules.matcher.entries[m.entry].canon}`, normalizeText(vt.slice(Math.max(0, m.start - 48), m.end + 48)).text);
        }
        for (const { category, re } of rules.regexes) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(norm)) !== null) {
            if (m[0].length === 0) {
              re.lastIndex++;
              continue;
            }
            push(`denylist/${category}`, view.name, starts, originalIndex(map, m.index), m[0], ctxOf(m.index, m.index + m[0].length));
          }
        }
        if (this.options.numbers && !noisy && !rules.numbers.empty) {
          for (const h of rules.numbers.scan(vt)) push(h.category, view.name, starts, h.index, `${h.kind}:${h.value}`, undefined);
        }
      }
      if (this.options.generic && !loc.skipGeneric) {
        const skip = loc.skip ?? (NOISY_NAME_RE.test(loc.path) ? LOCK_SKIP : noisy ? NOISY_SKIP : undefined);
        for (const g of runGeneric(vt, { allowlist: this.allowlist, kind, skip, binary: loc.binary })) push(g.category, view.name, starts, g.index, g.value, undefined);
      }
    }
    return findings;
  }

  /** Scan a path or name (file name, branch, tag). Findings point at the name, not at a line. */
  scanName(name, loc) {
    const found = this.scanText(name, { ...loc, path: loc.path ?? name, noisy: true, kind: "code" });
    return found.map((f) => ({ ...f, line: undefined, col: undefined, field: loc.field ?? "name" }));
  }

  /** Remove findings the allowlist accepts. */
  accept(findings) {
    // the internal context window (normalised surrounding text) is dropped here: it must never leave the scanner
    return findings.filter((f) => !this.allowlist.findingAllowed(f)).map((f) => ({ ...f, ctx: undefined }));
  }

  /**
   * Replace every denylist and generic match in a string by a placeholder so it can be printed (paths, branch names).
   * @param {string} s
   */
  mask(s) {
    const ranges = [];
    if (!this.rules.isEmpty) {
      const { text: norm, map } = normalizeText(s);
      for (const m of this.rules.matcher.scanNormalized(norm)) ranges.push([originalIndex(map, m.start), originalIndex(map, m.end - 1) + 1]);
      for (const m of this.rules.matcher.scanRaw(s)) ranges.push([m.start, m.end]);
      for (const { re } of this.rules.regexes) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(norm)) !== null) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          ranges.push([originalIndex(map, m.index), originalIndex(map, m.index + m[0].length - 1) + 1]);
        }
      }
    }
    for (const g of runGeneric(s, { allowlist: this.allowlist, kind: "code", skip: new Set(["generic/entropy"]) })) ranges.push([g.index, g.index + g.length]);
    if (!ranges.length) return s;
    ranges.sort((a, b) => a[0] - b[0]);
    let out = "";
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a < pos) {
        pos = Math.max(pos, b);
        continue;
      }
      out += `${s.slice(pos, a)}‹redacted›`;
      pos = b;
    }
    return out + s.slice(pos);
  }
}
