// Scatter compute, run on the server: the `ScatterChart` server component (which
// the factory `Loader` streams) imports these. `computeCoarse` clusters the points
// (the coarse fallback); `computeDetail` tiles + assigns every dot. The point cloud
// is generated once per total (shared by both) so the coarse clusters and the
// detailed dots describe the same points.
import { HEIGHT, POINT_RADIUS, WIDTH } from './scatterConstants';
import type { Cluster, DetailChunk } from './scatterConstants';

const TARGET = 800; // points a chunk grows to hold before it stops expanding
const MAX_W = 150;
const MAX_H = 100;
const ASPECT = 1.6; // cap a chunk's width at this multiple of its row height
const MIN_ROW_H = 24; // absorb a thinner leftover into the last row
const GRID = 3; // prefix-sum cell size (px)
const CELL = 16; // cluster cell size (px)

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
}
interface Row {
  yTop: number;
  yBottom: number;
  chunks: Rect[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Seeded PRNG (sine-hash, no bitwise) so the layout is deterministic.
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state += 1;
    const value = Math.sin(state) * 10000;
    return value - Math.floor(value);
  };
}

// Generate the point cloud once per total (memoized) so the coarse `initial` and
// the detailed `load` see the same points without regenerating.
const pointCache = new Map<number, { xs: Float32Array; ys: Float32Array }>();
function generatePoints(total: number): { xs: Float32Array; ys: Float32Array } {
  const cached = pointCache.get(total);
  if (cached) {
    return cached;
  }
  const xs = new Float32Array(total);
  const ys = new Float32Array(total);
  const rand = makeRandom(24301);
  const blobs = Array.from({ length: 8 }, () => ({
    cx: rand() * WIDTH,
    cy: rand() * HEIGHT,
    spread: 18 + rand() * 70,
  }));
  for (let i = 0; i < total; i += 1) {
    let px: number;
    let py: number;
    if (rand() < 0.72) {
      const blob = blobs[Math.floor(rand() * blobs.length)];
      const mag = Math.sqrt(-2 * Math.log(rand() + 1e-9));
      const ang = 2 * Math.PI * rand();
      px = blob.cx + blob.spread * mag * Math.cos(ang);
      py = blob.cy + blob.spread * mag * Math.sin(ang);
    } else {
      px = rand() * WIDTH;
      py = rand() * HEIGHT;
    }
    xs[i] = clamp(px, 0, WIDTH);
    ys[i] = clamp(py, 0, HEIGHT);
  }
  const result = { xs, ys };
  pointCache.set(total, result);
  return result;
}

// Coarse: cluster the points on a global CELL grid. Rendered as one overlay svg,
// so no tiling is needed — light enough to run during SSR.
export function computeCoarse(total: number): Cluster[] {
  const { xs, ys } = generatePoints(total);
  const gridCols = Math.ceil(WIDTH / CELL);
  const gridRows = Math.ceil(HEIGHT / CELL);
  const sumX = new Float64Array(gridCols * gridRows);
  const sumY = new Float64Array(gridCols * gridRows);
  const counts = new Uint32Array(gridCols * gridRows);
  for (let i = 0; i < total; i += 1) {
    const cx = clamp(Math.floor(xs[i] / CELL), 0, gridCols - 1);
    const cy = clamp(Math.floor(ys[i] / CELL), 0, gridRows - 1);
    const cell = cy * gridCols + cx;
    sumX[cell] += xs[i];
    sumY[cell] += ys[i];
    counts[cell] += 1;
  }
  const clusters: Cluster[] = [];
  for (let cell = 0; cell < counts.length; cell += 1) {
    const count = counts[cell];
    if (count > 0) {
      clusters.push({
        x: sumX[cell] / count,
        y: sumY[cell] / count,
        r: clamp(Math.sqrt(count) * 0.7, 1.5, 7),
      });
    }
  }
  return clusters;
}

