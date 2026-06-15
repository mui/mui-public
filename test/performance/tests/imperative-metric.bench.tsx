import * as React from 'react';
import { benchmark, ScalarMetric } from '@mui/internal-benchmark';

function simulateSlowdown(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // burn CPU
  }
}

function Widget() {
  return <div data-state="idle">Widget</div>;
}

const updateWork = new ScalarMetric({
  name: 'imperative_update',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 3 },
});

// Recording stays paused for the whole benchmark: the interaction mutates the DOM imperatively (no
// React re-render) and measures only a custom metric. The harness must not require a React render
// here — there is no active recording window to validate.
benchmark(
  'Widget imperative update (metric only)',
  () => <Widget />,
  async () => {
    const node = document.querySelector('[data-state]');
    updateWork.time();
    node?.setAttribute('data-state', 'active');
    simulateSlowdown(1);
    updateWork.timeEnd();
  },
  {
    runs: 10,
    warmupRuns: 5,
    reactRecordingPaused: true,
  },
);
