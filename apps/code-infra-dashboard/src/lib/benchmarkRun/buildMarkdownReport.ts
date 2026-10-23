import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  benchmarkTable,
  findRegressions,
  formatDuration,
  isImprovement,
  isRegression,
  runReportFootnote,
} from '@mui/internal-benchmark/runReport';
import type {
  BenchmarkAnalysis,
  BenchmarkRunReport,
  MetricComparison,
} from '@mui/internal-benchmark/runReport';

interface BuildOptions {
  /** The comment section's heading. */
  title: string;
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

/** How a comparison is flagged: 🔴 for a regression, 🟢 for an improvement, nothing otherwise. */
function markerOf(comparison: MetricComparison): string | null {
  if (isRegression(comparison)) {
    return '🔴';
  }
  return isImprovement(comparison) ? '🟢' : null;
}

function hasRegression({ metrics }: BenchmarkAnalysis): boolean {
  return metrics.some(({ comparisons }) => comparisons.some(isRegression));
}

/** A benchmark's table, keeping only the rows that regressed or improved. */
function changesTable(analysis: BenchmarkAnalysis): string | null {
  const { columns, rows } = benchmarkTable(analysis);
  const changed = rows
    .map((row) => ({ row, markers: row.comparisons.map(markerOf) }))
    .filter(({ markers }) => markers.some(Boolean));
  if (changed.length === 0) {
    return null;
  }
  return formatMarkdownTable(
    columns.map(({ header, kind }, column) => ({
      field: String(column),
      header,
      align: kind === 'value' ? ('right' as const) : ('left' as const),
    })),
    changed.map(({ row, markers }) =>
      Object.fromEntries(
        row.cells.map((cell, column) => {
          const { kind, comparison } = columns[column];
          if (kind !== 'comparison' || comparison === undefined) {
            return [String(column), cell];
          }
          const marker = markers[comparison];
          return [String(column), `${marker ? `${marker} ` : ''}\`${cell}\``];
        }),
      ),
    ),
  );
}

/**
 * Renders a version 2 benchmark report as its pull request comment section.
 *
 * The comment is there to draw attention to what changed, so a run where nothing did is a single
 * line. Each benchmark that regressed or improved gets a table of just the rows that did, the ones
 * with a regression first; informational metrics and comparisons between libraries stay on the
 * dashboard.
 */
export function buildBenchmarkRunMarkdownReport(
  report: BenchmarkRunReport,
  options: BuildOptions,
): string {
  const analyses = analyzeRun(report);
  const regressions = findRegressions(analyses);
  const failed = analyses.filter((analysis) => analysis.benchmark.error);
  const measured = analyses.length - failed.length;
  const benchmarks = `${measured} benchmark${measured === 1 ? '' : 's'}`;

  const summary = [
    regressions.length > 0
      ? `${regressions.length} regression${regressions.length === 1 ? '' : 's'} in ${benchmarks}`
      : `No regressions in ${benchmarks}`,
    report.durationMs === undefined ? null : `ran ${formatDuration(report.durationMs)}`,
    options.detailsUrl ? `[details](${options.detailsUrl})` : null,
  ].filter(Boolean);

  const attention = regressions.length > 0 || failed.length > 0;
  const lines = [`## ${options.title}${attention ? ' ⚠️' : ''}`, '', summary.join(' · ')];

  for (const { benchmark } of failed) {
    lines.push('', `❌ **${benchmark.name}**: ${benchmark.error}`);
  }

  const regressedFirst = [
    ...analyses.filter(hasRegression),
    ...analyses.filter((analysis) => !hasRegression(analysis)),
  ];
  const tables = regressedFirst.flatMap((analysis) => {
    const table = changesTable(analysis);
    return table ? [`**${analysis.benchmark.name}**\n\n${table}`] : [];
  });
  if (tables.length > 0) {
    lines.push('', tables.join('\n\n'), '', `_${runReportFootnote()}_`);
  }

  return lines.join('\n');
}
