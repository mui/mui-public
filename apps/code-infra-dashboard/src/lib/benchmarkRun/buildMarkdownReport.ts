import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  benchmarkTable,
  findRegressions,
  formatRounds,
  formatComparison,
  formatRunSummary,
  runReportFootnote,
} from '@mui/internal-benchmark/runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '@mui/internal-benchmark/runReport';

interface BuildOptions {
  /** The comment section's heading. */
  title: string;
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

/** One table per benchmark: every metric, the median of every variant, every comparison. */
function renderBenchmarkTable(analysis: BenchmarkAnalysis): string {
  const { columns, rows } = benchmarkTable(analysis);
  const table = formatMarkdownTable(
    columns.map(({ header, kind }, column) => ({
      field: String(column),
      header,
      align: kind === 'value' ? ('right' as const) : ('left' as const),
    })),
    rows.map(({ cells }) =>
      Object.fromEntries(
        cells.map((cell, column) => [
          String(column),
          columns[column].kind === 'comparison' ? `\`${cell}\`` : cell,
        ]),
      ),
    ),
  );
  return `**${analysis.benchmark.name}** · ${formatRounds(analysis.benchmark)}\n\n${table}`;
}

/**
 * Renders a version 2 benchmark report as its pull request comment section.
 *
 * Regressions are stated above the collapsed block, and mark the heading, because a reader has to
 * see them without expanding anything — GitHub renders `<details>` closed, so anything inside it is
 * invisible until someone chooses to look.
 */
export function buildBenchmarkRunMarkdownReport(
  report: BenchmarkRunReport,
  options: BuildOptions,
): string {
  const analyses = analyzeRun(report);
  const regressions = findRegressions(analyses);
  const measured = analyses.filter((analysis) => !analysis.benchmark.error);
  const failed = analyses.filter((analysis) => analysis.benchmark.error);

  const lines = [`## ${options.title}${regressions.length > 0 ? ' ⚠️' : ''}`, ''];

  for (const { benchmark, metric, comparison } of regressions) {
    const marker = comparison.severity === 'error' ? '🔴' : '🟡';
    lines.push(`${marker} **${benchmark}** · ${metric} · \`${formatComparison(comparison)}\``);
  }
  if (regressions.length > 0) {
    lines.push('');
  }

  lines.push(formatRunSummary(analyses, regressions), '');

  for (const { benchmark } of failed) {
    lines.push(`❌ **${benchmark.name}**: ${benchmark.error}`);
  }
  if (failed.length > 0) {
    lines.push('');
  }

  if (measured.length > 0) {
    lines.push('<details>', '<summary>Full results</summary>', '');
    lines.push(measured.map(renderBenchmarkTable).join('\n\n'));
    lines.push('', `_${runReportFootnote(analyses)}_`, '', '</details>');
  }

  if (options.detailsUrl) {
    lines.push('', `[See the full run](${options.detailsUrl})`);
  }

  return lines.join('\n');
}
