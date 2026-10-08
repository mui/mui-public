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
   * unsettled: its interval still straddles the alarm's `error` band, or zero for an alarm without
   * one. `0` measures exactly `sampleSize` rounds. Defaults to 3.
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

/** Whether any sampling option is set. */
export function hasSampling(options: SamplingOptions): boolean {
  return Object.keys(pickSampling(options)).length > 0;
}

/** The sampling options `options` sets, leaving out any other key and any left undefined. */
export function pickSampling(options: SamplingOptions): SamplingOptions {
  const { sampleSize, timeout } = options;
  return Object.fromEntries(
    Object.entries({ sampleSize, timeout }).filter(([, value]) => value !== undefined),
  );
}

/** Whether an interval lies entirely on one side of every horizon. */
export function isResolved(interval: { low: number; high: number }, horizons: number[]): boolean {
  return horizons.every((horizon) => !(interval.low < horizon && horizon < interval.high));
}

/**
 * Whether sampling a benchmark can stop: every difference that can raise an alarm is known to be past
 * its `error` band or within it, either way — or, for an alarm without a band, known to be a change
 * or not. The others are only read, so they never keep a run going.
 */
export function differencesResolved(analysis: { metrics: MetricComparisons[] }): boolean {
  return analysis.metrics.every(({ definition, comparisons }) =>
    comparisons.every(({ alarm, relative, absolute }) => {
      if (alarm === null) {
        return true;
      }
      // Bands are fractions on a scalar metric, whose relative interval is in percent, and counts on
      // a discrete one.
      const discrete = definition.kind === 'discrete';
      const band = (alarm.error ?? 0) * (discrete ? 1 : 100);
      return isResolved(discrete ? absolute : relative, band === 0 ? [0] : [-band, band]);
    }),
  );
}
