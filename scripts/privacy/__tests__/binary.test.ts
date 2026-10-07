import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { PLANT, box, buildGlb, buildJpeg, buildMp4, buildPng, buildWebp, buildZip, buildTiff, categoriesOf, cleanupTmp, exifSegment, findingsOf, jpegSegment, makeContext, pngChunk, pngText, qtText, riffChunk, tmpDir, write } from "./helpers";

afterAll(cleanupTmp);

const ctx = makeContext();
const cats = (buf: Buffer | string, name: string) => categoriesOf(ctx, buf, name);
const fields = (buf: Buffer, name: string) => findingsOf(ctx, buf, name).map((f) => f.field);

describe("JPEG", () => {
  it("reads EXIF text tags and flags personal fields", () => {
    const jpg = buildJpeg([exifSegment([[0x013b, PLANT.person], [0x010e, `view of ${PLANT.place}`]])]);
    const c = cats(jpg, "a.jpg");
    expect(c).toContain("denylist/person");
    expect(c).toContain("denylist/place");
    expect(c).toContain("meta/personal-field");
    expect(fields(jpg, "a.jpg")).toContain("exif:IFD0:Artist");
  });

  it("flags GPS data", () => {
    expect(cats(buildJpeg([exifSegment([[0x0131, "Some Renderer 1.0"]], true)]), "a.jpg")).toContain("meta/gps");
  });

  it("accepts harmless metadata (software tag only)", () => {
    expect(cats(buildJpeg([exifSegment([[0x0131, "Some Renderer 1.0"]])]), "a.jpg")).toEqual([]);
  });

  it("reads comments, XMP and IPTC", () => {
    expect(cats(buildJpeg([jpegSegment(0xfe, Buffer.from(`note ${PLANT.place}`))]), "a.jpg")).toEqual(expect.arrayContaining(["denylist/place", "meta/comment"]));
    const xmp = `<x:xmpmeta><rdf:RDF><dc:creator><rdf:Seq><rdf:li>${PLANT.person}</rdf:li></rdf:Seq></dc:creator></rdf:RDF></x:xmpmeta>`;
    const seg = jpegSegment(0xe1, Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp)]));
    expect(cats(buildJpeg([seg]), "a.jpg")).toEqual(expect.arrayContaining(["denylist/person", "meta/personal-field"]));
    // IPTC caption record 2:120 inside a Photoshop 8BIM block
    const caption = Buffer.from(PLANT.place);
    const rec = Buffer.concat([Buffer.from([0x1c, 2, 120]), Buffer.from([caption.length >> 8, caption.length & 255]), caption]);
    const bim = Buffer.concat([Buffer.from("8BIM"), Buffer.from([0x04, 0x04, 0, 0]), Buffer.from([0, 0, 0, rec.length]), rec, rec.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
    const app13 = jpegSegment(0xed, Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), bim]));
    expect(cats(buildJpeg([app13]), "a.jpg")).toEqual(expect.arrayContaining(["denylist/place", "meta/iptc"]));
  });

  it("does not flag the comments that encoders write on their own, but still scans them", () => {
    const enc = buildJpeg([jpegSegment(0xfe, Buffer.from("Blender:oiio:ColorSpace:srgb_rec709_scene"))]);
    expect(cats(enc, "a.jpg")).toEqual([]);
    const sneaky = buildJpeg([jpegSegment(0xfe, Buffer.from(`Blender:oiio:note ${PLANT.place}`))]);
    expect(cats(sneaky, "a.jpg")).toEqual(["denylist/place"]);
  });

  it("reads the EXIF thumbnail", () => {
    // IFD0 without entries, IFD1 with a JPEG thumbnail that itself carries a comment
    const thumb = buildJpeg([jpegSegment(0xfe, Buffer.from(PLANT.place))]);
    const head = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 14]);
    const ifd1 = Buffer.alloc(2 + 24 + 4);
    ifd1.writeUInt16BE(2, 0);
    const base = head.length + ifd1.length;
    ifd1.writeUInt16BE(0x0201, 2);
    ifd1.writeUInt16BE(4, 4);
    ifd1.writeUInt32BE(1, 6);
    ifd1.writeUInt32BE(base, 10);
    ifd1.writeUInt16BE(0x0202, 14);
    ifd1.writeUInt16BE(4, 16);
    ifd1.writeUInt32BE(1, 18);
    ifd1.writeUInt32BE(thumb.length, 22);
    const tiff = Buffer.concat([head, ifd1, thumb]);
    const seg = jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]));
    expect(cats(buildJpeg([seg]), "a.jpg")).toContain("denylist/place");
  });

  it("reads trailing data after the end of image", () => {
    const jpg = Buffer.concat([buildJpeg([]), Buffer.from(`\0\0padding of some length ${PLANT.place} more`)]);
    const c = cats(jpg, "a.jpg");
    expect(c).toContain("denylist/place");
    expect(c).toContain("meta/trailing-data");
  });

  const magick = spawnSync("magick", ["-version"]).status === 0;
  it.skipIf(!magick)("reads a comment written by ImageMagick", () => {
    const dir = tmpDir();
    const out = path.join(dir, "m.jpg");
    const r = spawnSync("magick", ["xc:white", "-resize", "16x16!", "-set", "comment", `note ${PLANT.place}`, out]);
    expect(r.status).toBe(0);
    expect(cats(fs.readFileSync(out), "m.jpg")).toEqual(expect.arrayContaining(["denylist/place", "meta/comment"]));
    // and an EXIF segment injected into the ImageMagick output
    const base = fs.readFileSync(out);
    const at = base.indexOf(Buffer.from([0xff, 0xdb]));
    const withExif = Buffer.concat([base.subarray(0, at), exifSegment([[0x013b, PLANT.person]]), base.subarray(at)]);
    expect(cats(withExif, "m.jpg")).toEqual(expect.arrayContaining(["denylist/person", "meta/personal-field"]));
    const stripped = path.join(dir, "s.jpg");
    spawnSync("magick", [out, "-strip", stripped]);
    expect(cats(fs.readFileSync(stripped), "s.jpg")).toEqual([]);
  });
});

