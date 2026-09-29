import * as React from 'react';
import { reactBenchmark, ScalarMetric } from '@mui/internal-benchmark/page';
import { reactMajor } from '@mui/internal-test-utils/env';
import { ScrollingList } from '../_shared/ScrollingList';

/**
 * `reactBenchmark()` cases. Under `benchmark run` each case runs one iteration at a time in a page
 * that stays open per build, with the builds alternating round by round.
 *
 * Like the `workload` benchmark, it imports a workspace package so both builds resolve it from their
 * own packed tarball.
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

reactBenchmark('list mount', () => <List count={1000} />);

const scrollDuration = new ScalarMetric({
  name: 'scroll_gesture',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
});

// A trusted wheel-style scroll: the browser generates the whole gesture at frame cadence, so the
// list sees the event timing a real mouse wheel would produce.
reactBenchmark(
  'list scroll',
  () => (
    <ScrollingList>
      <List count={500} />
    </ScrollingList>
  ),
  async ({ input, resumeReactRecording, waitForElementTiming }) => {
    // The scroller has to be painted before a gesture can hit it.
    await waitForElementTiming('default');
    resumeReactRecording();
    scrollDuration.time();
    await input.scroll({ x: 200, y: 150, deltaY: 1200, speed: 2400 });
    scrollDuration.timeEnd();
  },
  { reactRecordingPaused: true },
);
