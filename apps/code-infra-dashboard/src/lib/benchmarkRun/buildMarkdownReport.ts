import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  findRegressions,
  formatComparison,
  formatComparisonLabel,
  formatRunSummary,
  formatValue,
  RUN_REPORT_FOOTNOTE,
} from '@mui/internal-benchmark/runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '@mui/internal-benchmark/runReport';

interface BuildOptions {
  /** The comment section's heading. */
  title: string;
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

/** One table per benchmark: every metric, the median of every variant, every comparison. */
function renderBenchmarkTable({ benchmark, metrics }: BenchmarkAnalysis): string {
  const comparisons = metrics[0]?.comparisons ?? [];

  const columns = [
    { field: 'metric', header: 'Metric', align: 'left' as const },
    ...benchmark.variants.map((variant) => ({
      field: `variant:${variant}`,
      header: variant,
      align: 'right' as const,
    })),
    ...comparisons.map((comparison) => ({
      field: `comparison:${comparison.subject}:${comparison.against}`,
      header: formatComparisonLabel(benchmark, comparison),
      align: 'left' as const,
    })),
  ];
  const rows = metrics.map(({ metric, definition, variants, comparisons: metricComparisons }) => ({
    metric,
    ...Object.fromEntries(
      benchmark.variants.map((variant) => [
        `variant:${variant}`,
        formatValue(variants[variant].median, definition),
      ]),
    ),
    ...Object.fromEntries(
      metricComparisons.map((comparison) => [
        `comparison:${comparison.subject}:${comparison.against}`,
        `\`${formatComparison(comparison)}\``,
      ]),
    ),
  }));

  return `**${benchmark.name}**\n\n${formatMarkdownTable(columns, rows)}`;
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
    lines.push('', `_${RUN_REPORT_FOOTNOTE}_`, '', '</details>');
  }

  if (options.detailsUrl) {
    lines.push('', `[See the full run](${options.detailsUrl})`);
  }

  return lines.join('\n');
}
