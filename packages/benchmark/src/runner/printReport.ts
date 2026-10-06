/* eslint-disable no-console */

import { dim, printTable, red, yellow } from '../format';
import {
  analyzeRun,
  benchmarkTable,
  formatRounds,
  findRegressions,
  formatComparison,
  formatRunSummary,
  runReportFootnote,
} from '../runReport';
import type { BenchmarkAnalysis, BenchmarkRunReport } from '../runReport';

function printBenchmark(analysis: BenchmarkAnalysis): void {
  const { columns, rows } = benchmarkTable(analysis);
  const cells = rows.map((row) => row.cells);
  printTable(
    columns.map(({ header }, column) => ({
      header,
      width: Math.max(header.length, ...cells.map((row) => row[column].length)),
    })),
    cells,
    undefined,
    `${analysis.benchmark.name}  (${analysis.benchmark.file} · ${formatRounds(analysis.benchmark)})`,
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
  console.log(dim(runReportFootnote(analyses)));
}