// Detail: tile into adaptive chunks and assign each dot to every chunk its
// circle overlaps (boundary spill), so per-chunk svgs never clip a dot.
export function computeDetail(total: number): DetailChunk[] {
  const { xs, ys } = generatePoints(total);

  // Integral image for O(1) region counts.
  const GW = Math.ceil(WIDTH / GRID);
  const GH = Math.ceil(HEIGHT / GRID);
  const integral = new Uint32Array((GW + 1) * (GH + 1));
  for (let i = 0; i < total; i += 1) {
    const gx = clamp(Math.floor(xs[i] / GRID), 0, GW - 1);
    const gy = clamp(Math.floor(ys[i] / GRID), 0, GH - 1);
    integral[(gy + 1) * (GW + 1) + (gx + 1)] += 1;
  }
  for (let y = 1; y <= GH; y += 1) {
    for (let x = 1; x <= GW; x += 1) {
      integral[y * (GW + 1) + x] +=
        integral[(y - 1) * (GW + 1) + x] +
        integral[y * (GW + 1) + (x - 1)] -
        integral[(y - 1) * (GW + 1) + (x - 1)];
    }
  }
  const countRect = (px0: number, py0: number, px1: number, py1: number) => {
    const gx0 = clamp(Math.floor(px0 / GRID), 0, GW);
    const gy0 = clamp(Math.floor(py0 / GRID), 0, GH);
    const gx1 = clamp(Math.ceil(px1 / GRID), 0, GW);
    const gy1 = clamp(Math.ceil(py1 / GRID), 0, GH);
    return (
      integral[gy1 * (GW + 1) + gx1] -
      integral[gy0 * (GW + 1) + gx1] -
      integral[gy1 * (GW + 1) + gx0] +
      integral[gy0 * (GW + 1) + gx0]
    );
  };

  // Greedy adaptive tiling (rows of ~square chunks; no sliver rows).
  const rects: Rect[] = [];
  const rows: Row[] = [];
  let rowTop = 0;
  while (rowTop < HEIGHT) {
    let side = GRID;
    while (
      side < MAX_H &&
      rowTop + side < HEIGHT &&
      countRect(0, rowTop, Math.min(side, MAX_W), rowTop + side) < TARGET
    ) {
      side += GRID;
    }
    let rowHeight = Math.min(side, MAX_H, HEIGHT - rowTop);
    if (HEIGHT - (rowTop + rowHeight) < MIN_ROW_H) {
      rowHeight = HEIGHT - rowTop;
    }
    const maxRowW = Math.min(MAX_W, Math.round(rowHeight * ASPECT));
    const row: Row = { yTop: rowTop, yBottom: rowTop + rowHeight, chunks: [] };
    let x = 0;
    while (x < WIDTH) {
      let w = GRID;
      while (
        w < maxRowW &&
        x + w < WIDTH &&
        countRect(x, rowTop, x + w, rowTop + rowHeight) < TARGET
      ) {
        w += GRID;
      }
      w = Math.min(w, maxRowW, WIDTH - x);
      w = Math.max(w, Math.min(rowHeight, WIDTH - x));
      const rect: Rect = { x, y: rowTop, w, h: rowHeight, index: rects.length };
      rects.push(rect);
      row.chunks.push(rect);
      x += w;
    }
    rows.push(row);
    rowTop += rowHeight;
  }

  // Chunks a dot's circle overlaps, so boundary dots are drawn by each chunk.
  const chunksOverlapping = (cx: number, cy: number, r: number): number[] => {
    const hits: number[] = [];
    for (const row of rows) {
      if (cy + r <= row.yTop || cy - r >= row.yBottom) {
        continue;
      }
      for (const rect of row.chunks) {
        if (cx + r > rect.x && cx - r < rect.x + rect.w) {
          hits.push(rect.index);
        }
      }
    }
    return hits;
  };

  const chunks: DetailChunk[] = rects.map((rect) => ({
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    points: [],
  }));
  for (let i = 0; i < total; i += 1) {
    const point = { x: xs[i], y: ys[i] };
    for (const index of chunksOverlapping(point.x, point.y, POINT_RADIUS)) {
      chunks[index].points.push(point);
    }
  }
  return chunks;
}
