'use client';
import * as React from 'react';
import { CoordinatedLazy, LazyContent } from '@mui/internal-docs-infra/CoordinatedLazy';
import { Replayable } from '@/components/Replayable/Replayable';

// Matches the widget's footprint so revealing it doesn't shift the layout.
function Skeleton() {
  return (
    <div
      style={{
        width: 280,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 8,
        border: '1px solid #d0cdd7',
        background: '#faf9fc',
      }}
    >
      {/* Each row matches the widget's row height (20 / 44 / 18) so revealing it
          doesn't shift the layout. */}
      <div style={{ height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '55%', height: 14, borderRadius: 4, background: '#e7e4ee' }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            style={{
              boxSizing: 'border-box',
              width: 44,
              height: 44,
              borderRadius: 8,
              background: '#e7e4ee',
            }}
          />
        ))}
      </div>
      <div style={{ height: 18, display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '40%', height: 12, borderRadius: 4, background: '#e7e4ee' }} />
      </div>
    </div>
  );
}

function LazyWidgetView() {
  // @focus-start @padding 1
  const [ready, setReady] = React.useState(false);

  // The swap shows the skeleton until `ready`, then reveals its `content`. That
  // content is a `LazyContent`, so its chunk is fetched only once the swap mounts
  // it: it keeps the *same* skeleton up (the coordinating fallback, so no explicit
  // `fallback` is needed) until the code lands, then reports readiness — and the
  // swap settles as one coordinated step rather than flashing an empty box.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <button
        type="button"
        onClick={() => setReady(true)}
        disabled={ready}
        style={{
          font: '13px sans-serif',
          padding: '6px 12px',
          borderRadius: 6,
          cursor: ready ? 'default' : 'pointer',
          border: '1px solid #7c3aed',
          background: ready ? '#f3eefe' : '#7c3aed',
          color: ready ? '#7c3aed' : '#fff',
        }}
      >
        {ready ? 'Widget loaded' : 'Load the widget'}
      </button>
      <CoordinatedLazy
        ready={ready}
        fallback={<Skeleton />}
        content={<LazyContent content={() => import('./HeavyWidget')} />}
      />
    </div>
  );
  // @focus-end
}

export function LazyWidget() {
  return (
    <Replayable label="Reset">
      <LazyWidgetView />
    </Replayable>
  );
}
