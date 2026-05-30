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
  const {
    content,
    fallback,
    ready,
    defer,
    holdGate,
    skipFallback,
    requireHoist,
    awaitContent,
    gate,
    data,
    preload,
  } = props;

  const { showFallback, fallbackContext, hoisted, reportContentReady } = useCoordinatedSwap({
    ready,
    defer,
    holdGate,
    hasFallback: fallback != null,
    skipFallback,
    requireHoist,
    awaitContent,
    gate,
    data,
    preload,
  });

  const contentContext = React.useMemo(
    () => ({ hoisted, reportReady: reportContentReady }),
    [hoisted, reportContentReady],
  );

  const contentNode = (
    <CoordinatedContentContext.Provider value={contentContext}>
      {content}
    </CoordinatedContentContext.Provider>
  );
  const fallbackNode = showFallback ? (
    <CoordinatedFallbackContext.Provider value={fallbackContext}>
      {fallback}
    </CoordinatedFallbackContext.Provider>
  ) : null;

  // awaitContent: mount the content behind the fallback so a code-split content
  // (e.g. `LazyContent`) loads in the background and reveals once it reports
  // ready. The content returns `null` until then, so only the fallback shows.
  if (awaitContent) {
    return (
      <React.Fragment>
        {fallbackNode}
        {contentNode}
      </React.Fragment>
    );
  }

  // Default: show the fallback OR the content (the content only mounts once the
  // swap commits to it).
  return showFallback ? (
    <CoordinatedFallbackContext.Provider value={fallbackContext}>
      {fallback}
    </CoordinatedFallbackContext.Provider>
  ) : (
    contentNode
  );
}
