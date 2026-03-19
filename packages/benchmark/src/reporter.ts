import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Reporter, TestCase } from 'vitest/node';
import type { RenderEvent, BenchmarkReport, BenchmarkUpload } from './types';
import { calculateMean, calculateStdDev, quantile, isOutlier } from './stats';
import { dim, red, green, yellow, cyan, padStart, printTable } from './format';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

const byNumeric = (a: number, b: number) => a - b;

function getEventKey(event: RenderEvent): string {
  return `${event.id}:${event.phase}`;
}

function generateReportFromIterations(iterations: RenderEvent[][]): BenchmarkReport {
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

  const renders: BenchmarkReport['renders'] = [];
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

function printDurationMatrix(name: string, report: BenchmarkReport): void {
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
      padStart(label.slice(0, LABEL_WIDTH), LABEL_WIDTH),
      dim(padStart(rawStr, STAT_WIDTH)),
      cyan(padStart(iqrStr, STAT_WIDTH)),
      render.outliers > 0 ? yellow(padStart(String(render.outliers), 4)) : dim(padStart('0', 4)),
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

const execFileAsync = promisify(execFile);

async function getCommitSha(): Promise<string | null> {
  if (process.env.COMMIT_SHA) {
    return process.env.COMMIT_SHA;
  }
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

export interface BenchmarkReporterOptions {
  outputPath?: string;
  repo?: string;
  branch?: string;
  prNumber?: number;
}

class BenchmarkReporter implements Reporter {
  private benchmarks: Record<string, BenchmarkReport> = {};

  private outputPath: string;

  private repo: string;

  private branch: string;

  private prNumber: number | undefined;

  constructor(options?: BenchmarkReporterOptions) {
    this.outputPath =
      options?.outputPath ?? path.resolve(process.cwd(), 'benchmarks', 'results.json');
    this.repo = options?.repo ?? process.env.REPO ?? '';
    this.branch = options?.branch ?? process.env.BRANCH ?? '';
    const envPrNumber = process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : undefined;
    this.prNumber = options?.prNumber ?? envPrNumber;
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

    const name = meta.benchmarkName ?? testCase.fullName;
    const report = generateReportFromIterations(iterations);

    this.benchmarks[name] = report;

    // eslint-disable-next-line no-console
    console.log(
      green(`  ${name}: ${report.totalDuration.toFixed(2)}ms`) +
        dim(` (${report.renders.length} renders, ${report.iterations} iterations)`),
    );

    printDurationMatrix(name, report);
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

    const commitSha = (await getCommitSha()) ?? '';

    const results: BenchmarkUpload = {
      version: 1,
      commitSha,
      repo: this.repo,
      reportType: 'benchmark',
      timestamp: Date.now(),
      prNumber: this.prNumber,
      branch: this.branch,
      report: this.benchmarks,
    };

    const outputDir = path.dirname(this.outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(this.outputPath, JSON.stringify(results, null, 2));

    // eslint-disable-next-line no-console
    console.log(dim(`\nResults saved to ${this.outputPath}`));
  }
}

export { BenchmarkReporter, generateReportFromIterations };
export default BenchmarkReporter;
