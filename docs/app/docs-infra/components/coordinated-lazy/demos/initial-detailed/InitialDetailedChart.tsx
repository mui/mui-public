import * as React from 'react';
import { createCoordinatedLazy } from '@mui/internal-docs-infra/CoordinatedLazy';
import type { Point } from './lineParts';
import FullChart from './FullChart';
import { SimpleChart } from './SimpleChart';

// A single chunk: the low-res baseline (`ChunkLoading`) is server-rendered into the
// SSR HTML, then the detailed line streams in from the server `Loader` under
// Suspense and swaps in once it resolves. The loader runs on the server (a config
// `source` would too); the browser only hydrates the streamed markup. For
// client-side loading instead, wrap the chunk in a `ChunkProvider`.
const ChartChunk = createCoordinatedLazy<{}, Point[]>({
  ChunkContent: FullChart,
  ChunkLoading: SimpleChart,
  Loader: () => import('./FullChart'),
});

export function InitialDetailedChart() {
  return (
    // @focus
    <ChartChunk />
  );
}