describe("PNG", () => {
  it("reads tEXt, zTXt and iTXt chunks", () => {
    expect(cats(buildPng([pngText("Comment", PLANT.place)]), "a.png")).toEqual(expect.arrayContaining(["denylist/place", "meta/comment"]));
    expect(cats(buildPng([pngText("Description", `x ${PLANT.place}`, true)]), "a.png")).toContain("denylist/place");
    const itxt = pngChunk("iTXt", Buffer.concat([Buffer.from("Author\0\0\0\0\0", "latin1"), Buffer.from(PLANT.person)]));
    expect(cats(buildPng([itxt]), "a.png")).toEqual(expect.arrayContaining(["denylist/person", "meta/personal-field"]));
  });

  it("reads eXIf with GPS and XMP", () => {
    expect(cats(buildPng([pngChunk("eXIf", buildTiff([[0x0131, "x"]], true))]), "a.png")).toContain("meta/gps");
    const xmp = pngChunk("iTXt", Buffer.concat([Buffer.from("XML:com.adobe.xmp\0\0\0\0\0", "latin1"), Buffer.from(`<x:xmpmeta><dc:creator>${PLANT.person}</dc:creator></x:xmpmeta>`)]));
    expect(cats(buildPng([xmp]), "a.png")).toEqual(expect.arrayContaining(["denylist/person", "meta/personal-field"]));
  });

  it("decodes ImageMagick raw EXIF profiles", () => {
    const tiff = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), buildTiff([[0x013b, PLANT.person]])]);
    const raw = `\nexif\n    ${tiff.length}\n${tiff.toString("hex").replace(/(.{64})/g, "$1\n")}\n`;
    expect(cats(buildPng([pngText("Raw profile type exif", raw, true)]), "a.png")).toEqual(expect.arrayContaining(["denylist/person", "meta/personal-field"]));
  });

  it("accepts the metadata a renderer writes (software, dates, timings, resolution EXIF)", () => {
    const png = buildPng([
      pngChunk("eXIf", buildTiff([[0x0131, "Some Renderer 1.0"]])),
      pngText("Software", "Some Renderer 1.0"),
      pngText("Date", "2026/10/07 19:13:28"),
      pngText("Time", "00:00:00:01"),
      pngText("RenderTime", "00:25.42"),
      pngText("File", "<untitled>"),
      pngText("date:create", "2026-10-07T17:52:48+00:00"),
    ]);
    expect(cats(png, "a.png")).toEqual([]);
  });

  it("flags an absolute path hidden in a text chunk", () => {
    expect(cats(buildPng([pngText("File", ["/Us", "ers/someone/scene.blend"].join(""))]), "a.png")).toContain("generic/abs-path");
  });
});

