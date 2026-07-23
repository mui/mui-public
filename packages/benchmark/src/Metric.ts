import { onTestFinished, TestRunner } from 'vitest';
import type { RunnerTestCase } from 'vitest';
import type { MetricConfig, MetricKind, MetricReport, MetricSampleStats } from './types';
import { aggregateSamples } from './stats';
import { metricsGate } from './metricsGate';
// Import for TaskMeta augmentation side effect
import './taskMetaAugmentation';

interface SeriesAccumulator {
  /** The instance that registered this name, used to reject two metrics sharing a name. */
  owner: Metric;
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
      // `aggregateSamples` reports the effective (post-outlier-removal) count as `count`, which is
      // the `n` behind mean/stdDev — exactly what a downstream Welch's t-test needs.
      series[seriesId] = aggregateSamples(samples);
    }
    store[name] = { kind: entry.kind, config: entry.config, series };
  }
  test.meta.benchmarkMetrics = store;
}

/** One alarmed scalar (sub-)series the adaptive stopping rule tracks, named for reporting. */
export interface AdaptiveMetricSamples {
  /** Metric name, with a `#sub-series` suffix for named sub-series. */
  name: string;
  samples: number[];
}

/**
 * Snapshot of the raw samples collected so far for a test's alarmed scalar metrics — one entry per
 * (metric, sub-series), each named. The adaptive stopping rule reads this so measurement keeps
 * sampling while any metric that will be significance-tested downstream is still imprecise, not just
 * the render duration, and so a non-convergence warning can name the specific metric that stayed
 * noisy.
 *
 * Discrete metrics (compared as exact counts) and informational scalar metrics (shown but never
 * flagged) are excluded: their precision never changes a verdict, and gating on a noisy one would
 * needlessly block convergence.
 */
export function collectAdaptiveMetricSamples(test: RunnerTestCase): AdaptiveMetricSamples[] {
  const accumulator = accumulators.get(test);
  if (!accumulator) {
    return [];
  }
  const sampleSets: AdaptiveMetricSamples[] = [];
  for (const [metricName, entry] of accumulator) {
    if (entry.kind !== 'scalar' || entry.config.alarm === undefined) {
      continue;
    }
    for (const [seriesId, samples] of entry.series) {
      sampleSets.push({
        name: seriesId === '' ? metricName : `${metricName}#${seriesId}`,
        samples,
      });
    }
  }
  return sampleSets;
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
    if (this.name.includes('#')) {
      throw new Error(
        `Metric name "${this.name}" must not contain "#" — it is reserved as the sub-series separator.`,
      );
    }
  }

  /**
   * Records a single measured value. Samples accumulate in browser memory and are aggregated
   * once when the test finishes. Pass `options.id` to split into a labeled sub-series.
   */
  record(value: number, options?: MetricRecordOptions): void {
    const test = TestRunner.getCurrentTest<RunnerTestCase | undefined>();
    if (!test) {
      throw new Error(
        `${this.constructor.name}.record() must be called inside a running Vitest test.`,
      );
    }

    // The harness disables the gate during warmup iterations so custom metrics recorded inside a
    // benchmark honor the same warmup exclusion as renders and `bench:paint`. Standalone `it()`
    // loops never touch the gate, so they keep recording every value.
    if (!metricsGate.isRecordingEnabled(test)) {
      return;
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
      entry = { owner: this, kind: this.kind, config: this.config, series: new Map() };
      accumulator.set(this.name, entry);
    } else if (entry.owner !== this) {
      throw new Error(
        `Two metrics share the name "${this.name}". Metric names must be unique; reuse a single instance instead.`,
      );
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
