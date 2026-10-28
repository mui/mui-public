'use client';
import * as React from 'react';

const REACTIONS = ['👍', '🎉', '🚀'];

// A small interactive client component standing in for a heavier widget you would
// rather keep out of the initial bundle. Default-exported so it can be pulled in
// on demand with `() => import('./HeavyWidget')`.
export default function HeavyWidget() {
  // @focus-start @padding 1
  const [picked, setPicked] = React.useState<string | null>(null);
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
        background: '#fff',
      }}
    >
      <div style={{ font: '600 14px/20px sans-serif', color: '#2c2838' }}>How was this page?</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            onClick={() => setPicked(reaction)}
            style={{
              boxSizing: 'border-box',
              width: 44,
              height: 44,
              fontSize: 20,
              cursor: 'pointer',
              borderRadius: 8,
              border: picked === reaction ? '2px solid #7c3aed' : '1px solid #d0cdd7',
              background: picked === reaction ? '#f3eefe' : '#faf9fc',
            }}
          >
            {reaction}
          </button>
        ))}
      </div>
      <div style={{ font: '13px/18px monospace', color: '#3f8f3f' }}>
        {picked ? `thanks for the ${picked}` : 'loaded on demand'}
      </div>
    </div>
  );
  // @focus-end
}
