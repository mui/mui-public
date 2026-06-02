import * as React from 'react';
import { createStreamFactory } from '@mui/internal-docs-infra/abstractCreateStream';
import { ScatterChartLoading } from '../scatterParts';
import ScatterChart from './ScatterChart';

// @focus-start
// Server loading: the `Loader` dynamically imports `ScatterChart` (server-only),
// which computes the scatter on the server and streams it under Suspense — no
// loader functions cross the RSC boundary. `ScatterChart` then drives the
// coarse→detail hoist swap on the client.
const createStream = createStreamFactory({
  ChunkContent: ScatterChart,
  ChunkLoading: ScatterChartLoading,
  Loader: () => import('./ScatterChart'),
});

const Stream = createStream(import.meta.url);

export default function Page() {
  return <Stream />;
}
// @focus-end
