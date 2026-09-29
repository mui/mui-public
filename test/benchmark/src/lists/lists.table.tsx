import * as React from 'react';
import { benchmark } from '@mui/internal-benchmark';
import { ScrollingList } from '../_shared/ScrollingList';

const ROWS = 1000;

function List() {
  return (
    <table>
      <tbody>
        {Array.from({ length: ROWS }, (_, index) => (
          <tr key={index}>
            <td>Row {index}</td>
            <td>{index % 7}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
