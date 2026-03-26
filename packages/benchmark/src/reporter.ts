import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Reporter, TestCase } from 'vitest/node';
import type { RenderEvent } from './types';
import type { BenchmarkReportEntry } from './ciReport';
import { getCiMetadata } from './ciReport';
import { calculateMean, calculateStdDev, quantile, isOutlier } from './stats';
import { dim, green, yellow, cyan, printTable, fileUrl } from './format';
import { uploadCiReport } from './upload';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

const byNumeric = (a: number, b: number) => a - b;

function getEventKey(event: RenderEvent): string {
  return `${event.id}:${event.phase}`;
}

function generateReportFromIterations(iterations: RenderEvent[][]): BenchmarkReportEntry {
  if (iterations.length === 0) {
    return { iterations: 0, totalDuration: 0, renders: [] };
  }

  const iterationCount = iterations.length;
  const firstIteration = iterations[0];
  const expectedLength = firstIteration.length;

  // Skip report if iterations have inconsistent event counts (the test already failed)
  if (iterations.some((iter) => iter.length !== expectedLength)) {
    return { iterations: iterationCount, totalDuration: 0, renders: [] };
  }

  // Per-render stats (IQR + raw)
  const renderStats: Array<{
    event: RenderEvent;
    iqrMean: number;
    iqrStdDev: number;
    rawMean: number;
    rawStdDev: number;
    outliers: number;
  }> = [];

  for (let index = 0; index < expectedLength; index += 1) {
    const durations = iterations.map((iteration) => iteration[index].actualDuration);

    const sorted = [...durations].sort(byNumeric);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const filtered = durations.filter((d) => !isOutlier(d, q1, q3));
    const used = filtered.length > 0 ? filtered : durations;

    const rawMean = calculateMean(durations);
    const rawStdDev = calculateStdDev(durations, rawMean);
    const iqrMean = calculateMean(used);
    const iqrStdDev = calculateStdDev(used, iqrMean);
    const coefficientOfVariation = iqrMean > 0 ? iqrStdDev / iqrMean : 0;

    if (iqrMean > 1 && coefficientOfVariation > 0.1) {
      const event = firstIteration[index];
      console.warn(
        `High coefficient of variation (${(coefficientOfVariation * 100).toFixed(1)}%) for render #${index} event "${getEventKey(event)}". ` +
          `Mean: ${iqrMean.toFixed(2)}ms, StdDev: ${iqrStdDev.toFixed(2)}ms. Results may be unreliable.`,
      );
    }

    renderStats.push({
      event: firstIteration[index],
      iqrMean,
      iqrStdDev,
      rawMean,
      rawStdDev,
      outliers: durations.length - used.length,
    });
  }

  // Calculate mean gaps between consecutive renders, then derive start times
  const meanGaps: number[] = [0]; // no gap before first render
  for (let index = 1; index < expectedLength; index += 1) {
    const gaps = iterations.map((iteration) => {
      const prevEnd = iteration[index - 1].startTime + iteration[index - 1].actualDuration;
      return iteration[index].startTime - prevEnd;
    });
    meanGaps.push(calculateMean(gaps));
  }

  const renders: BenchmarkReportEntry['renders'] = [];
  let totalDuration = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    const { event, iqrMean, iqrStdDev, rawMean, rawStdDev, outliers } = renderStats[index];
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
      rawMean,
      rawStdDev,
      outliers,
    });
    totalDuration += iqrMean;
  }

  return {
    iterations: iterationCount,
    totalDuration,
    renders,
  };
}

const LABEL_WIDTH = 28;
const STAT_WIDTH = 16;

function printDurationMatrix(name: string, report: BenchmarkReportEntry, footer: string): void {
  if (report.renders.length === 0) {
    return;
  }

  const rows: string[][] = [];

  for (let r = 0; r < report.renders.length; r += 1) {
    const render = report.renders[r];
    const label = `#${r} ${render.id}:${render.phase}`;
    const rawStr = `${render.rawMean.toFixed(2)}±${render.rawStdDev.toFixed(2)}`;
    const iqrStr = `${render.actualDuration.toFixed(2)}±${render.stdDev.toFixed(2)}`;

    rows.push([
      label.slice(0, LABEL_WIDTH).padStart(LABEL_WIDTH),
      dim(rawStr.padStart(STAT_WIDTH)),
      cyan(iqrStr.padStart(STAT_WIDTH)),
      render.outliers > 0 ? yellow(String(render.outliers).padStart(4)) : dim('0'.padStart(4)),
    ]);
  }

  printTable(
    [
      { header: 'Render', width: LABEL_WIDTH },
      { header: 'Raw μ±σ', width: STAT_WIDTH },
      { header: 'IQR μ±σ', width: STAT_WIDTH },
      { header: 'Out', width: 4 },
    ],
    rows,
    footer,
    name,
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

    printDurationMatrix(name, report, summary);
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
      }
    }
  }
}

export { BenchmarkReporter, generateReportFromIterations };
export default BenchmarkReporter;
