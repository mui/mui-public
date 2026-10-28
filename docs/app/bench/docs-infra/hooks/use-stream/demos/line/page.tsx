'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';
import { CoordinatedLazy } from '@mui/internal-docs-infra/CoordinatedLazy';

const TOTAL = 100_000;
const CHUNK_SIZE = 1000;
const CHUNK_COUNT = TOTAL / CHUNK_SIZE; // 100
const SIMPLE_PER_CHUNK = 10;
const WIDTH = 900;
const HEIGHT = 220;

// A flowing multi-harmonic signal: a couple of low harmonics for the overall
// shape, plus finer detail whose amplitude swells and fades across the chart (the
// envelope) — so the 10-point loading slice reads as a clean sketch while the
// 1000-point detail adds the texture.
const TAU = Math.PI * 2;
const curve = (t: number) => {
  const envelope = 0.4 + 0.6 * Math.abs(Math.sin(t * TAU * 1.3));
  const base = 0.6 * Math.sin(t * TAU * 2.4) + 0.26 * Math.sin(t * TAU * 5.7 + 0.8);
  const detail = envelope * (0.2 * Math.sin(t * TAU * 23) + 0.09 * Math.sin(t * TAU * 411));
  return HEIGHT / 2 - ((HEIGHT / 2 - 16) / 1.2) * (base + detail);
};

const project = (globalIndex: number) =>
  `${(globalIndex / TOTAL) * WIDTH},${curve(globalIndex / TOTAL)}`;

// Precompute every chunk's full and simplified polyline strings once (100k point
// projections at module load), so streaming and the serial swap stay cheap.
const FULL_PATHS: string[] = [];
const SIMPLE_PATHS: string[] = [];
for (let chunk = 0; chunk < CHUNK_COUNT; chunk += 1) {
  const start = chunk * CHUNK_SIZE;
  const full: string[] = [];
  for (let offset = 0; offset <= CHUNK_SIZE; offset += 1) {
    full.push(project(start + offset));
  }
  FULL_PATHS.push(full.join(' '));

  const simple: string[] = [];
  for (let step = 0; step < SIMPLE_PER_CHUNK; step += 1) {
    simple.push(project(start + Math.round((step / (SIMPLE_PER_CHUNK - 1)) * CHUNK_SIZE)));
  }
  SIMPLE_PATHS.push(simple.join(' '));
}

interface Chunk {
  index: number;
}

// Yield all 100 chunks at once, so the whole coarse chart is on screen before any
// detail swaps in.
const source: StreamSource<Chunk, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    if (signal.aborted) {
      return;
    }
    for (let index = 0; index < CHUNK_COUNT; index += 1) {
      chunks.push({ index });
    }
    yield;
  },
};

// Advances a front from 0 to `count`, one chunk per animation frame, so the detail
// swaps land serially as fast as the browser can paint them.
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

function Segment({ index, detailed }: { index: number; detailed: boolean }) {
  return (
    <CoordinatedLazy
      ready={detailed}
      fallback={
        <polyline points={SIMPLE_PATHS[index]} fill="none" stroke="#cdbef0" strokeWidth={1} />
      }
      content={<polyline points={FULL_PATHS[index]} fill="none" stroke="#7c3aed" strokeWidth={1} />}
    />
  );
}

export default function Page() {
  // @focus-start
  const { chunks, Controller } = useStream<Chunk, void>({ source });
  const front = useSerialFront(CHUNK_COUNT);

  return (
    <Controller>
      <svg
        width={WIDTH}
        height={HEIGHT}
        style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
      >
        {chunks.map((chunk) => (
          // Detail sweeps right-to-left: the highest-index (rightmost) chunk swaps first.
          <Segment
            key={chunk.index}
            index={chunk.index}
            detailed={chunk.index >= CHUNK_COUNT - front}
          />
        ))}
      </svg>
    </Controller>
  );
  // @focus-end
}
