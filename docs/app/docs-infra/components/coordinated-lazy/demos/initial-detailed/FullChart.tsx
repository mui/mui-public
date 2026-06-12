import * as React from 'react';
import { DETAILED, Line } from './lineParts';

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// The detailed line, resolved on the server after a delay (which stands in for a
// real load). It suspends, so the coarse `ChunkLoading` shows until it resolves.
async function DetailLine() {
  await delay(1400);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Line points={DETAILED} detailed />
      <div style={{ font: '13px monospace', color: '#3f8f3f' }}>
        detailed — {DETAILED.length} points
      </div>
    </div>
  );
}

// The full content (the server `Loader` target): it suspends on the detailed line,
// so the coarse preview streams first and swaps to the detail once the server
// resolves it. No client computation — the browser only hydrates the markup.
export default function FullChart() {
  return (
    // @focus
    <DetailLine />
  );
}
