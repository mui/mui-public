import * as React from 'react';
import { compare, reactBenchmark } from '@mui/internal-benchmark/page';
import type { BenchmarkInteraction } from '@mui/internal-benchmark/page';
import { ScrollingList } from '../_shared/ScrollingList';
import { TableList } from './lists.table';
import { UlList } from './lists.ul';

/**
 * Two implementations of the same list, compared with each other rather than across builds — the
 * shape a comparison between libraries takes. Each `compare()` is one scenario; the first case is
 * the reference.
 */

const scroll: BenchmarkInteraction = async ({
  input,
  resumeReactRecording,
  waitForElementTiming,
}) => {
  // The scroller has to be painted before a gesture can hit it.
  await waitForElementTiming('default');
  resumeReactRecording();
  await input.scroll({ x: 200, y: 150, deltaY: 1200, speed: 2400 });
};

compare('lists mount', [
  reactBenchmark('ul mount', () => <UlList />),
  reactBenchmark('table mount', () => <TableList />),
]);

compare('lists scroll', [
  reactBenchmark(
    'ul scroll',
    () => (
      <ScrollingList>
        <UlList />
      </ScrollingList>
    ),
    scroll,
    { reactRecordingPaused: true },
  ),
  reactBenchmark(
    'table scroll',
    () => (
      <ScrollingList>
        <TableList />
      </ScrollingList>
    ),
    scroll,
    { reactRecordingPaused: true },
  ),
]);
