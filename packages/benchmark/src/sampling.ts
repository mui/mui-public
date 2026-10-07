import type { MetricComparisons } from './runReport/analyzeRun';

/**
 * How many rounds a benchmark is sampled for: tachometer's knobs, under tachometer's names. After
 * `sampleSize` rounds, sampling continues while any difference is still unresolved against an
 * `autoSampleConditions` horizon, for up to `timeout` minutes.
 */
export interface SamplingOptions {
  /** Rounds measured before deciding whether to continue. Defaults to 50. */
  sampleSize?: number;
  /**
   * Minutes to keep sampling after `sampleSize` rounds while a difference is unresolved. `0`
   * measures exactly `sampleSize` rounds. Defaults to 3.
   */
  timeout?: number;
  /**
   * Relative differences to resolve before `timeout`. A difference is resolved against a horizon
   * once its confidence interval lies entirely on one side of it. `'10%'` stands for both `'-10%'`
   * and `'+10%'`. Defaults to `['5%']`: sample until each change is known to be larger or smaller
   * than 5%. A `0%` horizon tests whether there is any change at all: identical builds never resolve
   * against it, and checking again after every round makes a false finding likelier.
   *
   * Judged on the metrics that alarm — the ones a change can be flagged on — or on every metric when
   * none does.
   */
  autoSampleConditions?: string[];
}

export const DEFAULT_SAMPLING: Required<SamplingOptions> = {
  sampleSize: 50,
  timeout: 3,
  autoSampleConditions: ['5%'],
};

/** Parses `autoSampleConditions` into signed horizons, in percent. */
export function parseHorizons(conditions: string[]): number[] {
  return conditions.flatMap((condition) => {
    const trimmed = condition.trim();
    const value = Number(trimmed.slice(0, -1));
    if (!trimmed.endsWith('%') || trimmed === '%' || Number.isNaN(value)) {
      throw new Error(
        `Invalid auto-sample condition "${condition}": expected a percentage, like "5%", "+5%" or "-5%".`,
      );
    }
    const signed = trimmed.startsWith('+') || trimmed.startsWith('-');
    return signed || value === 0 ? [value] : [-value, value];
  });
}

/**
 * Checks sampling options and fills in the defaults. Called when a case registers, so a mistake fails
 * the page rather than a round, and the runner gets complete options.
 */
export function resolveSampling(options: SamplingOptions): Required<SamplingOptions> {
  const {
    sampleSize = DEFAULT_SAMPLING.sampleSize,
    timeout = DEFAULT_SAMPLING.timeout,
    autoSampleConditions = DEFAULT_SAMPLING.autoSampleConditions,
  } = options;
  if (!(Number.isInteger(sampleSize) && sampleSize >= 2)) {
    throw new Error(`Invalid sampleSize ${sampleSize}: expected an integer of at least 2.`);
  }
  if (!(timeout >= 0)) {
    throw new Error(`Invalid timeout ${timeout}: expected a number of minutes, 0 or more.`);
  }
  parseHorizons(autoSampleConditions);
  return { sampleSize, timeout, autoSampleConditions };
}

/** Whether any sampling option is set. */
export function hasSampling(options: SamplingOptions): boolean {
  return (
    options.sampleSize !== undefined ||
    options.timeout !== undefined ||
    options.autoSampleConditions !== undefined
  );
}

/** Whether an interval lies entirely on one side of every horizon. */
export function isResolved(interval: { low: number; high: number }, horizons: number[]): boolean {
  return horizons.every((horizon) => !(interval.low < horizon && horizon < interval.high));
}

/**
 * Whether sampling a benchmark can stop: every comparison it reports has resolved against the
 * horizons, on the metrics that alarm, or on every metric when none does.
 */
export function differencesResolved(
  analysis: { metrics: MetricComparisons[] },
  horizons: number[],
): boolean {
  const alarmed = analysis.metrics.filter((metric) => metric.definition.alarm !== undefined);
  const judged = alarmed.length > 0 ? alarmed : analysis.metrics;
  return judged.every((metric) =>
    metric.comparisons.every((comparison) => isResolved(comparison.relative, horizons)),
  );
}
