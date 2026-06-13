import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { benchmark, ElementTiming, ScalarMetric } from '@mui/internal-benchmark';

function simulateSlowdown(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // burn CPU
  }
}

function Counter() {
  const [count, setCount] = React.useState(0);
  simulateSlowdown(2);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {/* `key` forces a fresh element per state, so each paints its own element-timing entry. */}
      <ElementTiming key={count} name={count === 0 ? 'ready' : 'clicked'} />
      {count}
    </button>
  );
}

// A custom metric recorded inside the benchmark. Warmup iterations are excluded automatically, so
// this yields exactly `runs` samples without the interaction needing to know about warmup.
const clickWork = new ScalarMetric({
  name: 'click_work',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 3 },
});

// Start with React recording paused so the mount is excluded. Await the mount paint (which lands in
// its own frame while paused), resume, then measure only the click's re-render and the paint it
// produces — so the report shows a single `bench:update` render and a single `bench:paint#clicked`.
benchmark(
  'Counter click (interaction only)',
  () => <Counter />,
  async ({ resumeReactRecording, waitForElementTiming }) => {
    await waitForElementTiming('ready'); // mount paint — recorded while paused, so excluded
    resumeReactRecording();
    clickWork.time();
    ReactDOM.flushSync(() => {
      document.querySelector('button')?.click();
    });
    clickWork.timeEnd(); // wraps the synchronous re-render
    await waitForElementTiming('clicked'); // interaction paint — recorded
  },
  {
    runs: 10,
    warmupRuns: 5,
    reactRecordingPaused: true,
  },
);
