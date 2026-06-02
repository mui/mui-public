'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import { CoordinatedLazy } from '@mui/internal-docs-infra/CoordinatedLazy';

const WIDTH = 900;
const HEIGHT = 400;
const TARGET = 800; // points a chunk grows to hold before it stops expanding
const MAX_W = 150;
const MAX_H = 100;
const ASPECT = 1.6; // cap a chunk's width at this multiple of its row height (keep ~square)
const MIN_ROW_H = 24; // absorb a leftover thinner than this into the last row (no sliver rows)
const GRID = 3; // prefix-sum cell size (px) for fast region counts
const CELL = 16; // cluster cell size (px) for the simplified view
const POINT_RADIUS = 0.8; // detailed dot radius; also how far a dot spills into neighbor chunks
const BLUE_RADIUS = 2.5; // live blue-dot radius (and its spill into neighbor chunks)
const POINT_BATCH = 20000; // points processed per slice before yielding
const CELL_BATCH = 1024; // cluster grid cells processed per slice before yielding

export interface Point {
  x: number;
  y: number;
}
interface Cluster {
  x: number;
  y: number;
  r: number;
}
interface ScatterChunk {
  rect: { x: number; y: number; w: number; h: number };
  points: Point[];
  clusters: Cluster[];
}
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

// Stable empty array for chunks with no blue dots — a fresh `[]` per render would
// defeat the `React.memo` on those chunks.
const EMPTY: Point[] = [];

// Seeded PRNG (sine-hash, no bitwise) so the server and client generate the
// identical point set — no hydration mismatch from `Math.random`.
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state += 1;
    const value = Math.sin(state) * 10000;
    return value - Math.floor(value);
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Sample `total` points (gaussian blobs + uniform, so density varies) within the
// chart. Seeded, so it's deterministic across server and client.
export function generateScatterPoints(total: number): Point[] {
  // @focus-start @padding 1
  const rand = makeRandom(24301);
  const blobs = Array.from({ length: 8 }, () => ({
    cx: rand() * WIDTH,
    cy: rand() * HEIGHT,
    spread: 18 + rand() * 70,
  }));
  const points: Point[] = new Array(total);
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
    points[i] = { x: clamp(px, 0, WIDTH), y: clamp(py, 0, HEIGHT) };
  }
  return points;
  // @focus-end
}

// Hand control back to the browser between batches, so a large dataset is tiled
// in small non-blocking slices instead of one long task.
const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

