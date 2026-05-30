'use client';

import * as React from 'react';
import type { LazyContentProps } from './types';
import { useSettleGate } from '../useCoordinated/useSettleGate';
import { pageSettleGate } from '../useCoordinated/pageSettleGate';

/**
 * Mounts once the lazily-imported component has loaded (it only renders past the
 * Suspense boundary after the import resolves), firing `onReady` so the swap can
 * report readiness to the gate.
 */
function LazyReady({
  onReady,
  children,
}: {
  onReady: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  React.useEffect(() => {
    onReady();
  }, [onReady]);
  return <React.Fragment>{children}</React.Fragment>;
}

/**
 * Lazily import a component, render it under a Suspense boundary, and report
 * readiness to the settle gate once it has loaded - so the page can coordinate
 * the swap and a `ChunksController` can reflect it in `loading`.
 *
 * The import factory is captured once (via lazy `useState`), so an inline
 * `content={() => import('./X')}` doesn't recreate the lazy component every
 * render. While the module loads, `fallback` (default `null`) is shown.
 */
export function LazyContent<T extends {} = {}>({
  content,
  props,
  fallback = null,
  gate,
}: LazyContentProps<T>): React.ReactElement {
  // Capture the factory once - React.lazy requires a stable factory, but
  // consumers pass an inline import thunk (new identity each render).
  const [Lazy] = React.useState(() => React.lazy(content));
  const [loaded, setLoaded] = React.useState(false);
  const handleReady = React.useCallback(() => setLoaded(true), []);

  // Pending until the module loads and mounts; report to the page-global gate
  // and, when given, an additional controller gate.
  useSettleGate(loaded, pageSettleGate);
  useSettleGate(loaded, gate ?? null);

  const componentProps = (props ?? {}) as T;
  return (
    <React.Suspense fallback={fallback}>
      <LazyReady onReady={handleReady}>
        <Lazy {...componentProps} />
      </LazyReady>
    </React.Suspense>
  );
}
