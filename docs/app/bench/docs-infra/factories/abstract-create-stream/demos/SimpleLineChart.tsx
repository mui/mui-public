import * as React from 'react';
import { HEIGHT, LINE, WIDTH } from './lineData';

// The loading placeholder: the coarse chart, rendered on the server (cheap) and
// shown under Suspense while the full chart's server Loader resolves.
export function SimpleLineChart() {
  return (
    // @focus-start
    <svg
      width={WIDTH}
      height={HEIGHT}
      style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
    >
      {LINE.simplePaths.map((path, index) => (
        <polyline key={index} points={path} fill="none" stroke="#cdbef0" strokeWidth={1} />
      ))}
    </svg>
    // @focus-end
  );
}
