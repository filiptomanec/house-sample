// The downloadable model files, from the bundled manifest (sizes and the content hash that busts the cache of the GLB).
// The manifest is read directly, not through the 3D engine, so the export section does not pull three.js in.
import manifestJson from "../../../public/models/manifest.json";
import { shortHash } from "@/lib/model/hash";

interface FileInfo {
  sha256: string;
  bytes: number;
}
const files = manifestJson.files as Record<string, FileInfo | undefined>;

/** The light GLB for phones and for saving, and the USDZ for AR Quick Look (names of the contract, docs/ARCHITECTURE.md section 3). */
export const GLB_FILE = "house-lite.glb";
export const AR_FILE = "house.usdz";

/** Public path of a file; the GLB carries its hash (`?v=`) so a new model is never served from an old cache. */
export const filePath = (name: string, versioned: boolean): string => {
  const info = files[name];
  return versioned && info ? `/models/${name}?v=${shortHash(info.sha256)}` : `/models/${name}`;
};

/** Size in bytes, or null when the manifest does not list the file. */
export const fileBytes = (name: string): number | null => files[name]?.bytes ?? null;
