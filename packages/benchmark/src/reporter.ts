import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Reporter, TestCase } from 'vitest/node';
import type { RenderEvent, IterationData } from './types';
import type { BenchmarkReportEntry } from './ciReport';
import { getCiMetadata } from './ciReport';
import { calculateMean, calculateStdDev, quantile, isOutlier } from './stats';
import { dim, red, green, yellow, cyan, printTable, fileUrl } from './format';
import { uploadCiReport } from './upload';
import { syncPrComment } from './syncPrComment';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

const byNumeric = (a: number, b: number) => a - b;

function getEventKey(event: RenderEvent): string {
  return `${event.id}:${event.phase}`;
}

function aggregateMetrics(
  iterations: IterationData[],
): Record<string, { mean: number; stdDev: number; outliers: number }> {
  // Collect all metric names across iterations
  const metricValues = new Map<string, number[]>();
  for (const iteration of iterations) {
    for (const metric of iteration.metrics) {
      let values = metricValues.get(metric.name);
      if (!values) {
        values = [];
        metricValues.set(metric.name, values);
      }
      values.push(metric.value);
    }
  }

  const result: Record<string, { mean: number; stdDev: number; outliers: number }> = {};
  for (const [name, values] of metricValues) {
    // Apply IQR filtering
    const sorted = [...values].sort(byNumeric);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const filtered = values.filter((d) => !isOutlier(d, q1, q3));
    const used = filtered.length > 0 ? filtered : values;

    const mean = calculateMean(used);
    const stdDev = calculateStdDev(used, mean);
    result[name] = { mean, stdDev, outliers: values.length - used.length };
  }
  return result;
}

function generateReportFromIterations(iterations: IterationData[]): BenchmarkReportEntry {
  if (iterations.length === 0) {
    return { iterations: 0, totalDuration: 0, renders: [], metrics: {} };
  }

  const iterationCount = iterations.length;
  const firstIteration = iterations[0];
  const expectedLength = firstIteration.renders.length;

  // Skip report if iterations have inconsistent event counts (the test already failed)
  if (iterations.some((iter) => iter.renders.length !== expectedLength)) {
    return { iterations: iterationCount, totalDuration: 0, renders: [], metrics: {} };
  }

  // Per-render stats (IQR-filtered)
  const renderStats: Array<{
    event: RenderEvent;
    iqrMean: number;
    iqrStdDev: number;
    outliers: number;
  }> = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const durations = iterations.map((iteration) => iteration.renders[index].actualDuration);

    const sorted = [...durations].sort(byNumeric);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const filtered = durations.filter((d) => !isOutlier(d, q1, q3));
    const used = filtered.length > 0 ? filtered : durations;

    const iqrMean = calculateMean(used);
    const iqrStdDev = calculateStdDev(used, iqrMean);
    const coefficientOfVariation = iqrMean > 0 ? iqrStdDev / iqrMean : 0;

    if (iqrMean > 1 && coefficientOfVariation > 0.1) {
      const event = firstIteration.renders[index];
      console.warn(
        `High coefficient of variation (${(coefficientOfVariation * 100).toFixed(1)}%) for render #${index} event "${getEventKey(event)}". ` +
          `Mean: ${iqrMean.toFixed(2)}ms, StdDev: ${iqrStdDev.toFixed(2)}ms. Results may be unreliable.`,
      );
    }

    renderStats.push({
      event: firstIteration.renders[index],
      iqrMean,
      iqrStdDev,
      outliers: durations.length - used.length,
    });
  }

  // Calculate mean gaps between consecutive renders, then derive start times
  const meanGaps: number[] = [0]; // no gap before first render
  for (let index = 1; index < expectedLength; index += 1) {
    const gaps = iterations.map((iteration) => {
      const prevEnd =
        iteration.renders[index - 1].startTime + iteration.renders[index - 1].actualDuration;
      return iteration.renders[index].startTime - prevEnd;
    });
    meanGaps.push(calculateMean(gaps));
  }

  const renders: BenchmarkReportEntry['renders'] = [];
  let totalDuration = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    const { event, iqrMean, iqrStdDev, outliers } = renderStats[index];
    const startTime =
      index === 0
        ? 0
        : renders[index - 1].startTime + renders[index - 1].actualDuration + meanGaps[index];
    renders.push({
      id: event.id,
      phase: event.phase,
      startTime,
      actualDuration: iqrMean,
      stdDev: iqrStdDev,
      outliers,
    });
    totalDuration += iqrMean;
  }

  // Aggregate metrics
  const metrics = aggregateMetrics(iterations);

  return {
    iterations: iterationCount,
    totalDuration,
    renders,
    metrics,
  };
}

const LABEL_WIDTH = 28;
const STAT_WIDTH = 16;
const CV_WIDTH = 8;

function colorCV(cv: number): string {
  const str = `${cv.toFixed(1)}%`.padStart(CV_WIDTH);
  if (cv > 10) {
    return red(str);
  }
  if (cv > 5) {
    return yellow(str);
  }
  return dim(str);
}

