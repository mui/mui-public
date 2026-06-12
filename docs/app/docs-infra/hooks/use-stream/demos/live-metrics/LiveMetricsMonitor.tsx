'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import { Replayable } from '@/components/Replayable/Replayable';
import {
  DETAIL_LAG_MS,
  HEIGHT,
  RefiningSlice,
  SLICE_WIDTH,
  SUBSAMPLES,
  ScrollFrame,
  TICK_MS,
  TOTAL,
  createTickSource,
  scrollOffset,
} from '../oscilloscope';

interface Point {
  x: number;
  y: number;
}

interface MetricsSlice {
  index: number;
  points: Point[];
}

const SAMPLE_COUNT = TOTAL * SUBSAMPLES;

// A latency-like signal: a slow swell with fine jitter the coarse feed can't see.
const metric = (globalIndex: number) => {
  const t = globalIndex / SAMPLE_COUNT;
  return 60 + 30 * Math.sin(t * Math.PI * 2 * 3) + 10 * Math.sin(t * Math.PI * 2 * 29);
};

// One slice spans `SUBSAMPLES` steps plus the shared boundary point, so adjacent
// columns' lines meet.
function buildSlice(index: number): MetricsSlice {
  const start = index * SUBSAMPLES;
  const points = Array.from({ length: SUBSAMPLES + 1 }, (_unused, sub) => {
    const globalIndex = start + sub;
    return { x: (sub / SUBSAMPLES) * SLICE_WIDTH, y: HEIGHT - metric(globalIndex) };
  });
  return { index, points };
}

const toPath = (points: Point[]) => points.map((point) => `${point.x},${point.y}`).join(' ');

// Coarse feed: just the slice's endpoints — a straight chord, the rollup's-eye view.
function CoarseLine({ slice }: { slice: MetricsSlice }) {
  const ends = [slice.points[0], slice.points[slice.points.length - 1]];
  return (
    <svg width={SLICE_WIDTH} height={HEIGHT} style={{ overflow: 'visible' }}>
      <polyline
        points={toPath(ends)}
        fill="none"
        stroke="#cdbef0"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
    </svg>
  );
}

// Detailed feed: every sub-sample, so the jitter shows.
function DetailLine({ slice }: { slice: MetricsSlice }) {
  return (
    <svg width={SLICE_WIDTH} height={HEIGHT} style={{ overflow: 'visible' }}>
      <polyline points={toPath(slice.points)} fill="none" stroke="#7c3aed" strokeWidth={2} />
    </svg>
  );
}

const ITEMS = Array.from({ length: TOTAL }, (_unused, index) => buildSlice(index));
const source = createTickSource(ITEMS, TICK_MS);

function LiveMetricsMonitorView() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useStream<MetricsSlice, void>({ source });

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ScrollFrame offset={scrollOffset(chunks.length)}>
          {chunks.map((slice) => (
            <RefiningSlice
              key={slice.index}
              data={slice}
              lagMs={DETAIL_LAG_MS}
              coarse={(data) => <CoarseLine slice={data} />}
              detail={(data) => <DetailLine slice={data} />}
            />
          ))}
        </ScrollFrame>
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading ? `live · ${chunks.length}/${TOTAL}` : `done — ${SAMPLE_COUNT} samples`}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}

export function LiveMetricsMonitor() {
  return (
    <Replayable>
      <LiveMetricsMonitorView />
    </Replayable>
  );
}
