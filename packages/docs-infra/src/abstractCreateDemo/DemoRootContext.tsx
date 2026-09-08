'use client';

import * as React from 'react';

export const DemoRootContext = React.createContext<React.RefObject<HTMLDivElement | null> | null>(
  null,
);

/** Provides the rendered demo root to client descendants. */
export function DemoRootProvider(props: { children: React.ReactNode }) {
  const rootRef = React.useRef<HTMLDivElement>(null);

  return (
    <DemoRootContext.Provider value={rootRef}>
      <div ref={rootRef} className="demo">
        {props.children}
      </div>
    </DemoRootContext.Provider>
  );
}
