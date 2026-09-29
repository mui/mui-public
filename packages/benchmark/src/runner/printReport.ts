/* eslint-disable no-console */

import { dim, printTable, red, yellow } from '../format';
import {
  analyzeRun,
  findRegressions,
  formatComparison,
  formatComparisonLabel,
  formatRunSummary,
  formatValue,
  RUN_REPORT_FOOTNOTE,
} from '../runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '../runReport';

function printBenchmark({ benchmark, metrics }: BenchmarkAnalysis): void {
  const [reference] = benchmark.variants;

  const headers = [
    'Metric',
    ...benchmark.variants.map((variant) => `${variant} (median)`),
    ...(metrics[0]?.comparisons ?? []).map((comparison) =>
      formatComparisonLabel(benchmark, comparison),
    ),
    'Rounds',
  ];
  const rows = metrics.map(({ metric, definition, variants, comparisons }) => [
    metric,
    ...benchmark.variants.map((variant) => formatValue(variants[variant].median, definition)),
    ...comparisons.map(formatComparison),
    String(variants[reference].count),
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length)),
  );

  printTable(
    headers.map((header, column) => ({ header, width: widths[column] })),
    rows,
    undefined,
    `${benchmark.name}  (${benchmark.file})`,
  );
}

/**
 * Prints a run report as the terminal tables, and says up front what regressed — the same analysis
 * the pull request comment and the dashboard show.
 */
export function printRunReport(report: BenchmarkRunReport): void {
  const analyses = analyzeRun(report);

  for (const analysis of analyses) {
    if (analysis.benchmark.error) {
      console.log(red(`✖ ${analysis.benchmark.name}: ${analysis.benchmark.error}`));
      continue;
    }
    printBenchmark(analysis);
  }

  const regressions = findRegressions(analyses);
  console.log('');
  for (const { benchmark, metric, comparison } of regressions) {
    const color = comparison.severity === 'error' ? red : yellow;
    console.log(color(`⚠ ${benchmark} · ${metric} · ${formatComparison(comparison)}`));
  }
  console.log(formatRunSummary(analyses, regressions));
  console.log(dim(RUN_REPORT_FOOTNOTE));
}
