import * as React from 'react';
import { CHUNK_COUNT, HEIGHT, LINE, WIDTH } from '../lineData';

// A chunk only streams if it *suspends*, so each chunk awaits its turn — the await
// stands in for a per-chunk server data load. React then flushes the boundaries in
// order, so the chart fills in chunk-by-chunk from the server.
const STAGGER_MS = 12;
const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// One chunk's full-detail slice, resolved on the server when its turn comes. The
// stagger counts down from the last chunk, so RSC flushes the boundaries
// right-to-left (the rightmost chunk resolves first).
async function DetailChunk({ index }: { index: number }) {
  await delay((CHUNK_COUNT - 1 - index) * STAGGER_MS);
  return <polyline points={LINE.fullPaths[index]} fill="none" stroke="#7c3aed" strokeWidth={1} />;
}

// The full chart, streamed chunk-by-chunk from RSC: each chunk paints its coarse
// slice immediately (the Suspense fallback) and swaps to full detail when its
// server boundary resolves — no client computation, just streamed markup.
export default function FullLineChart() {
  return (
    // @focus-start
    <svg
      width={WIDTH}
      height={HEIGHT}
      style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
    >
      {Array.from({ length: CHUNK_COUNT }, (_unused, index) => (
        <React.Suspense
          key={index}
          fallback={
            <polyline
              points={LINE.simplePaths[index]}
              fill="none"
              stroke="#cdbef0"
              strokeWidth={1}
            />
          }
        >
          <DetailChunk index={index} />
        </React.Suspense>
      ))}
    </svg>
    // @focus-end
  );
}
