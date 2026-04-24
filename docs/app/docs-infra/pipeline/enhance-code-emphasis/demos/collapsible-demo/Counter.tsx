'use client';

import * as React from 'react';

export function Counter() {
  // @focus-start @padding 1
  const [count, setCount] = React.useState(0);

  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      Count: {count} {/* @highlight */}
    </button>
  );
  // @focus-end
}