describe("WebP and GIF", () => {
  it("reads EXIF and XMP chunks", () => {
    const exif = riffChunk("EXIF", Buffer.concat([Buffer.from("Exif\0\0", "latin1"), buildTiff([[0x010e, PLANT.place]])]));
    expect(cats(buildWebp([exif]), "a.webp")).toEqual(expect.arrayContaining(["denylist/place", "meta/personal-field"]));
    const xmp = riffChunk("XMP ", Buffer.from(`<x:xmpmeta><photoshop:City>${PLANT.place}</photoshop:City></x:xmpmeta>`));
    expect(cats(buildWebp([xmp]), "a.webp")).toEqual(expect.arrayContaining(["denylist/place", "meta/personal-field"]));
    expect(cats(buildWebp([]), "a.webp")).toEqual([]);
  });

  it("reads GIF comments", () => {
    const text = Buffer.from(PLANT.place);
    const gif = Buffer.concat([Buffer.from("GIF89a\x01\0\x01\0\0\0\0", "latin1"), Buffer.from([0x21, 0xfe, text.length]), text, Buffer.from([0, 0x3b])]);
    expect(cats(gif, "a.gif")).toEqual(expect.arrayContaining(["denylist/place", "meta/comment"]));
  });
});

describe("MP4", () => {
  const C = String.fromCharCode(0xa9);

  it("flags location atoms and personal text atoms", () => {
    expect(cats(buildMp4([qtText(`${C}xyz`, "+49.1000+016.6000/")]), "a.mp4")).toContain("meta/gps");
    expect(cats(buildMp4([box("loci", Buffer.alloc(24))]), "a.mp4")).toContain("meta/gps");
    const c = cats(buildMp4([qtText(`${C}ART`, PLANT.person), qtText(`${C}nam`, PLANT.place)]), "a.mp4");
    expect(c).toEqual(expect.arrayContaining(["denylist/person", "denylist/place", "meta/personal-field"]));
  });

  it("reads iTunes-style items and an XMP uuid box", () => {
    const data = (text: string) => box("data", Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(text)]));
    const ilst = box("ilst", [box(`${C}cmt`, data(PLANT.place))]);
    const meta = box("meta", [Buffer.alloc(4), box("hdlr", Buffer.alloc(33)), ilst]);
    expect(cats(buildMp4([meta]), "a.mp4")).toEqual(expect.arrayContaining(["denylist/place", "meta/personal-field"]));
    const uuid = box("uuid", Buffer.concat([Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex"), Buffer.from(`<x:xmpmeta><dc:creator>${PLANT.person}</dc:creator></x:xmpmeta>`)]));
    expect(cats(buildMp4([uuid]), "a.mp4")).toEqual(expect.arrayContaining(["denylist/person", "meta/personal-field"]));
  });

  it("ignores sample data and accepts a plain file", () => {
    const mp4 = buildMp4([qtText(`${C}too`, "Lavf60.16.100")]);
    expect(cats(mp4, "a.mp4")).toEqual([]);
    const withNoise = Buffer.concat([mp4, box("mdat", Buffer.from(`${PLANT.place} inside sample data`))]);
    expect(cats(withNoise, "a.mp4")).toEqual([]);
  });

  const ffmpeg = process.env.PRIVACY_TEST_FFMPEG || "ffmpeg";
  const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;
  it.skipIf(!hasFfmpeg)("reads metadata written by ffmpeg and accepts a stripped file", () => {
    const dir = tmpDir();
    const out = path.join(dir, "f.mp4");
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-metadata", `title=${PLANT.place}`, "-metadata", `artist=${PLANT.person}`, "-metadata", "location=+49.1000+016.6000/", "-c:v", "libx264", out]);
    expect(r.status).toBe(0);
    expect(cats(fs.readFileSync(out), "f.mp4")).toEqual(expect.arrayContaining(["denylist/place", "denylist/person", "meta/gps", "meta/personal-field"]));
    const clean = path.join(dir, "c.mp4");
    const r2 = spawnSync(ffmpeg, ["-v", "error", "-y", "-i", out, "-map_metadata", "-1", "-c", "copy", "-fflags", "+bitexact", "-flags:v", "+bitexact", clean]);
    expect(r2.status).toBe(0);
    expect(cats(fs.readFileSync(clean), "c.mp4")).toEqual([]);
    const tags = path.join(dir, "t.mp4");
    spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-metadata", `title=${PLANT.place}`, "-c:v", "libx264", "-movflags", "use_metadata_tags", tags]);
    expect(cats(fs.readFileSync(tags), "t.mp4")).toContain("denylist/place");
  });
});

describe("GLB and glTF", () => {
  const baseDoc = () => ({
    asset: { version: "2.0", generator: "Test exporter" },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "wall", mesh: 0, extras: { role: "wall", id: "R01" } as Record<string, string> }],
    meshes: [{ name: "wall", primitives: [] }],
    materials: [{ name: "plaster" }],
  });

  it("accepts a clean file", () => {
    expect(cats(buildGlb(baseDoc(), Buffer.from("not json, not text of interest")), "a.glb")).toEqual([]);
  });

  it("finds literals in extras, node, material and asset fields", () => {
    const doc = baseDoc();
    doc.nodes[0].extras = { role: "wall", note: PLANT.person };
    doc.materials[0].name = `${PLANT.place} paint`;
    expect(cats(buildGlb(doc), "a.glb")).toEqual(expect.arrayContaining(["denylist/person", "denylist/place"]));
    const withCopyright = { ...baseDoc(), asset: { version: "2.0", copyright: "somebody" } };
    expect(cats(buildGlb(withCopyright), "a.glb")).toContain("meta/personal-field");
  });

  it("flags external URIs and reads embedded data URIs", () => {
    const doc = { ...baseDoc(), buffers: [{ byteLength: 4, uri: "scene.bin" }] };
    expect(cats(buildGlb(doc), "a.glb")).toContain("meta/external-uri");
    const png = buildPng([pngText("Comment", PLANT.place)]);
    const withData = { ...baseDoc(), images: [{ uri: `data:image/png;base64,${png.toString("base64")}` }] };
    expect(cats(buildGlb(withData), "a.glb")).toContain("denylist/place");
  });

  it("reads textures stored in the binary chunk and ignores geometry bytes", () => {
    const png = buildPng([pngText("Comment", PLANT.place)]);
    const geometry = Buffer.alloc(4096, 0xa5);
    const bin = Buffer.concat([png, geometry]);
    const doc = { ...baseDoc(), images: [{ bufferView: 0, mimeType: "image/png" }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.length }], buffers: [{ byteLength: bin.length }] };
    const found = findingsOf(ctx, buildGlb(doc, bin), "a.glb");
    expect(found.map((f) => f.category)).toContain("denylist/place");
    expect(found[0].path).toContain("!");
    // the same text inside the binary chunk but outside any image is not searched
    const hidden = Buffer.concat([geometry, Buffer.from(PLANT.place)]);
    const doc2 = { ...baseDoc(), buffers: [{ byteLength: hidden.length }] };
    expect(cats(buildGlb(doc2, hidden), "a.glb")).toEqual([]);
  });

  it("scans plain .gltf files too", () => {
    const doc = baseDoc();
    doc.nodes[0].name = PLANT.place;
    expect(cats(JSON.stringify(doc), "a.gltf")).toContain("denylist/place");
  });
});

