'use client';
import * as React from 'react';
import {
  CoordinatedLazy,
  useCoordinatedContent,
  useCoordinatedFallback,
} from '@mui/internal-docs-infra/CoordinatedLazy';

export interface Point {
  x: number;
  y: number;
}

export interface Chunk {
  index: number;
  points: Point[];
}

export const CHUNK_SIZE = 100;
export const CHUNK_COUNT = 15;
export const TOTAL = CHUNK_SIZE * CHUNK_COUNT; // 1500
export const WIDTH = 480;
export const HEIGHT = 130;

// A smooth base with higher-frequency detail that coarse sampling can't capture,
// so the simplified slice reads as a rough sketch and the full slice as refined.
const curve = (t: number) =>
  65 +
  34 * Math.sin(t * Math.PI * 2 * 2.2) +
  8 * Math.sin(t * Math.PI * 2 * 19) +
  4 * Math.sin(t * Math.PI * 2 * 47);

const project = (index: number): Point => ({
  x: (index / TOTAL) * WIDTH,
  y: HEIGHT - curve(index / TOTAL),
});

// One chunk's full detail: 100 points plus the shared boundary point, so adjacent
// slices' polylines join without a gap.
export function buildChunk(index: number): Chunk {
  const start = index * CHUNK_SIZE;
  const points = Array.from({ length: CHUNK_SIZE + 1 }, (_unused, i) => project(start + i));
  return { index, points };
}

// Coarse downsample: keep roughly every 14th point (and the last) — enough for the
// overall shape, too sparse for the wiggles.
export function simplify(points: Point[]): Point[] {
  const step = 14;
  const coarse = points.filter((_unused, i) => i % step === 0);
  const last = points[points.length - 1];
  if (coarse[coarse.length - 1] !== last) {
    coarse.push(last);
  }
  return coarse;
}

const toPath = (points: Point[]) => points.map((point) => `${point.x},${point.y}`).join(' ');

export const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// Ramps an integer front from 0 to `target`, one step per `intervalMs`, after an
// optional start delay — the sweep that drives the right-to-left detail order.
export function useSweepFront(target: number, intervalMs: number, startDelayMs = 0): number {
  const [front, setFront] = React.useState(0);
  React.useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    const startId = setTimeout(() => {
      intervalId = setInterval(() => {
        setFront((prev) => {
          if (prev >= target) {
            clearInterval(intervalId);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }, startDelayMs);
    return () => {
      clearTimeout(startId);
      clearInterval(intervalId);
    };
  }, [target, intervalMs, startDelayMs]);
  return front;
}

export function ChartFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
    >
      {children}
    </svg>
  );
}

function SimpleSlice({ points }: { points: Point[] }) {
  // The fallback "loads" the full slice, hoists it for the content, and paints a
  // coarse sketch from a downsample of it.
  useCoordinatedFallback(React.useMemo(() => ({ points }), [points]));
  return (
    <polyline
      points={toPath(simplify(points))}
      fill="none"
      stroke="#cdbef0"
      strokeWidth={1.5}
      strokeDasharray="4 3"
    />
  );
}

function DetailSlice() {
  // The content reuses the hoisted slice — no reload — and draws every point.
  const { points } = useCoordinatedContent() as { points: Point[] };
  return <polyline points={toPath(points)} fill="none" stroke="#7c3aed" strokeWidth={2} />;
}

// One streamed chunk as a coordinated swap: the coarse sketch until `ready`, then
// the full-detail slice drawn from the hoisted points.
export function Segment({ chunk, ready }: { chunk: Chunk; ready: boolean }) {
  return (
    <CoordinatedLazy
      ready={ready}
      requireHoist
      fallback={<SimpleSlice points={chunk.points} />}
      content={<DetailSlice />}
    />
  );
}
