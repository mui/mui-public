import * as React from 'react';
import { HEIGHT, LINE, WIDTH } from '../lineData';
import { ClientLineAnimator } from './ClientLineAnimator';

// Computes the dataset on the server (the projection ran in `lineData`) and hands
// it to the client animator as props — so the client renders and runs the serial
// swap without ever projecting points itself.
export default function ServerLineChart() {
  return (
    // @focus-start
    <ClientLineAnimator
      fullPaths={LINE.fullPaths}
      simplePaths={LINE.simplePaths}
      width={WIDTH}
      height={HEIGHT}
    />
    // @focus-end
  );
}
