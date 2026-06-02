'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import { DemoButton } from '@/components/DemoButton/DemoButton';

interface Point {
  x: number;
  y: number;
}

const COUNT = 6;

// Each stream run shifts the curve, so a refresh visibly brings in new data.
let streamRun = 0;
const makePoints = (run: number): Point[] =>
  Array.from({ length: COUNT }, (_unused, index) => ({
    x: index,
    y: 50 + 32 * Math.sin((index / (COUNT - 1)) * Math.PI * 2 + run),
  }));

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// A streaming source: pushes one point at a time with an artificial delay so the
// chart visibly fills in. Re-invoked on every refresh with a fresh dataset.
const source: StreamSource<Point, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    streamRun += 1;
    const points = makePoints(streamRun);
    for (const point of points) {
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
const toXY = (point: Point) => `${(point.x / (COUNT - 1)) * WIDTH},${HEIGHT - point.y}`;

export function StreamingChart() {
  // @focus-start @padding 1
  const { chunks, Controller, loading, revalidating, refresh } = useStream<Point, void>({ source });

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
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
              cx={(point.x / (COUNT - 1)) * WIDTH}
              cy={HEIGHT - point.y}
              r={3}
              fill="#7c3aed"
            />
          ))}
        </svg>
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading
            ? `streaming… ${chunks.length}/${COUNT}`
            : `done — ${chunks.length} points${revalidating ? ' · revalidating…' : ''}`}
        </div>
        {/* `refresh()` re-streams in the background: the current chart stays up
            (stale-while-revalidate) and swaps once the new data finishes. */}
        <DemoButton onClick={() => refresh()}>Refresh</DemoButton>
      </div>
    </Controller>
  );
  // @focus-end
}
