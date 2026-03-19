export interface RenderEvent {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  /** Start time in milliseconds (from performance.now()) */
  startTime: number;
}

export interface BenchmarkReport {
  iterations: number;
  totalDuration: number;
  renders: Array<{ actualDuration: number; startTime: number }>;
}

export interface AggregatedResults {
  commitSha: string | null;
  timestamp: number;
  benchmarks: Record<string, BenchmarkReport>;
}
