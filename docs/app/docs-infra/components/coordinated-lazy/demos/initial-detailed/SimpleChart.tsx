import * as React from 'react';
import type { ChunkLoadingProps } from '@mui/internal-docs-infra/CoordinatedLazy';
import { LOW_RES, Line, type Point } from './lineParts';

// `ChunkLoading`: the low-res baseline, rendered on the server (cheap) into the SSR
// HTML and shown under Suspense while the detailed line's server `Loader` resolves.
export function SimpleChart(_props: ChunkLoadingProps<{}, Point[]>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* @focus-start */}
      <Line points={LOW_RES} />
      <div style={{ font: '13px monospace', color: '#7c3aed' }}>
        low-res preview — {LOW_RES.length} points
      </div>
      {/* @focus-end */}
    </div>
  );
}