// Tile `points` into adaptive square chunks and build each chunk's clusters — all
// in batches that yield between slices so the first render isn't blocked. Resolves
// to `[]` if aborted.
async function computeChunksAsync(points: Point[], signal: AbortSignal): Promise<ScatterChunk[]> {
  const total = points.length;

  // Integral image of point counts over a fine grid for O(1) region counts.
  const GW = Math.ceil(WIDTH / GRID);
  const GH = Math.ceil(HEIGHT / GRID);
  const integral = new Uint32Array((GW + 1) * (GH + 1));
  for (let start = 0; start < total; start += POINT_BATCH) {
    const end = Math.min(start + POINT_BATCH, total);
    for (let i = start; i < end; i += 1) {
      const gx = clamp(Math.floor(points[i].x / GRID), 0, GW - 1);
      const gy = clamp(Math.floor(points[i].y / GRID), 0, GH - 1);
      integral[(gy + 1) * (GW + 1) + (gx + 1)] += 1;
    }
    if (signal.aborted) {
      return [];
    }
    // eslint-disable-next-line no-await-in-loop -- batch boundary: yield to the browser
    await yieldToBrowser();
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

  // Greedy adaptive tiling: each row's first chunk grows a square to ~TARGET
  // points (capped by MAX_H) to fix the row height; the rest keep that height and
  // grow only width to ~TARGET (capped by MAX_W).
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
    // Absorb a too-thin leftover into this row, so the bottom isn't a sliver row.
    if (HEIGHT - (rowTop + rowHeight) < MIN_ROW_H) {
      rowHeight = HEIGHT - rowTop;
    }
    // Bound width to the row height so chunks stay ~square.
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

  // Which chunks a dot's circle overlaps, so a boundary dot is drawn by each chunk
  // it touches (each clipped <svg> shows its slice; together they show the dot).
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

  const chunks: ScatterChunk[] = rects.map((rect) => ({
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    points: [],
    clusters: [],
  }));

  // Detailed dots: each point is drawn by every chunk its dot overlaps.
  for (let start = 0; start < total; start += POINT_BATCH) {
    const end = Math.min(start + POINT_BATCH, total);
    for (let i = start; i < end; i += 1) {
      const point = points[i];
      for (const index of chunksOverlapping(point.x, point.y, POINT_RADIUS)) {
        chunks[index].points.push(point);
      }
    }
    if (signal.aborted) {
      return [];
    }
    // eslint-disable-next-line no-await-in-loop -- batch boundary: yield to the browser
    await yieldToBrowser();
  }

  // Fallback clusters use a single global CELL grid (chunk-agnostic), so a dense
  // region forms the same clusters whether or not a chunk boundary runs through
  // it — no seam or doubled dots at boundaries. Each cluster is then drawn by
  // every chunk it overlaps, the same boundary handling as the detailed dots.
  const gridCols = Math.ceil(WIDTH / CELL);
  const gridRows = Math.ceil(HEIGHT / CELL);
  const sumX = new Float64Array(gridCols * gridRows);
  const sumY = new Float64Array(gridCols * gridRows);
  const counts = new Uint32Array(gridCols * gridRows);
  for (let start = 0; start < total; start += POINT_BATCH) {
    const end = Math.min(start + POINT_BATCH, total);
    for (let i = start; i < end; i += 1) {
      const point = points[i];
      const cx = clamp(Math.floor(point.x / CELL), 0, gridCols - 1);
      const cy = clamp(Math.floor(point.y / CELL), 0, gridRows - 1);
      const cell = cy * gridCols + cx;
      sumX[cell] += point.x;
      sumY[cell] += point.y;
      counts[cell] += 1;
    }
    if (signal.aborted) {
      return [];
    }
    // eslint-disable-next-line no-await-in-loop -- batch boundary: yield to the browser
    await yieldToBrowser();
  }
  const cellCount = gridCols * gridRows;
  for (let start = 0; start < cellCount; start += CELL_BATCH) {
    const end = Math.min(start + CELL_BATCH, cellCount);
    for (let cell = start; cell < end; cell += 1) {
      const count = counts[cell];
      if (count > 0) {
        const cluster = {
          x: sumX[cell] / count,
          y: sumY[cell] / count,
          r: clamp(Math.sqrt(count) * 0.7, 1.5, 7),
        };
        for (const hit of chunksOverlapping(cluster.x, cluster.y, cluster.r)) {
          chunks[hit].clusters.push(cluster);
        }
      }
    }
    if (signal.aborted) {
      return [];
    }
    // eslint-disable-next-line no-await-in-loop -- batch boundary: yield to the browser
    await yieldToBrowser();
  }
  return chunks;
}

function useSerialFront(count: number): number {
  const [front, setFront] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    let current = 0;
    const tick = () => {
      current += 1;
      setFront(current);
      if (current < count) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return front;
}

// Default coarse view: the auto-computed clusters, sized by density.
function ClusterDots({ clusters }: { clusters: Cluster[] }) {
  return (
    <React.Fragment>
      {clusters.map((cluster, index) => (
        <circle key={index} cx={cluster.x} cy={cluster.y} r={cluster.r} fill="#cdbef0" />
      ))}
    </React.Fragment>
  );
}

function DetailPoints({
  points,
  renderPoint,
}: {
  points: Point[];
  renderPoint: (point: Point) => React.ReactNode;
}) {
  return (
    <React.Fragment>
      {points.map((point, index) => (
        <React.Fragment key={index}>{renderPoint(point)}</React.Fragment>
      ))}
    </React.Fragment>
  );
}

// One chunk, memoized on its (stable) data, `ready` flag, blue-dot slice, and the
// user's point renderer — so a swap or a blue dot only re-renders/repaints its own
// `contain: strict` <svg>, never the whole 100k-circle chart.
const ChunkRenderer = React.memo(function ChunkRenderer({
  rect,
  ready,
  clusters,
  points,
  blue,
  renderPoint,
}: {
  rect: ScatterChunk['rect'];
  ready: boolean;
  clusters: Cluster[];
  points: Point[];
  blue: Point[];
  renderPoint: (point: Point) => React.ReactNode;
}) {
  return (
    <svg
      width={rect.w}
      height={rect.h}
      viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
      style={{ position: 'absolute', left: rect.x, top: rect.y, contain: 'strict' }}
    >
      <CoordinatedLazy
        ready={ready}
        fallback={<ClusterDots clusters={clusters} />}
        content={<DetailPoints points={points} renderPoint={renderPoint} />}
      />
      {blue.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={BLUE_RADIUS} fill="#0ea5e9" />
      ))}
    </svg>
  );
});

// `ScatterChart.Point` — one detailed dot.
function ScatterPoint({ point }: { point: Point }) {
  return <circle cx={point.x} cy={point.y} r={POINT_RADIUS} fill="#7c3aed" />;
}

