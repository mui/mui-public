import { onTestFinished, TestRunner, type RunnerTestCase } from 'vitest';
import type { MetricConfig, MetricKind, MetricReport, MetricSampleStats } from './types';
import { aggregateSamples } from './stats';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

interface SeriesAccumulator {
  kind: MetricKind;
  config: MetricConfig;
  /** Raw samples per sub-series id (`''` is the base series), kept in browser memory only. */
  series: Map<string, number[]>;
}

type TestAccumulator = Map<string, SeriesAccumulator>;

// Raw samples never cross the browser→runner boundary. They accumulate here per test (keyed by
// the running task so a module-scoped metric shared across tests never mixes data) and are
// aggregated into compact stats by an `onTestFinished` hook before being written to `task.meta`.
const accumulators = new WeakMap<RunnerTestCase, TestAccumulator>();

function flush(test: RunnerTestCase, accumulator: TestAccumulator): void {
  const store: Record<string, MetricReport> = {};
  for (const [name, entry] of accumulator) {
    const series: Record<string, MetricSampleStats> = {};
    for (const [seriesId, samples] of entry.series) {
      series[seriesId] = { ...aggregateSamples(samples), count: samples.length };
    }
    store[name] = { kind: entry.kind, config: entry.config, series };
  }
  test.meta.benchmarkMetrics = store;
}

export interface MetricRecordOptions {
  /** Sub-series label. Recorded under `${name}#${id}` in the report; omit for the base series. */
  id?: string;
}

/**
 * Base class for custom benchmark metrics. Use `ScalarMetric` or `DiscreteMetric`.
 *
 * Records are tied to the test that is running when `record()` is called (resolved via
 * `getCurrentTest()`), so a single instance can be declared at module scope and reused across
 * tests and loop iterations, inside or outside React.
 */
export abstract class Metric {
  abstract readonly kind: MetricKind;

  readonly name: string;

  protected readonly config: MetricConfig;

  constructor(config: MetricConfig | string) {
    this.config = typeof config === 'string' ? { name: config } : config;
    this.name = this.config.name;
  }

  /**
   * Records a single measured value. Samples accumulate in browser memory and are aggregated
   * once when the test finishes. Pass `options.id` to split into a labeled sub-series.
   */
  record(value: number, options?: MetricRecordOptions): void {
    const test = TestRunner.getCurrentTest<RunnerTestCase | undefined>();
    if (!test) {
      throw new Error(
        `${this.constructor.name}.record() must be called inside a running benchmark test.`,
      );
    }

    let accumulator = accumulators.get(test);
    if (!accumulator) {
      const created: TestAccumulator = new Map();
      accumulator = created;
      accumulators.set(test, created);
      onTestFinished(() => flush(test, created));
    }

    let entry = accumulator.get(this.name);
    if (!entry) {
      entry = { kind: this.kind, config: this.config, series: new Map() };
      accumulator.set(this.name, entry);
    }

    const seriesId = options?.id ?? '';
    let samples = entry.series.get(seriesId);
    if (!samples) {
      samples = [];
      entry.series.set(seriesId, samples);
    }
    samples.push(value);
  }
}
