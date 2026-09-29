import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  findRegressions,
  formatComparison,
  formatValue,
} from '@mui/internal-benchmark/runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '@mui/internal-benchmark/runReport';

export const BENCHMARK_RUN_SECTION_TITLE = 'Benchmarks';

interface BuildOptions {
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

/** One table per benchmark: every metric, the median of every variant, every comparison. */
function renderBenchmarkTable({ benchmark, metrics }: BenchmarkAnalysis): string {
  const comparisons = metrics[0]?.comparisons ?? [];
  const comparisonHeader = (subject: string, against: string) =>
    benchmark.kind === 'baseline' ? `Δ vs ${against}` : `${subject} vs ${against}`;

  const columns = [
    { field: 'metric', header: 'Metric', align: 'left' as const },
    ...benchmark.variants.map((variant) => ({
      field: `variant:${variant}`,
      header: variant,
      align: 'right' as const,
    })),
    ...comparisons.map(({ subject, against }) => ({
      field: `comparison:${subject}:${against}`,
      header: comparisonHeader(subject, against),
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
 * Renders the benchmarks section of the pull request comment.
 *
 * Regressions are stated above the collapsed block, and mark the heading, because a reader has to
 * see them without expanding anything — GitHub renders `<details>` closed, so anything inside it is
 * invisible until someone chooses to look.
 */
export function buildBenchmarkRunMarkdownReport(
  report: BenchmarkRunReport,
  options: BuildOptions = {},
): string {
  const analyses = analyzeRun(report);
  const regressions = findRegressions(analyses);
  const measured = analyses.filter((analysis) => !analysis.benchmark.error);
  const failed = analyses.filter((analysis) => analysis.benchmark.error);

  const lines = [`## ${BENCHMARK_RUN_SECTION_TITLE}${regressions.length > 0 ? ' ⚠️' : ''}`, ''];

  for (const { benchmark, metric, comparison } of regressions) {
    const marker = comparison.severity === 'error' ? '🔴' : '🟡';
    lines.push(`${marker} **${benchmark}** · ${metric} · \`${formatComparison(comparison)}\``);
  }
  if (regressions.length > 0) {
    lines.push('');
  }

  const regressedBenchmarks = new Set(regressions.map((regression) => regression.benchmark));
  lines.push(
    [
      `${measured.length} benchmark${measured.length === 1 ? '' : 's'} measured`,
      regressedBenchmarks.size > 0
        ? `${regressedBenchmarks.size} with regressions`
        : 'no regressions',
      failed.length > 0 ? `${failed.length} failed` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    '',
  );

  for (const { benchmark } of failed) {
    lines.push(`❌ **${benchmark.name}**: ${benchmark.error}`);
  }
  if (failed.length > 0) {
    lines.push('');
  }

  if (measured.length > 0) {
    lines.push('<details>', '<summary>Full results</summary>', '');
    lines.push(measured.map(renderBenchmarkTable).join('\n\n'));
    lines.push(
      '',
      '_Each value is a median. Each Δ is a 95% confidence interval on the paired per-round ' +
        'difference, relative to the variant it is measured against; "unsure" means it straddles ' +
        'zero — the expected result for two equivalent builds._',
      '',
      '</details>',
    );
  }

  if (options.detailsUrl) {
    lines.push('', `[See the full run](${options.detailsUrl})`);
  }

  return lines.join('\n');
}
