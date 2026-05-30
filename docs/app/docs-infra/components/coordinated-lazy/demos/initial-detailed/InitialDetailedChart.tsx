'use client';
import * as React from 'react';
import { createCoordinatedLazy } from '@mui/internal-docs-infra/CoordinatedLazy';
import type {
  ChunkContentProps,
  ChunkLoadingProps,
} from '@mui/internal-docs-infra/CoordinatedLazy';

interface Point {
  x: number;
  y: number;
}

const WIDTH = 260;
const HEIGHT = 100;

// The same underlying curve, sampled coarsely for the baseline and finely for
// the detailed line — so the swap reads as "coarse → refined", not two shapes.
const curve = (t: number) =>
  50 + 26 * Math.sin(t * Math.PI * 2.4) + 9 * Math.sin(t * Math.PI * 7.5);
const sample = (count: number): Point[] =>
  Array.from({ length: count }, (_unused, index) => {
    const t = index / (count - 1);
    return { x: t * WIDTH, y: curve(t) };
  });

// Low-resolution baseline — a coarse approximation, painted immediately.
const LOW_RES: Point[] = sample(9);

// Detailed line — many points, loaded after an artificial delay.
const DETAILED: Point[] = sample(72);

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

function Line({ points, detailed }: { points?: Point[]; detailed?: boolean }) {
  const path = (points ?? []).map((point) => `${point.x},${HEIGHT - point.y}`).join(' ');
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
    >
      <polyline
        points={path}
        fill="none"
        stroke={detailed ? '#7c3aed' : '#b9aee0'}
        strokeWidth={detailed ? 2 : 1.5}
        strokeDasharray={detailed ? undefined : '4 3'}
      />
    </svg>
  );
}

// A single chunk whose quick `initial` value (the low-res line) paints while the
// detailed line loads, then swaps in.
const ChartChunk = createCoordinatedLazy<{}, Point[]>({
  ChunkContent: ({ data }: ChunkContentProps<{}, Point[]>) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Line points={data} detailed />
      <div style={{ font: '13px monospace', color: '#3f8f3f' }}>
        detailed — {data?.length} points
      </div>
    </div>
  ),
  ChunkLoading: ({ data }: ChunkLoadingProps<{}, Point[]>) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Line points={data} />
      <div style={{ font: '13px monospace', color: '#7c3aed' }}>
        low-res preview — {data?.length} points
      </div>
    </div>
  ),
  source: {
    mode: 'data',
    initial: () => LOW_RES,
    load: async (_options, signal) => {
      await delay(1400, signal);
      return DETAILED;
    },
  },
});

export function InitialDetailedChart() {
  return (
    // @focus
    <ChartChunk />
  );
}
