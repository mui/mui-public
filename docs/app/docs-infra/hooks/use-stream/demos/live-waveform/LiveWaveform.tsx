'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import {
  DETAIL_LAG_MS,
  HEIGHT,
  RefiningSlice,
  SLICE_WIDTH,
  SUBSAMPLES,
  ScrollFrame,
  TICK_MS,
  createTickSource,
  scrollOffset,
} from '../oscilloscope';

interface WaveSlice {
  index: number;
  samples: number[];
}

// The stream just runs until the generator returns — the consumer never declares
// a count, so this stands in for an open-ended recording.
const SLICE_COUNT = 44;
const SAMPLE_COUNT = SLICE_COUNT * SUBSAMPLES;
const CENTER = HEIGHT / 2;
const SCALE = HEIGHT / 2 - 8;

// A carrier under a slowly swelling amplitude envelope, so the peak heights vary.
const sample = (globalIndex: number) => {
  const t = globalIndex / SAMPLE_COUNT;
  const envelope = 0.32 + 0.52 * Math.abs(Math.sin(t * Math.PI * 2 * 1.3));
  return envelope * Math.sin(t * Math.PI * 2 * 33);
};

function buildSlice(index: number): WaveSlice {
  const start = index * SUBSAMPLES;
  const samples = Array.from({ length: SUBSAMPLES }, (_unused, sub) => sample(start + sub));
  return { index, samples };
}

// Coarse feed: one min/max peak bar for the whole slice — the instant envelope.
function Envelope({ slice }: { slice: WaveSlice }) {
  const peak = Math.max(...slice.samples.map((value) => Math.abs(value)));
  return (
    <svg width={SLICE_WIDTH} height={HEIGHT}>
      <rect
        x={4}
        width={SLICE_WIDTH - 8}
        y={CENTER - peak * SCALE}
        height={Math.max(peak * SCALE * 2, 1)}
        rx={2}
        fill="#cdbef0"
      />
    </svg>
  );
}

// Detailed feed: a mirrored bar per sample — the decoded waveform.
function Waveform({ slice }: { slice: WaveSlice }) {
  return (
    <svg width={SLICE_WIDTH} height={HEIGHT}>
      {slice.samples.map((value, sampleIndex) => {
        const x = ((sampleIndex + 0.5) / SUBSAMPLES) * SLICE_WIDTH;
        const amplitude = Math.abs(value) * SCALE;
        return (
          <line
            key={sampleIndex}
            x1={x}
            x2={x}
            y1={CENTER - amplitude}
            y2={CENTER + amplitude}
            stroke="#7c3aed"
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

const ITEMS = Array.from({ length: SLICE_COUNT }, (_unused, index) => buildSlice(index));
const source = createTickSource(ITEMS, TICK_MS);

export function LiveWaveform() {
  // @focus-start @padding 1
  const { chunks, Controller, loading } = useStream<WaveSlice, void>({ source });

  // No total: the count is unknown up front, so the caption only reports what has
  // arrived. Older slices scroll off the left as the recording grows.
  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ScrollFrame offset={scrollOffset(chunks.length)}>
          {chunks.map((slice) => (
            <RefiningSlice
              key={slice.index}
              data={slice}
              lagMs={DETAIL_LAG_MS}
              coarse={(data) => <Envelope slice={data} />}
              detail={(data) => <Waveform slice={data} />}
            />
          ))}
        </ScrollFrame>
        <div style={{ font: '13px monospace', color: loading ? '#7c3aed' : '#3f8f3f' }}>
          {loading ? `recording · ${chunks.length} slices` : `stopped — ${chunks.length} slices`}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}
