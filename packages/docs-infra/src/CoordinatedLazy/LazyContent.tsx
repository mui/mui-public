'use client';

import * as React from 'react';
import type { LazyContentProps } from './types';
import { CoordinatedContentContext } from './CoordinatedContentContext';
import { useSettleGate } from '../useCoordinated/useSettleGate';
import { pageSettleGate } from '../useCoordinated/pageSettleGate';

/**
 * Lazily import a component and render it once its chunk has loaded, reporting
 * readiness to the settle gate - so the page can coordinate the swap and a
 * `ChunksController` can reflect it in `loading`.
 *
 * The import runs in an effect (not `React.lazy` + Suspense) on purpose: the swap
 * that reveals this content mounts/unmounts the subtree around a pending `import()`,
 * and a Suspense boundary that comes and goes around a pending promise trips React's
 * async-info-on-boundary tracking ("cleaning up async info that was not on the
 * parent Suspense boundary"). Loading in an effect avoids a Suspense boundary
 * entirely, and renders only the fallback during SSR (effects don't run there).
 *
 * The import factory is captured once (via lazy `useState`), so an inline
 * `content={() => import('./X')}` doesn't restart the import every render. While
 * the module loads, the explicit `fallback` (or, if none, the coordinating swap's
 * fallback from {@link CoordinatedContentContext}) is shown - so the same
 * placeholder keeps covering the load, with no empty flash.
 */
export function LazyContent<T extends {} = {}>({
  content,
  props,
  fallback = null,
  gate,
}: LazyContentProps<T>): React.ReactElement {
  // Capture the import thunk once - consumers pass an inline thunk (new identity
  // each render), and we must not restart the import on every render.
  const [importContent] = React.useState(() => content);
  const [Loaded, setLoaded] = React.useState<React.ComponentType<T> | null>(null);

  const coordinated = React.useContext(CoordinatedContentContext);
  const reportReady = coordinated.reportReady;

  React.useEffect(() => {
    let active = true;
    importContent()
      .then((mod) => {
        if (active) {
          // Function form: the stored value is itself a component (a function),
          // so a bare `setLoaded(mod.default)` would be treated as an updater.
          setLoaded(() => mod.default);
        }
      })
      .catch(() => {
        // Leave the fallback in place on a failed import (network error, missing
        // chunk); a parent error boundary can handle a hard failure if needed.
      });
    return () => {
      active = false;
    };
  }, [importContent]);

  // Signal the coordinating swap (and settle gate) that the content has loaded.
  const loaded = Loaded !== null;
  React.useEffect(() => {
    if (loaded) {
      reportReady?.();
    }
  }, [loaded, reportReady]);

  // Pending until the module loads; report to the page-global gate and, when
  // given, an additional controller gate.
  useSettleGate(loaded, pageSettleGate);
  useSettleGate(loaded, gate ?? null);

  if (Loaded) {
    const componentProps = (props ?? {}) as T;
    return <Loaded {...componentProps} />;
  }

  // While loading, show the explicit `fallback` prop if given, otherwise the
  // coordinating swap's fallback (e.g. CodeHighlighter's `ContentLoading`).
  return <React.Fragment>{fallback ?? coordinated.fallback ?? null}</React.Fragment>;
}
