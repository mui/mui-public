'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import {
  CHUNK_COUNT,
  CHUNK_SIZE,
  ChartFrame,
  Segment,
  buildChunk,
  delay,
  useSweepFront,
  type Chunk,
} from '../sweepChart';

// Streams the chunks right-to-left (the rightmost segment first), one every
// 220ms, so the coarse baseline draws itself across the chart over time.
const source: StreamSource<Chunk, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    for (let step = 0; step < CHUNK_COUNT; step += 1) {
      const index = CHUNK_COUNT - 1 - step;
      // eslint-disable-next-line no-await-in-loop -- sequential reveal is the point of the demo
      await delay(220, signal);
      if (signal.aborted) {
        return;
      }
      chunks.push(buildChunk(index));
      yield;
    }
  },
};

export function StreamSweepChart() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useStream<Chunk, void>({ source });

  // Detail trails the baseline: a second front sweeps the same right-to-left order
  // a beat later, and never outruns the chunks that have actually streamed in.
  const front = useSweepFront(CHUNK_COUNT, 220, 360);
  const detailedFront = Math.min(front, chunks.length);

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ChartFrame>
          {chunks.map((chunk) => (
            <Segment
              key={chunk.index}
              chunk={chunk}
              ready={chunk.index >= CHUNK_COUNT - detailedFront}
            />
          ))}
        </ChartFrame>
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading
            ? `streaming ${chunks.length}/${CHUNK_COUNT} · detailed ${detailedFront}`
            : `done — ${CHUNK_COUNT * CHUNK_SIZE} points`}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}
