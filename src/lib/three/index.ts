// Type-only barrel of the 3D engine: import types from here without pulling any module (and so three.js) into a bundle.
// Runtime code is imported from the module that defines it (`@/lib/three/viewer`, `.../house`, ...), and only from the
// Model and Sun routes (`npm run check:bundles`).
export type * from "./frame";
export type * from "./views";
export type * from "./style";
export type * from "./context";
export type * from "./glb";
export type * from "./tier";
export type * from "./viewer";
export type * from "./interior";
export type * from "./house";
export type * from "./roomTags";
export type * from "./terrain";
export type * from "./surroundings";
export type * from "./vegetation";
export type * from "./blinds";
export type * from "./extBlinds";
export type * from "./pv";
export type * from "./walkCollision";
export type * from "./walk";
export type * from "./sunAnalysis";
