import { createStreamFactory } from '@mui/internal-docs-infra/abstractCreateStream';
import ServerLineChart from './ServerLineChart';
import { SimpleLineChart } from '../SimpleLineChart';

// @focus-start
// Server `Loader` computes the dataset in RSC, then renders the client animator
// with the data as props — so the heavy projection stays on the server while the
// serial coarse→full swap still runs on the client.
const createStream = createStreamFactory({
  ChunkContent: ServerLineChart,
  ChunkLoading: SimpleLineChart,
  Loader: () => import('./ServerLineChart'),
});

export default createStream(import.meta.url);
// @focus-end
