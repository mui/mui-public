export function calculateMean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function calculateStdDev(values: number[], mean: number): number {
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length);
}

export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Determines whether a value is a statistical outlier using the IQR method.
 * Values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR are considered outliers.
 *
 * See https://en.wikipedia.org/wiki/Interquartile_range#Outliers
 */
export function isOutlier(value: number, q1: number, q3: number): boolean {
  const iqr = q3 - q1;
  return value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr;
}

/**
 * Aggregates a series of samples into a mean, standard deviation, outlier count, and effective
 * sample count using IQR-based outlier removal. Falls back to the raw values when filtering would
 * remove everything. This is the shared aggregation core for custom metrics.
 *
 * `count` is the number of samples that actually back `mean`/`stdDev` (post-outlier-removal), so a
 * downstream Welch's t-test can use it directly as the `n` behind those stats.
 */
export function aggregateSamples(values: number[]): {
  mean: number;
  stdDev: number;
  outliers: number;
  count: number;
} {
  const sorted = values.toSorted((first, second) => first - second);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const filtered = values.filter((value) => !isOutlier(value, q1, q3));
  const used = filtered.length > 0 ? filtered : values;

  const mean = calculateMean(used);
  const stdDev = calculateStdDev(used, mean);
  return { mean, stdDev, outliers: values.length - used.length, count: used.length };
}

/**
 * Relative margin of error of the mean — half the 95% confidence interval width divided by the
 * mean, using the normal approximation (`z = 1.96`). This is the adaptive-sampling stopping signal:
 * measurement continues until this drops to a target. A precise t-quantile is unnecessary just to
 * decide when enough samples have been collected.
 *
 * Returns `Infinity` below two samples (spread can't be estimated) and `0` when the mean is
 * non-positive (e.g. a metric-only benchmark with no render duration to converge on), so such
 * benchmarks stop at their minimum run count rather than sampling to the maximum.
 */
export function relativeMarginOfError(samples: number[]): number {
  const n = samples.length;
  if (n < 2) {
    return Infinity;
  }
  const mean = calculateMean(samples);
  if (mean <= 0) {
    return 0;
  }
  // Bessel-corrected (sample) variance: the samples estimate the spread of the population.
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  return (1.96 * standardError) / mean;
}
