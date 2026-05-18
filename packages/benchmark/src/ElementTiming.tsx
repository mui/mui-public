import * as React from 'react';

export function ElementTiming({ name }: { name: string }) {
  return (
    <span
      {...({ elementtiming: name } as React.HTMLAttributes<HTMLSpanElement>)}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        opacity: 0.01,
        pointerEvents: 'none',
        fontSize: 1,
      }}
    >
      &nbsp;
    </span>
  );
}
