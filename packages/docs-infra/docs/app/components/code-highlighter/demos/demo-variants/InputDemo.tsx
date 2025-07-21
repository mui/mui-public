'use client';

import * as React from 'react';

export default function InputDemo() {
  const [value, setValue] = React.useState('');

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '8px' }}>
        <label
          htmlFor="demo-input"
          style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}
        >
          Enter your name:
        </label>
        <input
          id="demo-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Type here..."
          style={{
            padding: '8px 12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px',
            width: '200px',
          }}
        />
      </div>
      {value && <p style={{ margin: 0, color: '#666' }}>Hello, {value}! 👋</p>}
    </div>
  );
}
