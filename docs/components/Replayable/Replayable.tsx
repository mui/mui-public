'use client';
import * as React from 'react';
import { DemoButton } from '@/components/DemoButton/DemoButton';

// Wraps a demo with a button that remounts it, so a hand-animated demo (whose
// local timers don't re-run on a data refresh) can be watched again from scratch.
export function Replayable({
  label = 'Replay',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [runId, setRunId] = React.useState(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
      <React.Fragment key={runId}>{children}</React.Fragment>
      <DemoButton onClick={() => setRunId((id) => id + 1)}>{label}</DemoButton>
    </div>
  );
}
