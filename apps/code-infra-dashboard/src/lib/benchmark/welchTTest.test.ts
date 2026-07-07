import { describe, it, expect } from 'vitest';
import { welchTTest, studentTCdf, regularizedIncompleteBeta } from './welchTTest';
import type { SampleSummary } from './welchTTest';

/**
 * Builds a summary from a target *sample* standard deviation, converting to the population stdDev
 * (÷n) the harness stores and `welchTTest` expects. Keeps the tests readable in sample-variance
 * terms while exercising the internal conversion.
 */
function summary(mean: number, sampleStdDev: number, n: number): SampleSummary {
  const stdDev = sampleStdDev * Math.sqrt((n - 1) / n);
  return { mean, stdDev, n };
}

describe('regularizedIncompleteBeta', () => {
  it('is 0 at x=0 and 1 at x=1', () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });

  it('is 0.5 at the symmetric midpoint (a === b, x = 0.5)', () => {
    expect(regularizedIncompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(regularizedIncompleteBeta(0.5, 5, 5)).toBeCloseTo(0.5, 10);
  });

  it('matches the closed form for I_x(1, 1) = x', () => {
    expect(regularizedIncompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 10);
    expect(regularizedIncompleteBeta(0.75, 1, 1)).toBeCloseTo(0.75, 10);
  });
});

describe('studentTCdf', () => {
  it('is 0.5 at t=0', () => {
    expect(studentTCdf(0, 5)).toBeCloseTo(0.5, 10);
  });

  it('matches a known reference value (t=2, df=8 → two-tailed p≈0.0805)', () => {
    // CDF = 1 - p/2.
    expect(studentTCdf(2, 8)).toBeCloseTo(0.9597, 3);
  });

  it('is symmetric: F(-t) = 1 - F(t)', () => {
    const positive = studentTCdf(1.7, 12);
    const negative = studentTCdf(-1.7, 12);
    expect(negative).toBeCloseTo(1 - positive, 10);
  });

  it('approaches 1 far out in the upper tail', () => {
    expect(studentTCdf(50, 10)).toBeCloseTo(1, 6);
  });
});

describe('welchTTest', () => {
  it('returns t=0 and p=1 for identical summaries', () => {
    const result = welchTTest(summary(10, 2, 20), summary(10, 2, 20));
    expect(result).not.toBeNull();
    expect(result!.t).toBe(0);
    expect(result!.pValue).toBeCloseTo(1, 10);
  });

  it('computes the expected t, df, and p for a textbook equal-variance case', () => {
    // Two groups, sample variance 4 (sd 2), n=10 each, means 10 vs 12.
    // t = (10-12)/sqrt(0.4+0.4) = -2.2360679; df = 18 (reduces to 2(n-1) for equal var & n).
    const result = welchTTest(summary(10, 2, 10), summary(12, 2, 10));
    expect(result).not.toBeNull();
    expect(result!.t).toBeCloseTo(-2.2360679, 5);
    expect(result!.df).toBeCloseTo(18, 6);
    expect(result!.pValue).toBeCloseTo(0.038, 2);
  });

  it('handles unequal variances and sample sizes (Welch–Satterthwaite df)', () => {
    // Larger, noisier group vs smaller, tighter group.
    const result = welchTTest(summary(100, 10, 30), summary(108, 4, 12));
    expect(result).not.toBeNull();
    // Point estimate is well separated relative to the pooled standard error → clearly significant.
    expect(result!.pValue).toBeLessThan(0.05);
    // Welch df lands between the smaller group's df and the pooled total, never above n1+n2-2.
    expect(result!.df).toBeGreaterThan(11);
    expect(result!.df).toBeLessThan(40);
  });

  it('is sign-symmetric in its arguments', () => {
    const forward = welchTTest(summary(10, 2, 15), summary(13, 3, 18));
    const reversed = welchTTest(summary(13, 3, 18), summary(10, 2, 15));
    expect(forward!.t).toBeCloseTo(-reversed!.t, 10);
    expect(forward!.df).toBeCloseTo(reversed!.df, 10);
    expect(forward!.pValue).toBeCloseTo(reversed!.pValue, 10);
  });

  it('returns a vanishingly small p-value for well-separated means', () => {
    const result = welchTTest(summary(10, 1, 30), summary(30, 1, 30));
    expect(result!.pValue).toBeLessThan(1e-6);
  });

  it('returns null when either side has fewer than two samples', () => {
    expect(welchTTest(summary(10, 2, 1), summary(12, 2, 20))).toBeNull();
    expect(welchTTest(summary(10, 2, 20), summary(12, 2, 1))).toBeNull();
  });

  it('returns null when both sides have zero variance', () => {
    expect(welchTTest({ mean: 10, stdDev: 0, n: 20 }, { mean: 12, stdDev: 0, n: 20 })).toBeNull();
  });

  it('still tests when only one side has zero variance', () => {
    const result = welchTTest({ mean: 10, stdDev: 0, n: 20 }, summary(12, 2, 20));
    expect(result).not.toBeNull();
    expect(result!.pValue).toBeLessThan(0.05);
  });
});