interface ChunkProps {
  children: (point: Point) => React.ReactNode;
}

// `ScatterChart.Chunk` — declares how to render a chunk's points. It renders
// nothing itself; `Root` reads its render function and applies it per chunk.
function ScatterChunkTemplate(_props: ChunkProps): null {
  return null;
}

// `ScatterChart.Root` — takes the `points` and orchestrates: it tiles them into
// adaptive chunks (asynchronously), streams the chunks in, swaps each from its
// coarse clusters to the full points, and keeps the live blue dots + footer.
function ScatterRoot({
  points,
  children,
}: {
  points: Point[];
  children: React.ReactElement<ChunkProps>;
}) {
  const renderPoint = React.Children.only(children).props.children;

  // Tile asynchronously (in yielding batches) so the first render isn't blocked.
  const [chunkData, setChunkData] = React.useState<ScatterChunk[]>([]);
  React.useEffect(() => {
    const controller = new AbortController();
    setChunkData([]);
    (async () => {
      const data = await computeChunksAsync(points, controller.signal);
      if (!controller.signal.aborted) {
        setChunkData(data);
      }
    })();
    return () => controller.abort();
  }, [points]);

  const source = React.useMemo<StreamSource<{ index: number }, void>>(
    () => ({
      mode: 'stream',
      async *stream(streamChunks, _options, signal) {
        if (signal.aborted) {
          return;
        }
        for (let index = 0; index < chunkData.length; index += 1) {
          streamChunks.push({ index });
        }
        yield;
      },
    }),
    [chunkData],
  );
  const { chunks, Controller } = useStream<{ index: number }, void>({ source });
  const front = useSerialFront(chunkData.length);

  const totalChunks = chunkData.length;
  const detailed = Math.min(front, totalChunks);
  const computing = totalChunks === 0;
  const done = !computing && detailed >= totalChunks;

  // A new blue dot lands somewhere random every 250ms, slotted into the chunk(s)
  // its circle overlaps — so only those chunks get a new array reference and (via
  // `React.memo`) only those chunks re-render.
  const [blueByChunk, setBlueByChunk] = React.useState<Point[][]>(() => chunkData.map(() => []));
  React.useEffect(() => {
    setBlueByChunk(chunkData.map(() => []));
  }, [chunkData]);
  React.useEffect(() => {
    const id = setInterval(() => {
      const x = Math.random() * WIDTH;
      const y = Math.random() * HEIGHT;
      const hits: number[] = [];
      for (let i = 0; i < chunkData.length; i += 1) {
        const r = chunkData[i].rect;
        if (
          x + BLUE_RADIUS > r.x &&
          x - BLUE_RADIUS < r.x + r.w &&
          y + BLUE_RADIUS > r.y &&
          y - BLUE_RADIUS < r.y + r.h
        ) {
          hits.push(i);
        }
      }
      setBlueByChunk((prev) => {
        const next = prev.slice();
        for (const i of hits) {
          next[i] = [...next[i], { x, y }];
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [chunkData]);

  // A wall-clock timer (integer tenths to avoid float drift) that stops once every
  // chunk is detailed.
  const [tenths, setTenths] = React.useState(0);
  React.useEffect(() => {
    if (done) {
      return undefined;
    }
    const id = setInterval(() => setTenths((value) => value + 1), 100);
    return () => clearInterval(id);
  }, [done]);

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Grid of per-chunk <svg>s, each `contain: strict`, so a chunk swap (or a
            blue dot in it) repaints only its own box. */}
        <div
          style={{
            position: 'relative',
            width: WIDTH,
            height: HEIGHT,
            overflow: 'hidden',
            contain: 'layout paint',
            border: '1px solid #d0cdd7',
            borderRadius: 8,
            background: '#faf9fc',
          }}
        >
          {chunks.map((chunk) => {
            const data = chunkData[chunk.index];
            return (
              <ChunkRenderer
                key={chunk.index}
                rect={data.rect}
                ready={chunk.index < front}
                clusters={data.clusters}
                points={data.points}
                blue={blueByChunk[chunk.index] ?? EMPTY}
                renderPoint={renderPoint}
              />
            );
          })}
        </div>
        <div style={{ font: '13px monospace', color: done ? '#3f8f3f' : '#7c3aed' }}>
          {computing
            ? `computing… ${(tenths / 10).toFixed(1)}s`
            : `${detailed} / ${totalChunks} chunks · ${(tenths / 10).toFixed(1)}s${done ? '' : '…'}`}
        </div>
      </div>
    </Controller>
  );
}

export const ScatterChart = {
  Root: ScatterRoot,
  Chunk: ScatterChunkTemplate,
  Point: ScatterPoint,
};
