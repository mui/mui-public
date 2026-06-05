import { it } from 'vitest';
import { ScalarMetric, DiscreteMetric } from '@mui/internal-benchmark';

function fib(n: number): number {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

// A scalar timing metric with an alarm: regressions past 10% warn, past 25% error.
const duration = new ScalarMetric({
  name: 'fib_duration',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 3 },
  alarm: { direction: 'lowerIsBetter', warn: 0.1, error: 0.25 },
});

// A discrete count metric (informational), compared as an exact integer.
const evenResults = new DiscreteMetric({ name: 'fib_even_results' });

it('custom scalar + discrete metrics', () => {
  for (let run = 0; run < 50; run += 1) {
    duration.time();
    const result = fib(22);
    duration.timeEnd();

    evenResults.record(result % 2 === 0 ? 1 : 0);
  }
});

// A second scalar metric demonstrating labeled sub-series via `time`/`timeEnd` labels.
const phases = new ScalarMetric({
  name: 'fib_phase',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 3 },
});

it('sub-series via labels', () => {
  for (let run = 0; run < 50; run += 1) {
    phases.time('small');
    fib(18);
    phases.timeEnd('small'); // -> fib_phase#small

    phases.time('large');
    fib(24);
    phases.timeEnd('large'); // -> fib_phase#large
  }
});
