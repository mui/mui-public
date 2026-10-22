import * as React from 'react';

/**
 * A fixed-size scroller around a list, with a header that re-renders on every scroll event — the
 * interaction the scroll benchmarks measure. Shared so every list implementation is scrolled the
 * same way.
 */
export function ScrollingList({ children }: { children: React.ReactNode }) {
  const [scrollTop, setScrollTop] = React.useState(0);
  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, width: 400, height: 300, overflow: 'auto' }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <p style={{ position: 'sticky', top: 0, margin: 0, background: 'white' }}>
        Scrolled {Math.round(scrollTop)}px
      </p>
      {children}
    </div>
  );
}
