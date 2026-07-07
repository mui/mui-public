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
 * Drops IQR outliers (values outside the 1.5×IQR fences), returning the surviving samples. Falls
 * back to the original values when filtering would remove everything. Shared by every consumer that
 * wants to reason about typical performance rather than measurement artifacts (GC pauses, scheduling
 * hiccups), so they all trim identically.
 */
export function removeOutliers(values: number[]): number[] {
  const sorted = values.toSorted((first, second) => first - second);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const filtered = values.filter((value) => !isOutlier(value, q1, q3));
  return filtered.length > 0 ? filtered : values;
}

/**
 * Aggregates a series of samples into a mean, standard deviation, outlier count, and effective
 * sample count using IQR-based outlier removal. This is the shared aggregation core for custom
 * metrics.
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
  const used = removeOutliers(values);
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
 * IQR outliers are removed first, so the margin of error is measured on the same trimmed
 * distribution the reported stats and the Welch comparison use. Without this, a benchmark that is
 * stable apart from recurring GC/scheduling spikes would keep a high raw margin of error and sample
 * all the way to its maximum (and warn that it "did not converge") even though its typical estimate
 * settled long ago.
 *
 * Returns `Infinity` below two (trimmed) samples (spread can't be estimated) and `0` when the mean
 * is non-positive (e.g. a metric-only benchmark with no render duration to converge on), so such
 * benchmarks stop at their minimum run count rather than sampling to the maximum.
 */
export function relativeMarginOfError(samples: number[]): number {
  const used = removeOutliers(samples);
  const n = used.length;
  if (n < 2) {
    return Infinity;
  }
  const mean = calculateMean(used);
  if (mean <= 0) {
    return 0;
  }
  // Bessel-corrected (sample) variance: the samples estimate the spread of the population.
  const variance = used.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  return (1.96 * standardError) / mean;
}
