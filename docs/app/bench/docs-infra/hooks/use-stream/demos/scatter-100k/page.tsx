'use client';
import * as React from 'react';
import { ScatterChart, generateScatterPoints } from '../scatterChart';

const points = generateScatterPoints(100_000);

export default function Page() {
  // @focus-start @padding 1
  return (
    <ScatterChart.Root points={points}>
      <ScatterChart.Chunk>{(point) => <ScatterChart.Point point={point} />}</ScatterChart.Chunk>
    </ScatterChart.Root>
  );
  // @focus-end
}
