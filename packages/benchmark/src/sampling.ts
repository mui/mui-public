import type { MetricComparisons } from './runReport/analyzeRun';

/**
 * How many rounds a benchmark is sampled for, under tachometer's names. After `sampleSize` rounds,
 * sampling continues while a difference that can raise an alarm is still unsettled against its
 * alarm's `error` band, until `timeout` minutes after sampling began.
 */
export interface SamplingOptions {
  /** Rounds measured before deciding whether to continue. Defaults to 50. */
  sampleSize?: number;
  /**
   * Minutes a benchmark may sample for, its first `sampleSize` rounds included, which always run.
   * Past them it keeps sampling while a difference that can raise an alarm is unsettled: its interval
   * still straddles the alarm's `error` band (5% for a scalar metric that sets none), or zero for a
   * discrete one without a band. `0` measures exactly `sampleSize` rounds. Defaults to 3.
   */
  timeout?: number;
}

export const DEFAULT_SAMPLING: Required<SamplingOptions> = {
  sampleSize: 50,
  timeout: 3,
};

/**
 * The sampling options `options` sets, checked: only `sampleSize` and `timeout`, and only those not
 * undefined, so spreading them over defaults keeps the defaults for the rest. Throws on one out of
 * range. Called where options come in, when a case registers and when a run starts, so a mistake
 * fails there rather than in a round, and what it returns is valid from then on.
 */
export function getSampling(options: SamplingOptions): SamplingOptions {
  const { sampleSize, timeout } = options;
  if (sampleSize !== undefined && !(Number.isInteger(sampleSize) && sampleSize >= 2)) {
    throw new Error(`Invalid sampleSize ${sampleSize}: expected an integer of at least 2.`);
  }
  if (timeout !== undefined && !(timeout >= 0)) {
    throw new Error(`Invalid timeout ${timeout}: expected a number of minutes, 0 or more.`);
  }
  return {
    ...(sampleSize !== undefined ? { sampleSize } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
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