describe("ZIP and USDZ", () => {
  it("reads entry names, comments and contents (also nested archives)", () => {
    const zip = buildZip([{ name: `${PLANT.slug}/model.usda`, data: Buffer.from("#usda 1.0\n") }, { name: "notes.txt", data: Buffer.from(`hello ${PLANT.place}`), deflate: true }], "archive comment");
    const found = findingsOf(ctx, zip, "a.usdz");
    expect(found.map((f) => f.category)).toEqual(expect.arrayContaining(["denylist/domain", "denylist/place"]));
    expect(found.some((f) => f.path.includes("!notes.txt"))).toBe(true);
    const inner = buildZip([{ name: "deep.txt", data: Buffer.from(PLANT.place) }]);
    const outer = buildZip([{ name: "inner.zip", data: inner }]);
    expect(cats(outer, "a.zip")).toContain("denylist/place");
    expect(cats(buildZip([{ name: "a.txt", data: Buffer.from("ok") }], `c ${PLANT.place}`), "a.zip")).toContain("denylist/place");
  });

  it("flags macOS leftovers", () => {
    expect(cats(buildZip([{ name: "__MACOSX/._x", data: Buffer.from("x") }]), "a.zip")).toContain("meta/junk-entry");
  });

  it("accepts a clean archive", () => {
    expect(cats(buildZip([{ name: "model.usdc", data: Buffer.from([1, 2, 3, 4, 5]) }]), "a.usdz")).toEqual([]);
  });
});

