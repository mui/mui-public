import * as React from 'react';
import { ScrollingList } from '../_shared/ScrollingList';
import { benchmark } from '@mui/internal-benchmark';

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

benchmark('mount', () => <List />);

benchmark(
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
