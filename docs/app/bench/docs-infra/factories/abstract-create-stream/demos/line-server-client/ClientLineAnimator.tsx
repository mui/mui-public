'use client';
import * as React from 'react';
import { CoordinatedLazy } from '@mui/internal-docs-infra/CoordinatedLazy';

// Advances a front one chunk per animation frame for the serial detail swap.
function useSerialFront(count: number): number {
  const [front, setFront] = React.useState(0);
  React.useEffect(() => {
    let raf = 0;
    let current = 0;
    const tick = () => {
      current += 1;
      setFront(current);
      if (current < count) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);
  return front;
}

// Receives the server-computed paths as props (no client-side projection) and
// runs the coarse→full serial swap on the client.
export function ClientLineAnimator({
  fullPaths,
  simplePaths,
  width,
  height,
}: {
  fullPaths: string[];
  simplePaths: string[];
  width: number;
  height: number;
}) {
  // @focus-start @padding 1
  const front = useSerialFront(fullPaths.length);
  return (
    <svg
      width={width}
      height={height}
      style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
    >
      {fullPaths.map((path, index) => (
        <CoordinatedLazy
          key={index}
          // Detail sweeps right-to-left: the rightmost chunk swaps first.
          ready={index >= fullPaths.length - front}
          fallback={
            <polyline points={simplePaths[index]} fill="none" stroke="#cdbef0" strokeWidth={1} />
          }
          content={<polyline points={path} fill="none" stroke="#7c3aed" strokeWidth={1} />}
        />
      ))}
    </svg>
  );
  // @focus-end
}
