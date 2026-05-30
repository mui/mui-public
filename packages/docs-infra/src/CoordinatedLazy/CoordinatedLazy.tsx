'use client';

import * as React from 'react';
import type { CoordinatedLazyProps } from './types';
import { useCoordinatedSwap } from './useCoordinatedSwap';
import { CoordinatedFallbackContext } from './CoordinatedFallbackContext';
import { CoordinatedContentContext } from './CoordinatedContentContext';

/**
 * Show `fallback` until `ready` (and the page-coordinated swap conditions) are
 * met, then swap to `content`. The fallback is force-mounted once so its
 * `useCoordinatedFallback` hoist runs even when the content is precomputed; the
 * hoisted data is handed down to `content` via `useCoordinatedContent`.
 *
 * Generalizes the state-driven fallback<->content swap from
 * `CodeHighlighterClient`. Advanced consumers that need to fold the hoisted data
 * into their own `ready` computation should use {@link useCoordinatedSwap}
 * directly instead of this component.
 */
export function CoordinatedLazy(props: CoordinatedLazyProps): React.ReactElement {
  const { content, fallback, ready, defer, skipFallback, requireHoist, gate, data, preload } =
    props;

  const { showFallback, fallbackContext, hoisted } = useCoordinatedSwap({
    ready,
    defer,
    hasFallback: fallback != null,
    skipFallback,
    requireHoist,
    gate,
    data,
    preload,
  });

  const contentContext = React.useMemo(() => ({ hoisted }), [hoisted]);

  if (showFallback) {
    return (
      <CoordinatedFallbackContext.Provider value={fallbackContext}>
        {fallback}
      </CoordinatedFallbackContext.Provider>
    );
  }

  return (
    <CoordinatedContentContext.Provider value={contentContext}>
      {content}
    </CoordinatedContentContext.Provider>
  );
}
