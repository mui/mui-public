import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Reporter, TestCase } from 'vitest/node';
import type { RenderEvent, IterationData, MetricReport, MetricDefinition } from './types';
import type { BenchmarkBaseUpload, BenchmarkReportEntry } from './ciReport';
import { benchmarkUploadSchema, getCiMetadata } from './ciReport';
import { calculateMean, aggregateSamples } from './stats';
import { dim, red, green, yellow, cyan, printTable, fileUrl } from './format';
import { uploadCiReport } from './upload';
import { syncPrComment } from './syncPrComment';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

function getEventKey(event: RenderEvent): string {
  return `${event.id}:${event.phase}`;
}

/** Order-insensitive deep equality, treating a missing key and an `undefined` value as equal. */
function deepEqual(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true;
  }
  if (
    typeof first !== 'object' ||
    first === null ||
    typeof second !== 'object' ||
    second === null
  ) {
    return false;
  }
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const keys = new Set([...Object.keys(firstRecord), ...Object.keys(secondRecord)]);
  for (const key of keys) {
    if (!deepEqual(firstRecord[key], secondRecord[key])) {
      return false;
    }
  }
  return true;
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
    count: number;
  }> = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const durations = iterations.map((iteration) => iteration.renders[index].actualDuration);

    const { mean: iqrMean, stdDev: iqrStdDev, outliers, count } = aggregateSamples(durations);
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
      outliers,
      count,
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
    const { event, iqrMean, iqrStdDev, outliers, count } = renderStats[index];
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
      count,
    });
    totalDuration += iqrMean;
  }

  // Custom + paint metrics are merged separately from `task.meta.benchmarkMetrics`.
  const metrics = {};

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

/** Strips a `#sub-series` suffix to recover the metric name used to look up its definition. */
function baseMetricName(key: string): string {
  const hashIndex = key.indexOf('#');
  return hashIndex === -1 ? key : key.slice(0, hashIndex);
}

function formatMetricValue(value: number, definition?: MetricDefinition): string {
  if (definition?.format) {
    return new Intl.NumberFormat(undefined, definition.format).format(value);
  }
  return value.toFixed(2);
}

/**
 * Merges aggregated custom metrics (already stats, not raw samples) into a report entry, keyed
 * `name` or `name#id` for sub-series, and collects each metric's config into the shared
 * top-level definitions. For a metric-only test, derives the iteration count from the samples.
 */
function mergeCustomMetrics(
  report: BenchmarkReportEntry,
  customMetrics: Record<string, MetricReport>,
  definitions: Record<string, MetricDefinition>,
): void {
  let maxCount = 0;
  for (const [metricName, metric] of Object.entries(customMetrics)) {
    for (const [seriesId, stats] of Object.entries(metric.series)) {
      const key = seriesId === '' ? metricName : `${metricName}#${seriesId}`;
      report.metrics[key] = {
        mean: stats.mean,
        stdDev: stats.stdDev,
        outliers: stats.outliers,
        count: stats.count,
      };
      // `stats.count` is the post-outlier-removal count; add back the dropped outliers to recover
      // the raw number of recorded samples, which is what a metric-only benchmark reports as its
      // iteration count below.
      maxCount = Math.max(maxCount, stats.count + stats.outliers);
    }
    const definition: MetricDefinition = {
      kind: metric.kind,
      format: metric.config.format,
      alarm: metric.config.alarm,
    };
    // A metric name maps to one definition. Reusing it across benchmarks is fine when the config
    // matches (e.g. the harness `bench:paint`), but conflicting config would silently apply
    // last-write-wins to every entry — reject it instead.
    const existing = definitions[metricName];
    if (existing && !deepEqual(existing, definition)) {
      throw new Error(
        `Benchmark metric "${metricName}" is defined with conflicting configuration across ` +
          `benchmarks. A metric name must map to a single kind, format, and alarm.`,
      );
    }
    definitions[metricName] = definition;
  }
  if (report.iterations === 0) {
    report.iterations = maxCount;
  }
}

