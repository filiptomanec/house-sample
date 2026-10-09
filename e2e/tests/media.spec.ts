// Media and model files: everything the manifests name exists, is not empty, is the kind of file its name says, and is served;
// nothing in the folders is left unreferenced (it would be deployed for nothing). Disk checks plus HTTP HEAD requests.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import modelsManifest from "../../public/models/manifest.json";
import { allMediaPaths, media } from "../../src/lib/data/media";
import { expect, test } from "../helpers/test";


const PUBLIC = path.resolve(__dirname, "../../public");
const onDisk = (rel: string) => path.join(PUBLIC, rel);
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test.describe("media @desktop", () => {
  const files = [...new Set(allMediaPaths(media))];

  test("the manifest names images, a video and a poster that all exist and are not empty", () => {
    expect(files.length).toBeGreaterThan(media.day.times.length + media.orbit.frames);
    const missing = files.filter((f) => !fs.existsSync(onDisk(f)));
    expect(missing, "files named by public/media/manifest.json but missing on disk").toEqual([]);
    const empty = files.filter((f) => fs.statSync(onDisk(f)).size < 1000);
    expect(empty, "files that are empty or suspiciously small").toEqual([]);
  });

  test("every file is what its extension says: AVIF, WebP, JPEG or MP4", () => {
    for (const f of files) {
      const head = fs.readFileSync(onDisk(f)).subarray(0, 12);
      if (/\.jpe?g$/.test(f)) expect([head[0], head[1]], f).toEqual([0xff, 0xd8]);
      else if (/\.mp4$/.test(f)) expect(head.subarray(4, 8).toString("latin1"), f).toBe("ftyp");
      else if (/\.avif$/.test(f)) {
        expect(head.subarray(4, 8).toString("latin1"), f).toBe("ftyp");
        expect(["avif", "avis"], f).toContain(head.subarray(8, 12).toString("latin1"));
      } else if (/\.webp$/.test(f)) {
        expect(head.subarray(0, 4).toString("latin1"), f).toBe("RIFF");
        expect(head.subarray(8, 12).toString("latin1"), f).toBe("WEBP");
      } else throw new Error(`unexpected media type: ${f}`);
    }
  });

  test("the folder holds nothing the manifest does not name", () => {
    const named = new Set(files.map((f) => path.resolve(onDisk(f))));
    const extra = walk(onDisk("media"))
      .filter((f) => path.basename(f) !== "manifest.json" && !named.has(path.resolve(f)))
      .map((f) => path.relative(PUBLIC, f));
    expect(extra, "files in public/media that no manifest entry refers to").toEqual([]);
  });

  test("the server serves every file with the right type", async ({ request }) => {
    for (const f of files) {
      const res = await request.fetch(`/${f}`, { method: "HEAD" });
      expect(res.status(), f).toBe(200);
      const type = /\.mp4$/.test(f) ? "video/mp4" : /\.avif$/.test(f) ? "image/avif" : /\.webp$/.test(f) ? "image/webp" : "image/jpeg";
      expect(res.headers()["content-type"], f).toBe(type);
    }
  });

  test("the before/after pair and the share image are in the manifest", () => {
    const ids = new Set(media.stills.map((s) => s.id));
    expect(ids.has(media.compare.a) && ids.has(media.compare.b)).toBe(true);
    expect(files).toContain(media.og.file);
    for (const s of media.stills) {
      expect(s.alt.cs.length, `${s.id} alt cs`).toBeGreaterThan(5);
      expect(s.alt.en.length, `${s.id} alt en`).toBeGreaterThan(5);
    }
  });
});

test.describe("model files @desktop", () => {
  const entries = Object.entries(modelsManifest.files) as [string, { sha256: string; bytes: number }][];

  test("every file of public/models/manifest.json exists with the recorded size and hash", () => {
    expect(entries.length).toBeGreaterThan(3);
    for (const [name, info] of entries) {
      const file = onDisk(`models/${name}`);
      expect(fs.existsSync(file), name).toBe(true);
      const bytes = fs.readFileSync(file);
      expect(bytes.byteLength, `${name} size`).toBe(info.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), `${name} sha256`).toBe(info.sha256);
    }
  });

  test("the USDZ for AR is on disk and is a zip", () => {
    const head = fs.readFileSync(onDisk("models/house.usdz")).subarray(0, 4);
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
