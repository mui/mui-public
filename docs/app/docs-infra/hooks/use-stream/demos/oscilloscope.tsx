'use client';
import * as React from 'react';
import {
  CoordinatedLazy,
  useCoordinatedContent,
  useCoordinatedFallback,
} from '@mui/internal-docs-infra/CoordinatedLazy';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';

export const SLICE_WIDTH = 34;
export const WINDOW = 12;
export const FRAME_WIDTH = SLICE_WIDTH * WINDOW; // 408
export const HEIGHT = 120;
export const SUBSAMPLES = 10;
export const TOTAL = 26;
export const TICK_MS = 260;
// Detail trails the live edge by ~2 ticks, so the rightmost couple of slices stay
// coarse until the high-resolution feed catches up.
export const DETAIL_LAG_MS = 540;

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// A stream source that pushes one prebuilt slice per tick — the fast feed placing
// the live edge on a fixed cadence.
export function createTickSource<TData>(items: TData[], tickMs: number): StreamSource<TData, void> {
  return {
    mode: 'stream',
    async *stream(chunks, _options, signal) {
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop -- one slice per tick is the point of the demo
        await delay(tickMs, signal);
        if (signal.aborted) {
          return;
        }
        chunks.push(item);
        yield;
      }
    },
  };
}

// translateX that pins the newest slice to the right edge and scrolls the row left
// as more arrive (positive while the window is still filling).
export function scrollOffset(arrived: number): number {
  return FRAME_WIDTH - arrived * SLICE_WIDTH;
}

export function ScrollFrame({ offset, children }: { offset: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: FRAME_WIDTH,
        height: HEIGHT,
        overflow: 'hidden',
        border: '1px solid #d0cdd7',
        borderRadius: 8,
        background: '#faf9fc',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          transform: `translateX(${offset}px)`,
          // Match the slide duration to the tick cadence so the row moves at a
          // constant velocity — each step finishes as the next begins, with no
          // pause between chunks.
          transition: `transform ${TICK_MS}ms linear`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Hoist({ data, children }: { data: unknown; children: React.ReactNode }) {
  // The fast feed's slice doubles as the payload the detailed feed reads back.
  useCoordinatedFallback(React.useMemo(() => ({ data }), [data]));
  return <React.Fragment>{children}</React.Fragment>;
}

function Reveal<TData>({ render }: { render: (data: TData) => React.ReactElement }) {
  const { data } = useCoordinatedContent() as { data: TData };
  return render(data);
}

// A single column that enters coarse and refines to detail `lagMs` after it mounts:
// the fast feed paints the sketch immediately and hoists the slice; the detailed
// feed reads it back and draws the high-resolution version a beat later.
export function RefiningSlice<TData>({
  data,
  lagMs,
  coarse,
  detail,
}: {
  data: TData;
  lagMs: number;
  coarse: (data: TData) => React.ReactElement;
  detail: (data: TData) => React.ReactElement;
}) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setReady(true), lagMs);
    return () => clearTimeout(id);
  }, [lagMs]);
  return (
    <div style={{ flex: 'none', width: SLICE_WIDTH, height: HEIGHT }}>
      <CoordinatedLazy
        ready={ready}
        requireHoist
        fallback={<Hoist data={data}>{coarse(data)}</Hoist>}
        content={<Reveal render={detail} />}
      />
    </div>
  );
}
