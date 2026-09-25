import * as React from 'react';
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

function ScrollingList() {
  const [scrollTop, setScrollTop] = React.useState(0);
  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: 400, height: 300, overflow: 'auto' }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <p style={{ position: 'sticky', top: 0, margin: 0, background: 'white' }}>
        Scrolled {Math.round(scrollTop)}px
      </p>
      <List />
    </div>
  );
}

benchmark('mount', () => <List />);

benchmark(
  'scroll',
  () => <ScrollingList />,
  async ({ input, resumeReactRecording, waitForElementTiming }) => {
    // The scroller has to be painted before a gesture can hit it.
    await waitForElementTiming('default');
    resumeReactRecording();
    await input.scroll({ x: 200, y: 150, deltaY: 1200, speed: 2400 });
  },
  { reactRecordingPaused: true },
);
