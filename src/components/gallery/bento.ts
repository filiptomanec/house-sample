// Bento layout of the gallery tiles for any number of tiles (pure). The grid has four columns on wide screens; every tile
// gets a size in grid cells and the sizes of a whole list always fill complete rows, so no hole is left at the end.
//
//   big   2 x 2        wide  2 x 1        small  1 x 1        full  4 x 2 (a lone last tile)
//
// A block of five tiles is one big and four small ones (4 x 2 cells). A block of three is one big and two wide ones. Two
// tiles left over become two big ones, one tile becomes a full-width one. Blocks alternate sides so the big tile zig-zags.
export type TileSize = "small" | "wide" | "big" | "full";

export interface Tile {
  size: TileSize;
  /** The big tile sits on the right of its block (4-column grid). */
  mirror: boolean;
}

/** Cells (columns x rows) of a tile on the four-column grid. */
export const CELLS: Record<TileSize, [number, number]> = { small: [1, 1], wide: [2, 1], big: [2, 2], full: [4, 2] };

export function bento(count: number): Tile[] {
  const out: Tile[] = [];
  let left = count, block = 0;
  const push = (size: TileSize, mirror = false) => out.push({ size, mirror });
  while (left > 0) {
    const mirror = block % 2 === 1;
    if (left >= 5) { push("big", mirror); for (let i = 0; i < 4; i++) push("small"); left -= 5; }
    else if (left >= 3) { push("big", mirror); push("wide"); push("wide"); left -= 3; }
    else if (left === 2) { push("big", mirror); push("big", !mirror); left -= 2; }
    else { push("full"); left -= 1; }
    block++;
  }
  return out;
}
