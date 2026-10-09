import * as React from 'react';
import { compare, reactBenchmark } from '@mui/internal-benchmark/page';
import { AlphaSorted } from './sort.alpha';
import { BetaSorted } from './sort.beta';
import { OursSorted } from './sort.ours';

/**
 * Three sorts compared with each other rather than across builds — the shape a comparison between
 * libraries takes. This repository has no competitor libraries to install, so the "libraries" here
 * are three sorts with genuinely different constant factors. `ours` is the reference.
 */
compare('libs-sort', [
  reactBenchmark('ours', () => <OursSorted />),
  reactBenchmark('alpha', () => <AlphaSorted />),
  reactBenchmark('beta', () => <BetaSorted />),
]);
