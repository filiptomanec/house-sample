// Pole of inaccessibility (the point inside a polygon farthest from its boundary): the best place for a room label.
// Iterative quadtree search after the "polylabel" algorithm; rings are given as outer boundary + holes.
import { ringCentroid, signedDistance, type Pt } from "./geom";

export interface Label {
  x: number;
  y: number;
  /** Distance from (x, y) to the nearest boundary: radius of the largest circle around the label inside the polygon. */
  r: number;
}

interface Cell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

const makeCell = (x: number, y: number, h: number, rings: Pt[][]): Cell => {
  const d = signedDistance([x, y], rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
};

export function poleOfInaccessibility(rings: Pt[][], precision = 0.01): Label {
  const outer = rings[0];
  if (!outer || outer.length < 3) return { x: 0, y: 0, r: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  let h = cellSize / 2;
  if (cellSize === 0) return { x: minX, y: minY, r: 0 };

  // binary max-heap on `max`
  const heap: Cell[] = [];
  const push = (c: Cell): void => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].max >= heap[i].max) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): Cell => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].max > heap[m].max) m = l;
        if (r < heap.length && heap[r].max > heap[m].max) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) push(makeCell(x + h, y + h, h, rings));
  }
  const [cx, cy] = ringCentroid(outer);
  let best = makeCell(cx, cy, 0, rings);
  const boxCell = makeCell(minX + width / 2, minY + height / 2, 0, rings);
  if (boxCell.d > best.d) best = boxCell;

  while (heap.length) {
    const cell = pop();
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    h = cell.h / 2;
    push(makeCell(cell.x - h, cell.y - h, h, rings));
    push(makeCell(cell.x + h, cell.y - h, h, rings));
    push(makeCell(cell.x - h, cell.y + h, h, rings));
    push(makeCell(cell.x + h, cell.y + h, h, rings));
  }
  return { x: best.x, y: best.y, r: Math.max(0, best.d) };
}
