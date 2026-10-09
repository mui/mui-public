import { benchmark, ScalarMetric } from '@mui/internal-benchmark/page';
import { SMOKE_SAMPLING } from '../_shared/sampling';

/**
 * A `benchmark()` case without React: every sample runs the function once, and what it measures is
 * whatever it records.
 */

const parseTime = new ScalarMetric({
  name: 'json:parse',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
  alarm: {},
});

const payload = JSON.stringify(
  Array.from({ length: 20_000 }, (_, index) => ({
    id: index,
    label: `Item ${index}`,
    done: false,
  })),
);

benchmark(
  'parse',
  () => {
    parseTime.time();
    JSON.parse(payload);
    parseTime.timeEnd();
  },
  SMOKE_SAMPLING,
);
