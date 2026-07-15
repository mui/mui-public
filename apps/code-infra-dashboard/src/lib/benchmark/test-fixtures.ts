import type { BenchmarkReport, BenchmarkReportEntry } from './types';
import type { BenchmarkComparisonInput } from './compareBenchmarkReports';

/**
 * A benchmark entry carrying the total-duration `stdDev` + sample `count` that real uploads now
 * produce, so the comparison runs a Welch's t-test. This is the default shape for fixtures; use
 * {@link makeEntry} only to exercise the legacy fallback for uploads made before sample counts
 * existed.
 */
export function makeStatEntry(
  totalDuration: number,
  stdDev: number,
  count: number,
  renderCount: number = 1,
): BenchmarkReportEntry {
  const perRender = renderCount > 0 ? totalDuration / renderCount : 0;
  return {
    iterations: count,
    totalDuration,
    totalStdDev: stdDev,
    totalCount: count,
    renders: Array.from({ length: renderCount }, (_, index) => ({
      id: `render-${index}`,
      phase: 'mount',
      startTime: 0,
      actualDuration: perRender,
      stdDev,
      rawMean: perRender,
      rawStdDev: stdDev,
      outliers: 0,
      count,
    })),
    metrics: {},
  };
}

/** Multi-benchmark statistical report; every entry shares the same `stdDev`/`count` profile. */
export function makeStatReport(
  entries: Record<string, number>,
  stdDev: number,
  count: number,
): BenchmarkComparisonInput {
  const report: BenchmarkReport = {};
  for (const [name, totalDuration] of Object.entries(entries)) {
    report[name] = makeStatEntry(totalDuration, stdDev, count);
  }
  return { report };
}

/** Single-benchmark statistical report (named `Bench`), the common case for gating tests. */
export function statReport(mean: number, stdDev: number, count: number): BenchmarkComparisonInput {
  return makeStatReport({ Bench: mean }, stdDev, count);
}

/**
 * A legacy benchmark entry with no `totalStdDev`/`totalCount` (and zero-variance renders), as
 * produced by uploads made before sample counts existed. Routes the comparison onto the legacy
 * relative-noise-band fallback. Prefer {@link makeStatEntry} unless a test specifically covers that
 * backwards-compatible path.
 */
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
