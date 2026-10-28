'use client';
import * as React from 'react';
import {
  CoordinatedLazy,
  useCoordinatedContent,
  useCoordinatedFallback,
} from '@mui/internal-docs-infra/CoordinatedLazy';
import type { StreamSource } from '@mui/internal-docs-infra/useStream';

// One bar of one chart: the fallback paints (and hoists) `value`; `error`/`n` —
// "the rest" — reach only the content, where they become the interactive error bar.
// `streamIndex` is the bar's position in the stream (it grows in once that many
// chunks have arrived).
export interface Bar {
  chart: number;
  slot: number;
  streamIndex: number;
  label: string;
  value: number;
  error: number;
  n: number;
}

export interface Chart {
  title: string;
  bars: Bar[];
}

// Four generic charts of three series each, with static, deterministic values —
// no `Math.random` / `Date.now`, so the render matches on the server and the
// client (no hydration mismatch).
const CHART_TITLES = ['Alpha', 'Beta', 'Gamma', 'Delta'];
const SERIES = ['x', 'y', 'z'];
const MATRIX: { value: number; error: number; n: number }[][] = [
  [
    { value: 72, error: 6, n: 240 },
    { value: 48, error: 9, n: 120 },
    { value: 63, error: 5, n: 300 },
  ],
  [
    { value: 58, error: 11, n: 95 },
    { value: 81, error: 7, n: 210 },
    { value: 39, error: 8, n: 140 },
  ],
  [
    { value: 84, error: 5, n: 310 },
    { value: 66, error: 10, n: 160 },
    { value: 52, error: 6, n: 190 },
  ],
  [
    { value: 63, error: 9, n: 150 },
    { value: 75, error: 4, n: 260 },
    { value: 44, error: 12, n: 80 },
  ],
];

// Stream order is slot-major (every chart's first bar, then every chart's second,
// …) so the four charts fill in evenly, column by column, rather than one whole
// chart at a time.
export const CHARTS: Chart[] = CHART_TITLES.map((title, chart) => ({
  title,
  bars: MATRIX[chart].map((cell, slot) => ({
    chart,
    slot,
    streamIndex: slot * CHART_TITLES.length + chart,
    label: SERIES[slot],
    value: cell.value,
    error: cell.error,
    n: cell.n,
  })),
}));

export const BARS: Bar[] = CHARTS.flatMap((chart) => chart.bars).sort(
  (left, right) => left.streamIndex - right.streamIndex,
);
export const TOTAL = BARS.length;

export const TICK_MS = 260; // one bar per tick
export const SETTLE_MS = 380; // beat after the last bar before the unison reveal

const MAX = 100; // axis ceiling, leaves headroom above the tallest bar + cap
const PLOT_H = 90;
const BAR_W = 16;
const BAR_GAP = 9;
const CHART_PLOT_W = SERIES.length * BAR_W + (SERIES.length + 1) * BAR_GAP;
const FRAME_W = CHART_PLOT_W + 16; // 8px padding either side
const FRAME_H = 132;
const CX = BAR_W / 2; // bar centre within its own column box
const CAP_HALF = 6; // half-width of an error cap, kept inside the bar column

// The left offset of a bar's column box within the chart's plot region.
const slotLeft = (slot: number) => BAR_GAP + slot * (BAR_W + BAR_GAP);

const COLORS = {
  bar: '#7c3aed',
  barLoading: '#cdbef0',
  barHover: '#5b2bb3',
  cap: '#4c2889',
  axis: '#d0cdd7',
  frameBg: '#faf9fc',
  label: '#555',
  tooltipBg: '#241b3a',
};

// Pixels from the plot floor for a value (clamped so a low bound never goes negative).
const heightFor = (value: number) => (Math.max(0, value) / MAX) * PLOT_H;

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(id), { once: true });
  });

// A stream source that pushes one bar per tick and yields, so `useStream` reveals
// them one at a time — the cadence the grow animations sync to.
export const source: StreamSource<Bar, void> = {
  mode: 'stream',
  async *stream(chunks, _options, signal) {
    for (const bar of BARS) {
      // eslint-disable-next-line no-await-in-loop -- one bar per tick is the point of the demo
      await delay(TICK_MS, signal);
      if (signal.aborted) {
        return;
      }
      chunks.push(bar);
      yield;
    }
  },
};

