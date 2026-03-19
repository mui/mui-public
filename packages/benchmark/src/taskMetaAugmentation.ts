/// <reference types="vitest" />

import type { RenderEvent } from './types';

declare module 'vitest' {
  interface TaskMeta {
    benchmarkName?: string;
    benchmarkIterations?: RenderEvent[][];
  }
}
