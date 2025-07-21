'use client';

import * as React from 'react';

export default function ButtonDemo() {
  const [count, setCount] = React.useState(0);

  return (
    <div style={{ padding: '16px' }}>
      <button
        onClick={() => setCount(count + 1)}
        style={{
          backgroundColor: '#1976d2',
          color: 'white',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        Clicked {count} times
      </button>
    </div>
  );
}
