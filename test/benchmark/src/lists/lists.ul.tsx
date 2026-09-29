import * as React from 'react';
import { reactBenchmark } from '@mui/internal-benchmark/page';
import { ScrollingList } from '../_shared/ScrollingList';

const ROWS = 1000;

function List() {
  return (
    <ul>
      {Array.from({ length: ROWS }, (_, index) => (
        <li key={index}>
          Row {index} <span>{index % 7}</span>
        </li>
      ))}
    </ul>
  );
}

reactBenchmark('mount', () => <List />);

reactBenchmark(
  'scroll',
  () => (
    <ScrollingList>
      <List />
    </ScrollingList>
  ),
  async ({ input, resumeReactRecording, waitForElementTiming }) => {
    // The scroller has to be painted before a gesture can hit it.
    await waitForElementTiming('default');
    resumeReactRecording();
    await input.scroll({ x: 200, y: 150, deltaY: 1200, speed: 2400 });
  },
  { reactRecordingPaused: true },
);
