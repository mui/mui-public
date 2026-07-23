import type { BenchmarkReport, BenchmarkReportEntry } from './types';
import type { BenchmarkComparisonInput } from './compareBenchmarkReports';

/**
 * Shared entry builder. With `stats`, the entry carries the total-duration `stdDev`/`count` (and
 * per-render `count`) that route the comparison through Welch's t-test; without, it omits them for
 * the legacy relative-band fallback. Both variants share the render-array shape.
 */
function makeEntryCore(
  totalDuration: number,
  renderCount: number,
  stats: { stdDev: number; count: number } | null,
): BenchmarkReportEntry {
  const perRender = renderCount > 0 ? totalDuration / renderCount : 0;
  const stdDev = stats?.stdDev ?? 0;
  return {
    iterations: stats?.count ?? 10,
    totalDuration,
    ...(stats && { totalStdDev: stats.stdDev, totalCount: stats.count }),
    renders: Array.from({ length: renderCount }, (_, index) => ({
      id: `render-${index}`,
      phase: 'mount',
      startTime: 0,
      actualDuration: perRender,
      stdDev,
      rawMean: perRender,
      rawStdDev: stdDev,
      outliers: 0,
      ...(stats && { count: stats.count }),
    })),
    metrics: {},
  };
}

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
  return makeEntryCore(totalDuration, renderCount, { stdDev, count });
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
  return makeEntryCore(totalDuration, renderCount, null);
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
