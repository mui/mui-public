'use client';

import * as React from 'react';

export default function CheckboxDemo() {
  const [checked, setChecked] = React.useState(false);

  return (
    <div style={{ padding: '16px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          style={{ margin: 0 }}
        />
        <span>Accept terms and conditions {checked ? '✓' : ''}</span>
      </label>
    </div>
  );
}
