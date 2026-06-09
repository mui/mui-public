import * as React from 'react';
import { CoordinatedLazy } from '@mui/internal-docs-infra/CoordinatedLazy';
import { computeCoarse, computeDetail } from '../scatterData';
import { ScatterFallback } from '../ScatterFallback';
import { ScatterDetail } from '../ScatterDetail';

const TOTAL = 50_000;

// Server-only (dynamically imported by the factory `Loader`): the scatter is
// computed here, on the server. The coarse + detail cross to the client as data
// (never functions). `CoordinatedLazy` runs the hoist swap — the fallback hoists
// the coarse, the content reads it and reveals the detail all at once.
export default function ScatterChart() {
  // @focus-start @padding 1
  const coarse = computeCoarse(TOTAL);
  const detail = computeDetail(TOTAL);
  return (
    <CoordinatedLazy
      ready
      requireHoist
      fallback={<ScatterFallback clusters={coarse} />}
      content={<ScatterDetail chunks={detail} />}
    />
  );
  // @focus-end
}
