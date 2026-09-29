/* eslint-disable no-console */

import { dim, green, printTable, red, yellow } from '../format';
import { analyzeRun, findRegressions, formatComparison, formatValue } from '../runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '../runReport';

function printBenchmark({ benchmark, metrics }: BenchmarkAnalysis): void {
  const [reference] = benchmark.variants;
  const comparedTo = (subject: string, against: string) =>
    benchmark.kind === 'baseline' ? `Δ vs ${against}` : `${subject} vs ${against}`;

  const headers = [
    'Metric',
    ...benchmark.variants.map((variant) => `${variant} (median)`),
    ...(metrics[0]?.comparisons ?? []).map(({ subject, against }) => comparedTo(subject, against)),
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
  const measured = analyses.filter((analysis) => !analysis.benchmark.error).length;
  const failed = analyses.length - measured;
  console.log(
    [
      `${measured} benchmark${measured === 1 ? '' : 's'} measured`,
      regressions.length > 0 ? red(`${regressions.length} regression(s)`) : green('no regressions'),
      failed > 0 ? red(`${failed} failed`) : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );
  console.log(
    dim(
      'Each Δ is a 95% confidence interval on the paired per-round difference, relative to the ' +
        'variant it is measured against; "unsure" means it straddles zero.',
    ),
  );
}
