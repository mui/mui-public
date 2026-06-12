'use client';

import * as React from 'react';
import type { UseCoordinatedFallbackResult } from './types';
import { CoordinatedFallbackContext } from './CoordinatedFallbackContext';

/**
 * Called by a fallback (loading) component to optionally hoist data the full
 * content will need and to signal that it mounted. Returns the parent->fallback
 * `data` and whether this fallback's `CoordinatedLazy` is nested inside an
 * outer, still-loading one. Generalizes `useCodeFallback`.
 *
 * Pass a memoized `hoistData` map; each entry is hoisted up to the swap, where
 * it is folded into the consumer's `ready` decision and handed down to the full
 * content via `useCoordinatedContent`.
 */
export function useCoordinatedFallback(
  hoistData?: Record<string, unknown>,
): UseCoordinatedFallbackResult {
  const ctx = React.useContext(CoordinatedFallbackContext);
  const { hoist, onReady } = ctx ?? {};

  // Signal the swap that the fallback's hook ran. Child effects fire before
  // parent effects, so this lands before the swap's validation (if any) runs.
  React.useEffect(() => {
    onReady?.();
  }, [onReady]);

  React.useEffect(() => {
    if (!hoist || !hoistData) {
      return;
    }
    for (const [key, value] of Object.entries(hoistData)) {
      hoist(key, value);
    }
  }, [hoist, hoistData]);

  return { data: ctx?.data, isNested: ctx?.isNested ?? false };
}
