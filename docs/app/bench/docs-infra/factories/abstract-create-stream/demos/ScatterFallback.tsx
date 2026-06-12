'use client';

import * as React from 'react';
import { useCoordinatedFallback } from '@mui/internal-docs-infra/CoordinatedLazy';
import type { Cluster } from './scatterConstants';
import { CoarseOverlay, ScatterFrame, StatusIndicator } from './scatterParts';

// The `CoordinatedLazy` fallback: render the coarse clusters (so they're in the
// SSR HTML) and hoist them up the swap, so the content can read exactly these
// clusters via `useCoordinatedContent` — a seamless fallback→content swap.
export function ScatterFallback({ clusters }: { clusters: Cluster[] }) {
  // @focus-start @padding 1
  const hoistData = React.useMemo(() => ({ clusters }), [clusters]);
  useCoordinatedFallback(hoistData);

  return (
    <ScatterFrame>
      <CoarseOverlay clusters={clusters} />
      <StatusIndicator done={false} label="rendering…" />
    </ScatterFrame>
  );
  // @focus-end
}
