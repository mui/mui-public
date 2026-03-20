export interface RenderEvent {
  id: string;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
  /** Start time in milliseconds (from performance.now()) */
  startTime: number;
}

export interface RenderStats {
  id: string;
  phase: RenderEvent['phase'];
  startTime: number;
  actualDuration: number;
  stdDev: number;
  rawMean: number;
  rawStdDev: number;
  outliers: number;
}

export interface BenchmarkReport {
  iterations: number;
  totalDuration: number;
  renders: RenderStats[];
}

export interface BenchmarkUpload {
  version: number;
  commitSha: string;
  repo: string;
  reportType: 'benchmark';
  timestamp: number;
  prNumber?: number;
  branch: string;
  report: Record<string, BenchmarkReport>;
}
