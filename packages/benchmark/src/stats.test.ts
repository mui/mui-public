import { describe, it, expect } from 'vitest';
import {
  calculateMean,
  calculateStdDev,
  quantile,
  isOutlier,
  aggregateSamples,
  relativeMarginOfError,
  describeUnconvergedSignals,
} from './stats';

describe('calculateMean', () => {
  it('returns the mean of values', () => {
    expect(calculateMean([1, 2, 3])).toBe(2);
  });

  it('handles a single value', () => {
    expect(calculateMean([5])).toBe(5);
  });

  it('handles identical values', () => {
    expect(calculateMean([4, 4, 4])).toBe(4);
  });
});

describe('calculateStdDev', () => {
  it('returns 0 for identical values', () => {
    expect(calculateStdDev([5, 5, 5], 5)).toBe(0);
  });

  it('computes population standard deviation', () => {
    // values: [2, 4, 4, 4, 5, 5, 7, 9], mean = 5
    // variance = ((9+1+1+1+0+0+4+16)/8) = 4, stddev = 2
    expect(calculateStdDev([2, 4, 4, 4, 5, 5, 7, 9], 5)).toBe(2);
  });

  it('handles a single value', () => {
    expect(calculateStdDev([3], 3)).toBe(0);
  });
});

describe('quantile', () => {
  it('returns exact value for 0th percentile', () => {
    expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  it('returns exact value for 100th percentile', () => {
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it('returns median for 50th percentile', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('interpolates between values', () => {
    // sorted: [10, 20, 30, 40], q=0.25
    // pos = 3 * 0.25 = 0.75, base=0, rest=0.75
    // result = 10 + 0.75 * (20 - 10) = 17.5
    expect(quantile([10, 20, 30, 40], 0.25)).toBe(17.5);
  });

  it('handles a single-element array', () => {
    expect(quantile([42], 0.5)).toBe(42);
  });
});

describe('isOutlier', () => {
  it('returns false for values within IQR bounds', () => {
    // q1=10, q3=20, iqr=10, lower=10-15=-5, upper=20+15=35
    expect(isOutlier(15, 10, 20)).toBe(false);
    expect(isOutlier(10, 10, 20)).toBe(false);
    expect(isOutlier(20, 10, 20)).toBe(false);
  });

  it('returns true for values below lower fence', () => {
    // q1=10, q3=20, iqr=10, lower fence = 10 - 15 = -5
    expect(isOutlier(-6, 10, 20)).toBe(true);
  });

  it('returns true for values above upper fence', () => {
    // q1=10, q3=20, iqr=10, upper fence = 20 + 15 = 35
    expect(isOutlier(36, 10, 20)).toBe(true);
  });

  it('returns false for values exactly at the fences', () => {
    // q1=10, q3=20, iqr=10, lower=-5, upper=35
    expect(isOutlier(-5, 10, 20)).toBe(false);
    expect(isOutlier(35, 10, 20)).toBe(false);
  });
});

describe('aggregateSamples', () => {
  it('computes the mean, standard deviation, and zero outliers for a clean series', () => {
    const result = aggregateSamples([2, 4, 6]);
    expect(result.mean).toBe(4);
    expect(result.outliers).toBe(0);
    expect(result.stdDev).toBeCloseTo(Math.sqrt(8 / 3));
  });

  it('reports the effective (post-outlier-removal) sample count', () => {
    expect(aggregateSamples([2, 4, 6]).count).toBe(3);
    // One value is filtered as an outlier, so it is excluded from the effective count.
    expect(aggregateSamples([10, 10, 10, 10, 10, 1000]).count).toBe(5);
  });

  it('removes IQR outliers before computing the mean', () => {
    const result = aggregateSamples([10, 10, 10, 10, 10, 1000]);
    expect(result.mean).toBe(10);
    expect(result.outliers).toBe(1);
  });

  it('falls back to all values when filtering would remove everything', () => {
    const result = aggregateSamples([5]);
    expect(result.mean).toBe(5);
    expect(result.outliers).toBe(0);
    expect(result.count).toBe(1);
  });
});

describe('relativeMarginOfError', () => {
  it('is Infinity with fewer than two samples (spread is unknown)', () => {
    expect(relativeMarginOfError([])).toBe(Infinity);
    expect(relativeMarginOfError([10])).toBe(Infinity);
  });

  it('is 0 for a perfectly stable series', () => {
    expect(relativeMarginOfError([10, 10, 10, 10])).toBe(0);
  });

  it('shrinks as more samples of the same distribution are added', () => {
    const few = relativeMarginOfError([10, 12, 8, 11, 9]);
    const many = relativeMarginOfError([
      10, 12, 8, 11, 9, 10, 12, 8, 11, 9, 10, 12, 8, 11, 9, 10, 12, 8, 11, 9,
    ]);
    expect(many).toBeLessThan(few);
  });

  it('matches the closed form z * (s / sqrt(n)) / mean', () => {
    const samples = [10, 12, 8, 14, 6];
    const mean = 10;
    const sampleStdDev = Math.sqrt(
      ((10 - mean) ** 2 + (12 - mean) ** 2 + (8 - mean) ** 2 + (14 - mean) ** 2 + (6 - mean) ** 2) /
        4,
    );
    const expected = (1.96 * (sampleStdDev / Math.sqrt(5))) / mean;
    expect(relativeMarginOfError(samples)).toBeCloseTo(expected, 12);
  });

  it('is 0 when the mean is non-positive (no signal to converge on)', () => {
    expect(relativeMarginOfError([0, 0, 0])).toBe(0);
  });

  it('ignores a spike so a stable-but-spiky series still converges', () => {
    // The trailing 200 is an artifact (e.g. a GC pause). Trimmed away, the margin of error reflects
    // the tight underlying spread; left in, the raw mean (~29) and variance would keep it far above
    // any sensible target and the benchmark would never converge.
    const spiky = [10, 11, 9, 10, 12, 8, 11, 9, 10, 200];
    expect(relativeMarginOfError(spiky)).toBeLessThan(0.1);
  });
});

describe('describeUnconvergedSignals', () => {
  it('is empty when every signal is at or below the target', () => {
    expect(
      describeUnconvergedSignals(
        [
          { label: 'duration', rme: 0.02 },
          { label: "metric 'x'", rme: 0.01 },
        ],
        0.02,
      ),
    ).toEqual([]);
  });

  it('names each signal above the target with its achieved margin of error', () => {
    expect(
      describeUnconvergedSignals(
        [
          { label: 'duration', rme: 0.015 },
          { label: "metric 'latency'", rme: 0.061 },
        ],
        0.02,
      ),
    ).toEqual(["metric 'latency' (RME 6.10%)"]);
  });

  it('reports "too few samples" when the margin of error could not be estimated', () => {
    expect(describeUnconvergedSignals([{ label: "metric 'sparse'", rme: Infinity }], 0.02)).toEqual(
      ["metric 'sparse' (too few samples)"],
    );
  });
});
