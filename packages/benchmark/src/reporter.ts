import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import type { Reporter, TestCase } from 'vitest/node';
import type { RenderEvent, BenchmarkReport, BenchmarkResult, AggregatedResults } from './types';
import { calculateMean, calculateStdDev, quantile, isOutlier } from './stats';
import { dim, red, green, yellow, cyan, padStart, printTable } from './format';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

function getEventKey(event: RenderEvent): string {
  return `${event.id}:${event.phase}`;
}

function generateReportFromIterations(iterations: RenderEvent[][]): BenchmarkReport {
  if (iterations.length === 0) {
    return { renders: [] };
  }

  const iterationCount = iterations.length;
  const firstIteration = iterations[0];
  const expectedLength = firstIteration.length;

  // Skip report if iterations have inconsistent event counts (the test already failed)
  if (iterations.some((iter) => iter.length !== expectedLength)) {
    return { renders: [] };
  }

  // Merge events by calculating mean duration and standard deviation (with IQR outlier removal)
  const renders = firstIteration.map((event, index) => {
    const durations = iterations.map((iteration) => iteration[index].actualDuration);

    // Apply IQR outlier removal
    const sorted = [...durations].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const filteredIndices = durations
      .map((d, i) => (isOutlier(d, q1, q3) ? -1 : i))
      .filter((i) => i >= 0);

    // Fall back to all values if every value is an outlier
    const indices = filteredIndices.length > 0 ? filteredIndices : durations.map((_, i) => i);

    const filteredDurations = indices.map((i) => durations[i]);
    const meanDuration = calculateMean(filteredDurations);
    const stdDev = calculateStdDev(filteredDurations, meanDuration);
    const coefficientOfVariation = meanDuration > 0 ? stdDev / meanDuration : 0;

    // Calculate mean relative start time from the same filtered iterations
    const relativeStartTimes = indices.map((i) => {
      const firstEventStartTime = iterations[i][0].startTime;
      return iterations[i][index].startTime - firstEventStartTime;
    });
    const meanStartTime = calculateMean(relativeStartTimes);

    if (meanDuration > 1 && coefficientOfVariation > 0.1) {
      console.warn(
        `High coefficient of variation (${(coefficientOfVariation * 100).toFixed(1)}%) for render #${index} event "${getEventKey(event)}". ` +
          `Mean: ${meanDuration.toFixed(2)}ms, StdDev: ${stdDev.toFixed(2)}ms. Results may be unreliable.`,
      );
    }

    return {
      actualDuration: meanDuration,
      startTime: meanStartTime,
    };
  });

  return {
    metadata: { iterations: iterationCount },
    renders,
  };
}

const DURATION_NOISE_FLOOR = 0.1; // ms — below timer resolution

const LABEL_WIDTH = 28;
const STAT_WIDTH = 16;

function printDurationMatrix(name: string, iterations: RenderEvent[][]): void {
  const renderCount = iterations[0]?.length ?? 0;
  if (renderCount === 0 || iterations.some((iter) => iter.length !== renderCount)) {
    return;
  }

  // Collect durations per render: durations[renderIdx][iterIdx]
  const durations: number[][] = [];
  for (let r = 0; r < renderCount; r += 1) {
    durations.push(iterations.map((iter) => iter[r].actualDuration));
  }

  const rows: string[][] = [];

  for (let r = 0; r < renderCount; r += 1) {
    const row = durations[r];
    const sorted = [...row].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const filtered = row.filter((d) => !isOutlier(d, q1, q3));
    const used = filtered.length > 0 ? filtered : row;
    const rawMean = calculateMean(row);
    const rawSigma = calculateStdDev(row, rawMean);
    const iqrMean = calculateMean(used);
    const iqrSigma = calculateStdDev(used, iqrMean);
    const dropped = row.length - used.length;

    const event = iterations[0][r];
    const label = `#${r} ${event.id}:${event.phase}`;
    const rawStr = `${rawMean.toFixed(2)}±${rawSigma.toFixed(2)}`;
    const iqrStr = `${iqrMean.toFixed(2)}±${iqrSigma.toFixed(2)}`;

    rows.push([
      padStart(label.slice(0, LABEL_WIDTH), LABEL_WIDTH),
      dim(padStart(rawStr, STAT_WIDTH)),
      cyan(padStart(iqrStr, STAT_WIDTH)),
      dropped > 0 ? yellow(padStart(String(dropped), 4)) : dim(padStart('0', 4)),
    ]);
  }

  printTable(
    `Duration Matrix: ${name} (IQR method)`,
    [
      { header: 'Render', width: LABEL_WIDTH },
      { header: 'Raw μ±σ', width: STAT_WIDTH },
      { header: 'IQR μ±σ', width: STAT_WIDTH },
      { header: 'Out', width: 4 },
    ],
    rows,
  );
}

function extractTotalDuration(report: BenchmarkReport): number {
  let totalDuration = 0;
  for (const render of report.renders) {
    if (render.actualDuration >= DURATION_NOISE_FLOOR) {
      totalDuration += render.actualDuration;
    }
  }
  return totalDuration;
}

function getCommitSha(): string | null {
  if (process.env.COMMIT_SHA) {
    return process.env.COMMIT_SHA;
  }
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export interface BenchmarkReporterOptions {
  outputPath?: string;
}

class BenchmarkReporter implements Reporter {
  private benchmarks: Record<string, BenchmarkResult> = {};

  private outputPath: string;

  constructor(options?: BenchmarkReporterOptions) {
    this.outputPath =
      options?.outputPath ?? path.resolve(process.cwd(), 'benchmarks', 'results.json');
  }

  onTestCaseResult(testCase: TestCase): void {
    const meta = testCase.meta();
    const iterations = meta.benchmarkIterations;

    if (!iterations) {
      if (testCase.result().state === 'failed') {
        const errors = testCase.result().errors ?? [];
        // eslint-disable-next-line no-console
        console.log(red(`  FAILED: ${testCase.fullName}`));
        for (const error of errors) {
          // eslint-disable-next-line no-console
          console.log(red(`  ${error.message ?? JSON.stringify(error)}`));
        }
      }
      return;
    }

    const name = (meta.benchmarkName as string) ?? testCase.fullName;
    const report = generateReportFromIterations(iterations);
    const duration = extractTotalDuration(report);

    this.benchmarks[name] = {
      duration,
      renderCount: report.renders.length,
      iterations: report.metadata?.iterations ?? 1,
      renders: report.renders,
    };

    // eslint-disable-next-line no-console
    console.log(
      green(`  ${name}: ${duration.toFixed(2)}ms`) +
        dim(` (${report.renders.length} renders, ${report.metadata?.iterations ?? 1} iterations)`),
    );

    printDurationMatrix(name, iterations);
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
        `  ${name}: ${result.duration.toFixed(2)}ms ${dim(`(${result.renderCount} renders, ${result.iterations} iterations)`)}`,
      );
    }

    const commitSha = getCommitSha();

    const results: AggregatedResults = {
      commitSha,
      timestamp: Date.now(),
      benchmarks: this.benchmarks,
    };

    const outputDir = path.dirname(this.outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(this.outputPath, JSON.stringify(results, null, 2));

    // eslint-disable-next-line no-console
    console.log(dim(`\nResults saved to ${this.outputPath}`));
  }
}

export { BenchmarkReporter };
export default BenchmarkReporter;
