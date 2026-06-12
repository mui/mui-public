'use client';

import * as React from 'react';
import { PreloadContext, type PreloadFn } from './PreloadContext';

/**
 * Scopes a cross-instance preload cache (typically at a layout). Descendants
 * call `usePreload` to start dynamic imports of shared helpers keyed by a
 * stable string; the first call per key runs the factory and every other
 * instance reuses its promise - so a helper a chunk's data implies (a transform
 * fn, say) is fetched once, in parallel with the content, across the page.
 */
export function PreloadProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  // One cache per provider instance, stable across renders.
  const [cache] = React.useState(() => new Map<string, Promise<unknown>>());

  const preload = React.useCallback<PreloadFn>(
    (key, factory) => {
      const existing = cache.get(key);
      if (existing) {
        // Same key -> same factory type by contract; the consumer owns the keying.
        return existing as ReturnType<typeof factory>;
      }
      const promise = factory();
      cache.set(key, promise);
      return promise;
    },
    [cache],
  );

  return <PreloadContext.Provider value={preload}>{children}</PreloadContext.Provider>;
}
