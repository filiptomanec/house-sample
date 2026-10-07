// Cache of git objects that were found clean (no raw findings) under the current denylist, allowlist and scanner version.
// Objects are immutable, so a clean object stays clean; findings are never cached.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_REL, SCANNER_VERSION } from "./config.mjs";

export class CleanCache {
  /** @param {string} root @param {string} fingerprint text that changes when the rules change */
  constructor(root, fingerprint) {
    this.file = path.join(root, CACHE_REL);
    this.key = crypto.createHash("sha256").update(`${SCANNER_VERSION}\0${fingerprint}`).digest("hex").slice(0, 32);
    this.clean = new Set();
    this.dirty = false;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (data.key === this.key && Array.isArray(data.clean)) this.clean = new Set(data.clean);
    } catch {
      // no cache yet
    }
  }

  has(sha) {
    return this.clean.has(sha);
  }

  add(sha) {
    if (!this.clean.has(sha)) {
      this.clean.add(sha);
      this.dirty = true;
    }
  }

  save() {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ key: this.key, clean: [...this.clean] }), { mode: 0o600 });
    } catch {
      // the cache is an optimisation only
    }
  }
}
