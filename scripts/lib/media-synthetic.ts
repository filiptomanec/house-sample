// Synthetic "renders" for testing the media build without Blender: gradients with a marker for the stills and the day frames,
// and a seamless pan over a fractal texture for the orbit (so that its last frame leads into the first one, like a real
// closed orbit). Made with ImageMagick from scratch; no photographs are involved.
//
//   npx tsx scripts/lib/media-synthetic.ts <dir> [--scale 0.25] [--detail 0.4]    writes the renders of model/render.json below <dir>
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { discoverTools } from "../build-media";
import type { MediaPlan } from "./media-plan";
import { planFromRender } from "./media-plan";
import { parseRenderConfig } from "./render-schema";

const execFileP = promisify(execFile);

export interface SyntheticOptions {
  plan: MediaPlan;
  /** Render output folder to fill (`pipeline/out`-like). */
  dir: string;
  magick: string;
  /** Factor for all sizes (1 = the sizes of the real renders). */
  scale?: number;
  /** Blur of the orbit texture in pixels: smaller = more detail = a bigger video. */
  detail?: number;
  jobs?: number;
}

const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);

function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

type Task = () => Promise<void>;

async function parallel(list: Task[], n: number): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, list.length)) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= list.length) return;
        await list[i]();
      }
    }),
  );
}

/** Creates every render of the plan that does not exist yet and returns the logical names of the files made. */
export async function makeSyntheticRenders(o: SyntheticOptions): Promise<string[]> {
  const k = o.scale ?? 1;
  const { plan } = o;
  const made: string[] = [];
  const textures: Task[] = [];
  const images: Task[] = [];
  const magick = (args: string[]): Promise<unknown> => execFileP(o.magick, args, { env: { ...process.env, MAGICK_THREAD_LIMIT: "1" } });
  const target = (base: string, ext: string): string | null => {
    const f = path.join(o.dir, `${base}.${ext}`);
    if (fs.existsSync(f)) return null;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    return f;
  };

  // gradient pictures with a bright disc whose position follows `t` (0..1)
  const flat = (base: string, w: number, h: number, t: number): void => {
    const f = target(base, "png");
    if (!f) return;
    const hh = hue(base);
    const [W, H] = [even(w * k), even(h * k)];
    const cx = Math.round(W * (0.1 + 0.8 * t));
    const cy = Math.round(H * (0.7 - 0.4 * Math.sin(Math.PI * t)));
    const r = Math.round(H * 0.06);
    images.push(async () => {
      await magick(["-size", `${W}x${H}`, `gradient:hsl(${hh},60%,70%)-hsl(${(hh + 40) % 360},50%,25%)`, "-fill", "white", "-draw", `circle ${cx},${cy} ${cx + r},${cy}`, "-depth", "8", f]);
      made.push(base);
    });
  };
  plan.day.src.forEach((b, i) => flat(b, plan.day.size[0], plan.day.size[1], i / Math.max(1, plan.day.src.length - 1)));
  plan.stills.forEach((s, i) => flat(s.src, 1920, 1080, i / Math.max(1, plan.stills.length - 1)));
  flat(plan.og.src, 1200, 630, 0.5);

  // orbit: a pan over a texture that repeats every frameCount frames, so the loop closes
  const n = plan.orbit.frameCount;
  const work = path.join(o.dir, ".synthetic");
  fs.mkdirSync(work, { recursive: true });
  const pan = (name: string, bases: string[], w: number, h: number, seed: number): void => {
    const [W, H] = [even(w * k), even(h * k)];
    const wide = path.join(work, `${name}.png`);
    const todo = bases.map((b) => ({ b, f: target(b, "jpg") })).filter((x): x is { b: string; f: string } => x.f !== null);
    if (!todo.length) return;
    textures.push(async () => {
      await magick(["-size", `${W}x${H}`, "-seed", String(seed), "plasma:fractal", "-blur", `0x${o.detail ?? 1}`, "(", "+clone", ")", "+append", wide]);
    });
    for (const { b, f } of todo) {
      const off = Math.round((Number(b.slice(b.lastIndexOf("/") + 1)) * W) / n);
      images.push(async () => {
        await magick([wide, "-crop", `${W}x${H}+${off}+0`, "+repage", "-sampling-factor", "4:2:0", "-quality", "92", f]);
        made.push(b);
      });
    }
  };
  pan("orbit-l", plan.orbit.videoSrc, 1920, 1080, 11);
  if (plan.orbit.portraitSrc) pan("orbit-p", plan.orbit.portraitSrc, 1080, 1620, 23);

  try {
    await parallel(textures, 2);
    await parallel(images, o.jobs ?? 6);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return made;
}

if (process.argv[1] && /media-synthetic\.[cm]?[jt]s$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const opt = (name: string): number | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  if (!dir) {
    console.error("usage: media-synthetic.ts <dir> [--scale 0.25] [--detail 0.4]");
    process.exit(2);
  }
  const root = path.resolve(path.dirname(process.argv[1]), "..", "..");
  const tools = discoverTools(root);
  if (!tools.magick) throw new Error("ImageMagick (magick) not found");
  const plan = planFromRender(parseRenderConfig(JSON.parse(fs.readFileSync(path.join(root, "model/render.json"), "utf8"))));
  makeSyntheticRenders({ plan, dir: path.resolve(dir), magick: tools.magick, scale: opt("--scale"), detail: opt("--detail") }).then((made) => console.log(`${made.length} synthetic renders in ${dir}`));
}