// The titled chart frame all bars of one chart share, so the swaps never shift
// layout. The plot region keeps a fixed size even before its bars stream in.
function ChartFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: FRAME_W,
        height: FRAME_H,
        padding: 8,
        boxSizing: 'border-box',
        border: `1px solid ${COLORS.axis}`,
        borderRadius: 8,
        background: COLORS.frameBg,
      }}
    >
      <div style={{ position: 'relative', width: CHART_PLOT_W, height: PLOT_H }}>{children}</div>
      <div
        style={{
          marginTop: 6,
          height: 16,
          lineHeight: '16px',
          font: '12px monospace',
          color: COLORS.label,
        }}
      >
        {title}
      </div>
    </div>
  );
}

// Single presentational column with a `loading` prop (rule 7.12): loading paints a
// pale bar that grows scaleY 0→1; the full state paints the solid bar at the same
// geometry (no re-grow) plus the error cap, which fades in, and a hover tooltip.
// Positioned within its BAR_W-wide column box.
function BarColumn({
  value,
  error,
  n,
  loading,
}: {
  value: number;
  error?: number;
  n?: number;
  loading: boolean;
}) {
  const [mounted, setMounted] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  React.useEffect(() => {
    const handle = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(handle);
  }, []);

  const showCaps = !loading && error !== undefined;
  // Loading grows from zero on mount; the full bar is already at height.
  const scaleY = !loading || mounted ? 1 : 0;
  const barColor = loading ? COLORS.barLoading : (hovered && COLORS.barHover) || COLORS.bar;

  const yUpper = PLOT_H - heightFor(value + (error ?? 0));
  const yLower = PLOT_H - heightFor(value - (error ?? 0));

  return (
    <React.Fragment>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: BAR_W,
          height: heightFor(value),
          background: barColor,
          borderRadius: '3px 3px 0 0',
          transformOrigin: 'bottom',
          transform: `scaleY(${scaleY})`,
          transition: 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1), background 150ms ease-out',
        }}
      />

      {showCaps ? (
        <svg
          width={BAR_W}
          height={PLOT_H}
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'visible',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 350ms ease-out',
            pointerEvents: 'none',
          }}
        >
          <line x1={CX} y1={yUpper} x2={CX} y2={yLower} stroke={COLORS.cap} strokeWidth={2} />
          <line
            x1={CX - CAP_HALF}
            y1={yUpper}
            x2={CX + CAP_HALF}
            y2={yUpper}
            stroke={COLORS.cap}
            strokeWidth={2}
          />
          <line
            x1={CX - CAP_HALF}
            y1={yLower}
            x2={CX + CAP_HALF}
            y2={yLower}
            stroke={COLORS.cap}
            strokeWidth={2}
          />
        </svg>
      ) : null}

      {showCaps && hovered ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: heightFor(value + (error ?? 0)) + 10,
            transform: 'translateX(-50%)',
            padding: '4px 6px',
            borderRadius: 4,
            font: '11px monospace',
            whiteSpace: 'nowrap',
            color: '#fff',
            background: COLORS.tooltipBg,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {value} ± {error} · n={n}
        </div>
      ) : null}

      {/* Transparent hit layer so the bar and its cap are hoverable as one column. */}
      {showCaps ? (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
        />
      ) : null}
    </React.Fragment>
  );
}

// Loading: paint the pale growing bar and hoist its value — the cheap layer the
// content reuses.
function BarFallback({ value }: { value: number }) {
  useCoordinatedFallback(React.useMemo(() => ({ value }), [value]));
  return <BarColumn value={value} loading />;
}

// Full content: reuse the hoisted value (no re-pass) and draw the error cap from
// the `error`/`n` that reached only here.
function BarContent({ error, n }: { error: number; n: number }) {
  const { value } = useCoordinatedContent() as { value: number };
  return <BarColumn value={value} error={error} n={n} loading={false} />;
}

// One chart of several bars. The frame is always present (stable 4-up layout); each
// bar's coordinated swap only mounts once that bar has streamed in. Every bar shares
// the same `ready`, so the swap to error bars lands for all of them in one commit.
export function ChartCard({
  chart,
  arrived,
  ready,
}: {
  chart: Chart;
  arrived: number;
  ready: boolean;
}) {
  return (
    <ChartFrame title={chart.title}>
      {chart.bars.map((bar) => (
        <div
          key={bar.slot}
          style={{
            position: 'absolute',
            left: slotLeft(bar.slot),
            bottom: 0,
            width: BAR_W,
            height: PLOT_H,
          }}
        >
          {bar.streamIndex < arrived ? (
            <CoordinatedLazy
              ready={ready}
              requireHoist
              fallback={<BarFallback value={bar.value} />}
              content={<BarContent error={bar.error} n={bar.n} />}
            />
          ) : null}
        </div>
      ))}
    </ChartFrame>
  );
}
