'use client';
import * as React from 'react';
import { useStream } from '@mui/internal-docs-infra/useStream';
import { Replayable } from '@/components/Replayable/Replayable';
import { CHARTS, ChartCard, SETTLE_MS, TOTAL, source } from './barChart';
import type { Bar } from './barChart';

function StreamingBarsView() {
  // @focus-start @padding 1
  const { chunks, Controller, streamComplete } = useStream<Bar, void>({ source });

  // Hold every swap in its loading state until the whole list has streamed in,
  // then flip one shared flag a beat later (so the last bar finishes growing) —
  // all the error bars reveal together rather than as a cascade.
  const [reveal, setReveal] = React.useState(false);
  React.useEffect(() => {
    if (!streamComplete) {
      return undefined;
    }
    const id = setTimeout(() => setReveal(true), SETTLE_MS);
    return () => clearTimeout(id);
  }, [streamComplete]);

  return (
    <Controller>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {CHARTS.map((chart) => (
            <ChartCard key={chart.title} chart={chart} arrived={chunks.length} ready={reveal} />
          ))}
        </div>
        <div style={{ font: '13px monospace', color: reveal ? '#3f8f3f' : '#7c3aed' }}>
          {reveal
            ? `done — ${TOTAL} bars across ${CHARTS.length} charts · hover for value ± error`
            : `streaming… ${chunks.length}/${TOTAL}`}
        </div>
      </div>
    </Controller>
  );
  // @focus-end
}

export function StreamingBars() {
  return (
    <Replayable>
      <StreamingBarsView />
    </Replayable>
  );
}
