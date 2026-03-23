/**
 * Shared performance tracking utilities for use in both main thread and worker
 */

export interface PerformanceLog {
  type: 'mark' | 'measure';
  name: string;
  startTime: number;
  duration?: number;
}

export class PerformanceTracker {
  private logs: PerformanceLog[] = [];

  private baseTime: number;

  constructor() {
    this.baseTime = performance.now();
  }

  mark(name: string): number {
    const time = performance.now();
    this.logs.push({
      type: 'mark',
      name,
      startTime: time - this.baseTime,
    });
    return time;
  }

  measure(name: string, startTime: number, endTime: number): void {
    this.logs.push({
      type: 'measure',
      name,
      startTime: startTime - this.baseTime,
      duration: endTime - startTime,
    });
  }

  getLogs(): PerformanceLog[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }
}

/**
 * Reconstruct performance measures in the main thread from worker logs
 */
export function reconstructPerformanceLogs(logs: PerformanceLog[], timeOffset: number): void {
  logs.forEach((log) => {
    if (log.type === 'measure' && log.duration !== undefined) {
      performance.measure(log.name, {
        start: timeOffset + log.startTime,
        duration: log.duration,
      });
    }
  });
}
