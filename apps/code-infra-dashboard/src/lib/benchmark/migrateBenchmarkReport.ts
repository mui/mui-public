import type { BenchmarkReport, BenchmarkReportEntry } from './types';

const LEGACY_PAINT_PREFIX = 'paint:';

/**
 * Renames legacy harness paint keys (`paint:default`, `paint:grid-header`) to the current
 * `bench:paint` scheme (`bench:paint`, `bench:paint#grid-header`). Idempotent: keys already in the
 * new scheme are untouched.
 */
function migrateMetricKey(key: string): string {
  if (!key.startsWith(LEGACY_PAINT_PREFIX)) {
    return key;
  }
  const identifier = key.slice(LEGACY_PAINT_PREFIX.length);
  return identifier === 'default' ? 'bench:paint' : `bench:paint#${identifier}`;
}

function migrateEntry(entry: BenchmarkReportEntry): BenchmarkReportEntry {
  return {
    ...entry,
    metrics: Object.fromEntries(
      Object.entries(entry.metrics).map(([key, stats]) => [migrateMetricKey(key), stats]),
    ),
  };
}

/**
 * Applies forward migrations to a benchmark report fetched from S3 so older uploads read with the
 * current shape. Centralizes legacy normalization — add future migrations here.
 */
export function migrateBenchmarkReport(report: BenchmarkReport): BenchmarkReport {
  return Object.fromEntries(
    Object.entries(report).map(([name, entry]) => [name, migrateEntry(entry)]),
  );
}
