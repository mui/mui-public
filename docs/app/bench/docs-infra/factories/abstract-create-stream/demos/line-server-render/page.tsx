import { createStreamFactory } from '@mui/internal-docs-infra/abstractCreateStream';
import FullLineChart from './FullLineChart';
import { SimpleLineChart } from '../SimpleLineChart';

// @focus-start
// Server `Loader`: the full chart is computed and rendered in RSC, streamed under
// Suspense behind the coarse `ChunkLoading` placeholder. Nothing computes on the
// client — it only hydrates the finished markup.
const createStream = createStreamFactory({
  ChunkContent: FullLineChart,
  ChunkLoading: SimpleLineChart,
  Loader: () => import('./FullLineChart'),
});

export default createStream(import.meta.url);
// @focus-end
