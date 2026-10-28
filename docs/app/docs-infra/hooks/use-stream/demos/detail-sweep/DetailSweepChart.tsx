'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import { Replayable } from '@/components/Replayable/Replayable';
import {
  CHUNK_COUNT,
  CHUNK_SIZE,
  ChartFrame,
  Segment,
  buildChunk,
  useSweepFront,
} from '../sweepChart';
import type { Chunk } from '../sweepChart';

// Yields all 15 chunks at once, so every coarse sketch is on screen immediately —
// the full baseline is up before any detail loads.
const source: StreamSource<Chunk, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    if (signal.aborted) {
      return;
    }
    for (let index = 0; index < CHUNK_COUNT; index += 1) {
      chunks.push(buildChunk(index));
    }
    yield;
  },
};

function DetailSweepChartView() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useStream<Chunk, void>({ source });

  // The baseline is up instantly; detail then sweeps in from the right edge. A
  // chunk swaps once the front passes it, so the highest indices detail first.
  const front = useSweepFront(CHUNK_COUNT, 130);

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ChartFrame>
          {chunks.map((chunk) => (
            <Segment key={chunk.index} chunk={chunk} ready={chunk.index >= CHUNK_COUNT - front} />
          ))}
        </ChartFrame>
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading
            ? `detailing… ${front}/${CHUNK_COUNT} chunks`
            : `done — ${CHUNK_COUNT * CHUNK_SIZE} points`}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}

export function DetailSweepChart() {
  return (
    <Replayable>
      <DetailSweepChartView />
    </Replayable>
  );
}
