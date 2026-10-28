import type { BenchmarkReport, BenchmarkReportEntry } from './types';
import type { BenchmarkComparisonInput } from './compareBenchmarkReports';

export function makeEntry(totalDuration: number, renderCount: number = 1): BenchmarkReportEntry {
  const perRender = renderCount > 0 ? totalDuration / renderCount : 0;
  return {
    iterations: 10,
    totalDuration,
    renders: Array.from({ length: renderCount }, (_, index) => ({
      id: `render-${index}`,
      phase: 'mount',
      startTime: 0,
      actualDuration: perRender,
      stdDev: 0,
      rawMean: perRender,
      rawStdDev: 0,
      outliers: 0,
    })),
    metrics: {},
  };
}

export function makeReport(entries: Record<string, number>): BenchmarkComparisonInput {
  const report: BenchmarkReport = {};
  for (const [name, totalDuration] of Object.entries(entries)) {
    report[name] = makeEntry(totalDuration);
  }
  return { report };
}

export function makeReportFromConfig(
  entries: Record<string, { duration: number; renders: number }>,
): BenchmarkComparisonInput {
  const report: BenchmarkReport = {};
  for (const [name, { duration, renders }] of Object.entries(entries)) {
    report[name] = makeEntry(duration, renders);
  }
  return { report };
}