function printDurationMatrix(name: string, report: BenchmarkReportEntry, footer: string): void {
  if (report.renders.length === 0) {
    return;
  }

  const rows: string[][] = [];

  for (let r = 0; r < report.renders.length; r += 1) {
    const render = report.renders[r];
    const label = `#${r} ${render.id}:${render.phase}`;
    const iqrStr = `${render.actualDuration.toFixed(2)}±${render.stdDev.toFixed(2)}`;
    const cv = render.actualDuration > 0 ? (render.stdDev / render.actualDuration) * 100 : 0;

    rows.push([
      label.slice(0, LABEL_WIDTH).padStart(LABEL_WIDTH),
      cyan(iqrStr.padStart(STAT_WIDTH)),
      colorCV(cv),
      render.outliers > 0 ? yellow(String(render.outliers).padStart(4)) : dim('0'.padStart(4)),
    ]);
  }

  printTable(
    [
      { header: 'Render', width: LABEL_WIDTH },
      { header: 'Mean±σ (ms)', width: STAT_WIDTH },
      { header: 'Var%', width: CV_WIDTH },
      { header: 'Out', width: 4 },
    ],
    rows,
    footer,
    name,
  );
}

function printMetricsTable(
  name: string,
  metrics: Record<string, { mean: number; stdDev: number; outliers: number }>,
  iterationCount: number,
): void {
  const entries = Object.entries(metrics);
  if (entries.length === 0) {
    return;
  }

  const rows: string[][] = entries.map(([metricName, stats]) => {
    const iqrStr = `${stats.mean.toFixed(2)}±${stats.stdDev.toFixed(2)}`;
    const cv = stats.mean > 0 ? (stats.stdDev / stats.mean) * 100 : 0;
    return [
      metricName.slice(0, LABEL_WIDTH).padStart(LABEL_WIDTH),
      cyan(iqrStr.padStart(STAT_WIDTH)),
      colorCV(cv),
      stats.outliers > 0 ? yellow(String(stats.outliers).padStart(4)) : dim('0'.padStart(4)),
    ];
  });

  printTable(
    [
      { header: 'Metric', width: LABEL_WIDTH },
      { header: 'Mean±σ (ms)', width: STAT_WIDTH },
      { header: 'Var%', width: CV_WIDTH },
      { header: 'Out', width: 4 },
    ],
    rows,
    dim(`${iterationCount} iterations`),
    `${name} — Metrics`,
  );
}

export interface BenchmarkReporterOptions {
  outputPath?: string;
  upload?: boolean;
}

class BenchmarkReporter implements Reporter {
  private benchmarks: Record<string, BenchmarkReportEntry> = {};

  private outputPath: string;

  private upload: boolean;

  private hasFailures = false;

  constructor(options?: BenchmarkReporterOptions) {
    this.outputPath =
      options?.outputPath ?? path.resolve(process.cwd(), 'benchmarks', 'results.json');
    this.upload = options?.upload ?? process.env.BENCHMARK_UPLOAD === 'true';
  }

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.result().state === 'failed') {
      this.hasFailures = true;
    }

    const meta = testCase.meta();
    const iterations = meta.benchmarkIterations;

    if (!iterations) {
      console.warn(yellow(`  No iterations recorded for: ${testCase.fullName}`));
      return;
    }

    const name = meta.benchmarkName ?? testCase.fullName;
    const report = generateReportFromIterations(iterations);

    this.benchmarks[name] = report;

    const summary =
      dim('Total: ') +
      green(`${report.totalDuration.toFixed(2)}ms`) +
      dim(` (${report.renders.length} renders, ${report.iterations} iterations)`);

    printDurationMatrix(`${name} — React`, report, summary);

    printMetricsTable(name, report.metrics, report.iterations);
  }

  async onTestRunEnd(): Promise<void> {
    const count = Object.keys(this.benchmarks).length;

    // eslint-disable-next-line no-console
    console.log(
      `\n${cyan('Benchmark Results')} ${dim(`(${count} benchmark${count === 1 ? '' : 's'})`)}`,
    );
    for (const [name, result] of Object.entries(this.benchmarks)) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${name}: ${result.totalDuration.toFixed(2)}ms ${dim(`(${result.renders.length} renders, ${result.iterations} iterations)`)}`,
      );
    }

    const results = {
      version: 1 as const,
      reportType: 'benchmark' as const,
      ...(await getCiMetadata()),
      report: this.benchmarks,
    };

    const outputDir = path.dirname(this.outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(this.outputPath, JSON.stringify(results, null, 2));

    // eslint-disable-next-line no-console
    console.log(dim(`\nResults saved to ${fileUrl(this.outputPath)}`));

    if (this.upload) {
      if (this.hasFailures) {
        // eslint-disable-next-line no-console
        console.log(yellow('\nSkipping upload: some test cases failed'));
      } else {
        await uploadCiReport(results);

        if (results.repo) {
          // eslint-disable-next-line no-console
          console.log('Syncing PR comment via dashboard API...');
          const commentResult = await syncPrComment(results.repo, {
            benchmark: {},
          });
          // eslint-disable-next-line no-console
          console.log(
            commentResult.skipped
              ? 'No open PR found for this branch, skipping.'
              : 'PR comment synced.',
          );
        }
      }
    }
  }
}

export { BenchmarkReporter, generateReportFromIterations };
export default BenchmarkReporter;