function printMetricsTable(
  name: string,
  metrics: Record<string, { mean: number; stdDev: number; outliers: number }>,
  iterationCount: number,
  definitions: Record<string, MetricDefinition>,
): void {
  const entries = Object.entries(metrics);
  if (entries.length === 0) {
    return;
  }

  const rows: string[][] = entries.map(([metricName, stats]) => {
    const definition = definitions[baseMetricName(metricName)];
    const iqrStr = `${formatMetricValue(stats.mean, definition)}±${formatMetricValue(stats.stdDev, definition)}`;
    const cv = stats.mean > 0 ? (stats.stdDev / stats.mean) * 100 : 0;
    const label = definition?.alarm ? `${metricName} ⚠` : metricName;
    return [
      label.slice(0, LABEL_WIDTH).padStart(LABEL_WIDTH),
      cyan(iqrStr.padStart(STAT_WIDTH)),
      colorCV(cv),
      stats.outliers > 0 ? yellow(String(stats.outliers).padStart(4)) : dim('0'.padStart(4)),
    ];
  });

  printTable(
    [
      { header: 'Metric', width: LABEL_WIDTH },
      { header: 'Mean±σ', width: STAT_WIDTH },
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
  baselinePath?: string;
}

async function loadBaselineReport(baselinePath: string): Promise<BenchmarkBaseUpload> {
  const raw = await fs.readFile(baselinePath, 'utf8');
  const parsed = benchmarkUploadSchema.parse(JSON.parse(raw));
  // Strip any nested `.base` field to keep the inlined data single-level.
  const { base, ...single } = parsed;
  void base;
  return single;
}

class BenchmarkReporter implements Reporter {
  private benchmarks: Record<string, BenchmarkReportEntry> = {};

  private metricDefinitions: Record<string, MetricDefinition> = {};

  private outputPath: string;

  private upload: boolean;

  private baselinePath: string | undefined;

  private hasFailures = false;

  constructor(options?: BenchmarkReporterOptions) {
    this.outputPath =
      options?.outputPath ??
      process.env.BENCHMARK_OUTPUT_PATH ??
      path.resolve(process.cwd(), 'benchmarks', 'results.json');
    this.upload = options?.upload ?? process.env.BENCHMARK_UPLOAD === 'true';
    this.baselinePath = options?.baselinePath ?? process.env.BENCHMARK_BASELINE_PATH;
  }

  // Reset accumulated state at the start of every run so watch-mode re-runs start clean (the
  // reporter instance is reused across runs). Otherwise stale benchmarks/definitions linger — and
  // an edited metric config would conflict with its own previous-run definition.
  onTestRunStart(): void {
    this.benchmarks = {};
    this.metricDefinitions = {};
    this.hasFailures = false;
  }

  onTestCaseResult(testCase: TestCase): void {
    if (testCase.result().state === 'failed') {
      this.hasFailures = true;
    }

    const meta = testCase.meta();
    const iterations = meta.benchmarkIterations;
    const customMetrics = meta.benchmarkMetrics;

    if (!iterations && !customMetrics) {
      console.warn(yellow(`  No iterations recorded for: ${testCase.fullName}`));
      return;
    }

    const name = meta.benchmarkName ?? testCase.fullName;
    const report = iterations
      ? generateReportFromIterations(iterations)
      : { iterations: 0, totalDuration: 0, renders: [], metrics: {} };

    if (customMetrics) {
      mergeCustomMetrics(report, customMetrics, this.metricDefinitions);
    }

    this.benchmarks[name] = report;

    const summary =
      dim('Total: ') +
      green(`${report.totalDuration.toFixed(2)}ms`) +
      dim(` (${report.renders.length} renders, ${report.iterations} iterations)`);

    printDurationMatrix(`${name} — React`, report, summary);

    printMetricsTable(name, report.metrics, report.iterations, this.metricDefinitions);
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

    const baseline = this.baselinePath ? await loadBaselineReport(this.baselinePath) : undefined;

    const hasMetricDefinitions = Object.keys(this.metricDefinitions).length > 0;

    const results = {
      version: 1 as const,
      reportType: 'benchmark' as const,
      ...(await getCiMetadata()),
      report: this.benchmarks,
      ...(hasMetricDefinitions ? { metricDefinitions: this.metricDefinitions } : {}),
      ...(baseline ? { base: baseline } : {}),
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
          try {
            // eslint-disable-next-line no-console
            console.log('Syncing PR comment via dashboard API...');
            const commentResult = await syncPrComment(results.repo);
            // eslint-disable-next-line no-console
            console.log(
              commentResult.skipped
                ? 'No open PR found for this branch, skipping.'
                : 'PR comment synced.',
            );
          } catch (error: unknown) {
            console.error(
              'Failed to sync PR comment:',
              error instanceof Error ? error.message : error,
            );
          }
        }
      }
    }
  }
}

export { BenchmarkReporter, generateReportFromIterations };
export default BenchmarkReporter;
