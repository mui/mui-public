import * as React from 'react';
import { reactBenchmark } from '@mui/internal-benchmark/page';
import { reactMajor } from '@mui/internal-test-utils/env';
import { SMOKE_SAMPLING } from '../_shared/sampling';

/**
 * A deterministic CPU workload, sized per case.
 *
 * The point of this benchmark is not the number it produces — this repository ships build tooling,
 * not a browser library, so there is nothing here whose render time is worth tracking. It exists to
 * give `benchmark run` something real to drive end to end.
 *
 * It does import a workspace package (`@mui/internal-test-utils`) and put its value on screen. That
 * is the part that matters: under `benchmark run` every ref — the working tree included — resolves
 * it from a packed tarball, so both sides of a comparison resolve identically.
 */

/** A small linear congruential generator, so every sample does identical work. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

function Workload({ size }: { size: number }) {
  const random = createRandom(42);
  const values = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    values[index] = random();
  }
  values.sort();

  let checksum = 0;
  for (let index = 0; index < size; index += 1) {
    checksum += values[index] * index;
  }

  return (
    <p>
      size={size} checksum={checksum.toFixed(3)} react={reactMajor}
    </p>
  );
}

reactBenchmark('workload', () => <Workload size={50_000} />, SMOKE_SAMPLING);
reactBenchmark('workload-large', () => <Workload size={400_000} />, SMOKE_SAMPLING);
