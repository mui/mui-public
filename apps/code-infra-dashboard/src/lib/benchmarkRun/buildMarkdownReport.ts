import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  benchmarkTable,
  findImprovements,
  findRegressions,
  formatComparison,
  formatDuration,
  runReportFootnote,
} from '@mui/internal-benchmark/runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '@mui/internal-benchmark/runReport';

interface BuildOptions {
  /** The comment section's heading. */
  title: string;
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

/**
 * A benchmark's table, keeping only the rows that regressed. A `baseline` benchmark compares one
 * pair, so each kept row's comparison is the regression.
 */
function regressionTable(analysis: BenchmarkAnalysis): string | null {
  const { columns, rows } = benchmarkTable(analysis);
  const regressed = rows.filter((row) =>
    row.comparisons.some((comparison) => comparison.severity === 'error'),
  );
  if (regressed.length === 0) {
    return null;
  }
  return formatMarkdownTable(
    columns.map(({ header, kind }, column) => ({
      field: String(column),
      header,
      align: kind === 'value' ? ('right' as const) : ('left' as const),
    })),
    regressed.map((row) =>
      Object.fromEntries(
        row.cells.map((cell, column) => [
          String(column),
          columns[column].kind === 'comparison' ? `🔴 \`${cell}\`` : cell,
        ]),
      ),
    ),
  );
}

/**
 * Renders a version 2 benchmark report as its pull request comment section.
 *
 * The comment is there to draw attention when something needs it, so a run without regressions or
 * failures is a single line. Only regressions get a table, and only of the rows that regressed;
 * informational metrics and comparisons between libraries stay on the dashboard.
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
    ...findImprovements(analyses).map(
      ({ benchmark, metric, comparison }) =>
        `**${benchmark}** ${metric} \`${formatComparison(comparison)}\``,
    ),
    report.durationMs === undefined ? null : `ran ${formatDuration(report.durationMs)}`,
    options.detailsUrl ? `[details](${options.detailsUrl})` : null,
  ].filter(Boolean);

  const attention = regressions.length > 0 || failed.length > 0;
  const lines = [`## ${options.title}${attention ? ' ⚠️' : ''}`, '', summary.join(' · ')];

  for (const { benchmark } of failed) {
    lines.push('', `❌ **${benchmark.name}**: ${benchmark.error}`);
  }

  const tables = analyses.flatMap((analysis) => {
    const table = regressionTable(analysis);
    return table ? [`**${analysis.benchmark.name}**\n\n${table}`] : [];
  });
  if (tables.length > 0) {
    lines.push('', tables.join('\n\n'), '', `_${runReportFootnote()}_`);
  }

  return lines.join('\n');
}
