// Types for n8ao (the package ships none): only what the viewer uses. N8AOPass renders the scene itself, so it is the first
// pass of the composer and no RenderPass precedes it.
declare module "n8ao" {
  import type { Camera, Scene } from "three";
  import { Pass } from "three/addons/postprocessing/Pass.js";

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      /** False when an OutputPass later does the colour space and tone mapping. */
      gammaCorrection: boolean;
      halfRes: boolean;
      [key: string]: unknown;
    };
    setSize(width: number, height: number): void;
  }
}
