// Is WebGL 2 available? Kept free of three.js so the page shell can ask before the 3D chunk is loaded.

/** Probes for WebGL2 with a throw-away canvas (the context is released at once; iOS allows few contexts). */
export function isWebGlAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
