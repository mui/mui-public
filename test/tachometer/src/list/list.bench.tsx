import * as React from 'react';
import { benchmark, ScalarMetric } from '@mui/internal-benchmark';
import { reactMajor } from '@mui/internal-test-utils/env';

/**
 * `benchmark()` cases, the same API Vitest runs. Under `tacho run --engine interleaved` each case
 * runs one iteration at a time in a page that stays open per build, with the builds alternating
 * round by round.
 *
 * Like the `workload` page, it imports a workspace package so both builds resolve it from their own
 * packed tarball.
 */

function List({ count }: { count: number }) {
  return (
    <ul data-react={reactMajor}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>Item {index}</li>
      ))}
    </ul>
  );
}

benchmark('list mount', () => <List count={1000} />);

const scrollDuration = new ScalarMetric({
  name: 'scroll_gesture',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
});

function ScrollingList() {
  const [scrollTop, setScrollTop] = React.useState(0);
  return (
    <div
      data-testid="scroller"
      style={{ position: 'fixed', top: 0, left: 0, width: 400, height: 300, overflow: 'auto' }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <p style={{ position: 'sticky', top: 0, margin: 0, background: 'white' }}>
        Scrolled {Math.round(scrollTop)}px
      </p>
      <List count={500} />
    </div>
  );
}

// A trusted wheel-style scroll: the browser generates the whole gesture at frame cadence, so the
// list sees the event timing a real mouse wheel would produce.
benchmark(
  'list scroll',
  () => <ScrollingList />,
  async ({ input, resumeReactRecording }) => {
    resumeReactRecording();
    scrollDuration.time();
    await input.scroll({ x: 200, y: 150, deltaY: 1200, speed: 2400 });
    scrollDuration.timeEnd();
  },
  { reactRecordingPaused: true },
);
