import { describe, it, expect } from 'vitest';
import { calculateMean, calculateStdDev, quantile, isOutlier } from './stats';

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
