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
 * Aggregates a series of samples into a mean, standard deviation, and outlier count using
 * IQR-based outlier removal. Falls back to the raw values when filtering would remove
 * everything. This is the shared aggregation core for custom metrics.
 */
export function aggregateSamples(values: number[]): {
  mean: number;
  stdDev: number;
  outliers: number;
} {
  const sorted = [...values].sort((first, second) => first - second);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const filtered = values.filter((value) => !isOutlier(value, q1, q3));
  const used = filtered.length > 0 ? filtered : values;

  const mean = calculateMean(used);
  const stdDev = calculateStdDev(used, mean);
  return { mean, stdDev, outliers: values.length - used.length };
}
