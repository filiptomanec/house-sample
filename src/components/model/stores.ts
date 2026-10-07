// The remembered choices of the 3D page: switches (STORAGE_KEYS.model) and the look (STORAGE_KEYS.look).
// One store per entry, shared by everything on the page; read through `useSyncExternalStore` (see storedStore.ts).
import styleJson from "../../../model/style.json";
import type { LookSelection, StyleModel } from "@/lib/three/style";
import { defaultLook } from "@/lib/three/style";
import { DEFAULT_SETTINGS, parseLook, parseSettings, type ModelSettings } from "./settings";
import { createStoredStore } from "./storedStore";

/** model/style.json as the engine sees it (`ctx.style`); the page needs the looks for the pickers. */
export const style = styleJson as unknown as StyleModel;

export const settingsStore = createStoredStore<ModelSettings>("model", DEFAULT_SETTINGS, parseSettings);
export const lookStore = createStoredStore<LookSelection>("look", defaultLook(style), (d) => parseLook(d, style));