describe("SVG, STL, PDF, source maps", () => {
  it("finds literals in SVG comments and flags editor data", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><!-- drawn for ${PLANT.place} --><metadata/></svg>`;
    expect(cats(svg, "a.svg")).toContain("denylist/place");
    expect(cats('<svg xmlns:sodipodi="x" sodipodi:docname="file.svg"></svg>', "a.svg")).toContain("meta/editor-data");
    expect(cats('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>', "a.svg")).toEqual([]);
  });

  it("reads STL headers (binary) and names (ASCII)", () => {
    const header = Buffer.alloc(80);
    header.write(`exported for ${PLANT.place}`);
    const stl = Buffer.concat([header, Buffer.alloc(4)]);
    expect(cats(stl, "a.stl")).toContain("denylist/place");
    expect(cats(`solid ${PLANT.place}\nfacet normal 0 0 1\nendsolid`, "a.stl")).toContain("denylist/place");
  });

  it("reads the PDF info dictionary and flags the author", () => {
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Author (${PLANT.person}) /Title (${PLANT.place}) >>\nendobj\ntrailer\n<< /Info 1 0 R >>\n%%EOF`);
    expect(cats(pdf, "a.pdf")).toEqual(expect.arrayContaining(["denylist/person", "denylist/place", "meta/personal-field"]));
    const stream = zlib.deflateSync(Buffer.from(`BT (${PLANT.place}) Tj ET`));
    const pdf2 = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n"), stream, Buffer.from("\nendstream\nendobj\n%%EOF")]);
    expect(cats(pdf2, "b.pdf")).toContain("denylist/place");
  });

  it("scans source maps without the mappings", () => {
    const map = JSON.stringify({ version: 3, file: "a.js", sources: [["webpack:///", "/Us", "ers/someone/app/a.ts"].join("")], sourcesContent: [`const x = "${PLANT.place}";`], names: [], mappings: "AAAA,SAASA,AAAA;".repeat(50) });
    expect(cats(map, "a.js.map")).toEqual(expect.arrayContaining(["denylist/place", "generic/abs-path"]));
    const clean = JSON.stringify({ version: 3, sources: ["src/a.ts"], sourcesContent: ["export {};"], names: ["a"], mappings: "AAAA,SAASA,AAAA;".repeat(200) });
    expect(cats(clean, "b.js.map")).toEqual([]);
  });
});

describe("unknown binaries", () => {
  it("finds strings in files of unknown type", () => {
    const blob = Buffer.concat([Buffer.alloc(100, 1), Buffer.from(`path ${PLANT.place}`), Buffer.alloc(100, 2)]);
    expect(cats(blob, "font.woff2")).toContain("denylist/place");
    expect(cats(Buffer.alloc(5000, 7), "font.woff2")).toEqual([]);
  });

  it("writes files for a CLI run elsewhere", () => {
    // sanity check of the helper itself
    const dir = tmpDir();
    expect(fs.existsSync(write(dir, "a/b.txt", "x"))).toBe(true);
  });
});
