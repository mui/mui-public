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

/**
 * How precisely the run pinned its changes down: the median and the widest half-width of the
 * intervals of the comparisons that can alarm, on scalar metrics, as fractions. A run that reports
 * no regression could still have missed a change of that size; `null` without such a comparison.
 */
function runPrecision(analyses: BenchmarkAnalysis[]): { median: number; widest: number } | null {
  const precisions = analyses
    .flatMap(({ metrics }) => metrics)
    .filter(({ definition }) => definition.kind === 'scalar')
    .flatMap(({ comparisons }) => comparisons)
    .filter(({ alarm }) => alarm !== null)
    .map(({ precision }) => precision)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (precisions.length === 0) {
    return null;
  }
  const middle = Math.floor(precisions.length / 2);
  const median =
    precisions.length % 2 === 1
      ? precisions[middle]
      : (precisions[middle - 1] + precisions[middle]) / 2;
  return { median, widest: precisions[precisions.length - 1] };
}

function formatPrecisionPercent(precision: number): string {
  return `±${(precision * 100).toFixed(1)}%`;
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
  const precision = runPrecision(analyses);

  const summary = [
    regressions.length > 0
      ? `${regressions.length} regression${regressions.length === 1 ? '' : 's'} in ${benchmarks}`
      : `No regressions in ${benchmarks}`,
    // What a "no regressions" is worth: a change smaller than this could have gone unseen.
    precision === null
      ? null
      : `precise to ${formatPrecisionPercent(precision.median)} (${formatPrecisionPercent(precision.widest)} at worst)`,
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
