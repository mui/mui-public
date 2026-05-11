/// <reference types="vitest" />

import type { IterationData } from './types';

declare module 'vitest' {
  interface TaskMeta {
    benchmarkName?: string;
    benchmarkIterations?: IterationData[];
  }
}
