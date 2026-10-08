import type { MetricComparisons } from './runReport/analyzeRun';

/**
 * How many rounds a benchmark is sampled for, under tachometer's names. After `sampleSize` rounds,
 * sampling continues while a difference that can raise an alarm is still unsettled against its
 * alarm's `error` band, for up to `timeout` minutes.
 */
export interface SamplingOptions {
  /** Rounds measured before deciding whether to continue. Defaults to 50. */
  sampleSize?: number;
  /**
   * Minutes to keep sampling after `sampleSize` rounds while a difference that can raise an alarm is
   * unsettled: its interval still straddles the alarm's `error` band (5% for a scalar metric that sets
   * none), or zero for a discrete one without a band. `0` measures exactly `sampleSize` rounds.
   * Defaults to 3.
   */
  timeout?: number;
}

export const DEFAULT_SAMPLING: Required<SamplingOptions> = {
  sampleSize: 50,
  timeout: 3,
};

/**
 * Checks sampling options and fills in the defaults. Called when a case registers, so a mistake fails
 * the page rather than a round, and the runner gets complete options.
 */
export function resolveSampling(options: SamplingOptions): Required<SamplingOptions> {
  const { sampleSize = DEFAULT_SAMPLING.sampleSize, timeout = DEFAULT_SAMPLING.timeout } = options;
  if (!(Number.isInteger(sampleSize) && sampleSize >= 2)) {
    throw new Error(`Invalid sampleSize ${sampleSize}: expected an integer of at least 2.`);
  }
  if (!(timeout >= 0)) {
    throw new Error(`Invalid timeout ${timeout}: expected a number of minutes, 0 or more.`);
  }
  return { sampleSize, timeout };
}

/** The sampling options `options` sets, leaving out any other key and any left undefined. */
export function pickSampling(options: SamplingOptions): SamplingOptions {
  const { sampleSize, timeout } = options;
  return Object.fromEntries(
    Object.entries({ sampleSize, timeout }).filter(([, value]) => value !== undefined),
  );
}

/**
 * Whether sampling a benchmark can stop: every difference that can raise an alarm is settled. The
 * others are only read, so they never keep a run going.
 */
export function differencesSettled(analysis: { metrics: MetricComparisons[] }): boolean {
  return analysis.metrics.every((metric) =>
    metric.comparisons.every((comparison) => comparison.settled),
  );
}
