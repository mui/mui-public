import { describe, it, expect } from 'vitest';
import { welchTTest, welchTTestFromComponents, regularizedIncompleteBeta } from './welchTTest';
import type { SampleSummary, WelchComponent } from './welchTTest';

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

describe('welchTTestFromComponents', () => {
  /**
   * Reduces a summary to its Welch component independently of production, so the equivalence test
   * below stays a real cross-check of the math rather than a tautology.
   */
  function component(sample: SampleSummary): WelchComponent {
    const standardErrorSquared = (sample.stdDev * sample.stdDev) / (sample.n - 1);
    return {
      mean: sample.mean,
      standardErrorSquared,
      satterthwaiteTerm: (standardErrorSquared * standardErrorSquared) / (sample.n - 1),
    };
  }

  /** Sums components the way the grand-total fold pools independent benchmarks. */
  function pool(...components: WelchComponent[]): WelchComponent {
    return components.reduce((acc, comp) => ({
      mean: acc.mean + comp.mean,
      standardErrorSquared: acc.standardErrorSquared + comp.standardErrorSquared,
      satterthwaiteTerm: acc.satterthwaiteTerm + comp.satterthwaiteTerm,
    }));
  }

  it('reproduces welchTTest for single-sample components', () => {
    const a = summary(100, 10, 30);
    const b = summary(108, 4, 12);
    const direct = welchTTest(a, b)!;
    const viaComponents = welchTTestFromComponents(component(a), component(b))!;
    expect(viaComponents.t).toBeCloseTo(direct.t, 12);
    expect(viaComponents.df).toBeCloseTo(direct.df, 12);
    expect(viaComponents.pValue).toBeCloseTo(direct.pValue, 12);
  });

  it('pools independent series by summing standard errors and Satterthwaite terms', () => {
    // A grand total of two equal-count benchmarks equals a single series with the summed means and
    // standard-error² — the components just add. Only the second benchmark moves (70 → 71).
    const pooledCurrent = pool(component(summary(50, 3, 20)), component(summary(70, 5, 20)));
    const pooledBase = pool(component(summary(50, 3, 20)), component(summary(71, 5, 20)));
    const result = welchTTestFromComponents(pooledCurrent, pooledBase)!;
    expect(result).not.toBeNull();
    // A 1ms shift on a 120ms total, against the pooled standard error.
    expect(result.t).toBeCloseTo(-1 / Math.sqrt(pooledCurrent.standardErrorSquared * 2), 6);
  });

  it('is not fooled by an unequal-count mix (high-n low-variance benchmark dominates)', () => {
    // A benchmark that converged at n=200 with tiny variance barely widens the standard error,
    // unlike the old min-count pooling which divided its contribution by the smallest count.
    const current = pool(component(summary(90, 1, 200)), component(summary(10, 2, 10)));
    const base = { ...current, mean: current.mean + 5 };
    const result = welchTTestFromComponents(current, base)!;
    // A 5ms grand-total shift against a small pooled standard error is clearly significant.
    expect(result.pValue).toBeLessThan(0.05);
  });

  it('returns null when both sides are varianceless', () => {
    const zero = { mean: 10, standardErrorSquared: 0, satterthwaiteTerm: 0 };
    expect(welchTTestFromComponents(zero, { ...zero, mean: 12 })).toBeNull();
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
