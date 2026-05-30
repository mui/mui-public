'use client';
import * as React from 'react';
import { useChunks } from '@mui/internal-docs-infra/useChunks';
import type { ChunkSource } from '@mui/internal-docs-infra/useChunks';

interface Point {
  x: number;
  y: number;
}

const POINTS: Point[] = [
  { x: 0, y: 24 },
  { x: 1, y: 48 },
  { x: 2, y: 30 },
  { x: 3, y: 62 },
  { x: 4, y: 52 },
  { x: 5, y: 84 },
];

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// A streaming source: pushes one point at a time with an artificial delay so
// the chart visibly fills in. The generator's return is the last-chunk signal.
const source: ChunkSource<Point, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    for (const point of POINTS) {
      // eslint-disable-next-line no-await-in-loop -- sequential reveal is the point of the demo
      await delay(450, signal);
      if (signal.aborted) {
        return;
      }
      chunks.push(point);
      yield;
    }
  },
};

const WIDTH = 260;
const HEIGHT = 100;
const toXY = (point: Point) => `${(point.x / 5) * WIDTH},${HEIGHT - point.y}`;

export function StreamingChart() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useChunks<Point, void>({ source });

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <svg
          width={WIDTH}
          height={HEIGHT}
          style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
        >
          <polyline
            points={chunks.map(toXY).join(' ')}
            fill="none"
            stroke="#7c3aed"
            strokeWidth={2}
          />
          {chunks.map((point) => (
            <circle
              key={point.x}
              cx={(point.x / 5) * WIDTH}
              cy={HEIGHT - point.y}
              r={3}
              fill="#7c3aed"
            />
          ))}
        </svg>
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading
            ? `streaming… ${chunks.length}/${POINTS.length}`
            : `done — ${chunks.length} points`}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}
