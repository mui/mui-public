import { describe, expect, it } from 'vitest';
import { summarizeCase } from './summarizeCase.mjs';

/**
 * Builds a tachometer benchmark entry.
 *
 * @param {string} name - Variant name
 * @param {Array<{ low: number, high: number } | null>} differences - Percent-change CIs against each variant, by index
 * @returns {import('./summarizeCase.mjs').TachometerBenchmark}
 */
function benchmark(name, differences = []) {
  return {
    name,
    bytesSent: 0,
    mean: { low: 1, high: 2 },
    samples: [1, 2, 3],
    differences: differences.map((percentChange) =>
      percentChange ? { absolute: { low: -1, high: 1 }, percentChange } : null,
    ),
  };
}

describe('summarizeCase', () => {
  it('reports every variant with its mean and sample count', () => {
    const summary = summarizeCase('example', {
      benchmarks: [benchmark('a', [null, { low: -5, high: -1 }]), benchmark('b')],
    });

    expect(summary.reference).toBe('a');
    expect(summary.variants).toEqual([
      { name: 'a', meanMs: { low: 1, high: 2 }, samples: 3 },
      { name: 'b', meanMs: { low: 1, high: 2 }, samples: 3 },
    ]);
  });

  describe('verdicts', () => {
    it('is faster when the whole confidence interval is below zero', () => {
      const summary = summarizeCase('example', {
        benchmarks: [benchmark('a', [null, { low: -5, high: -1 }]), benchmark('b')],
      });
      expect(summary.comparisons[0]).toMatchObject({ variant: 'b', verdict: 'faster' });
    });

    it('is slower when the whole confidence interval is above zero', () => {
      const summary = summarizeCase('example', {
        benchmarks: [benchmark('a', [null, { low: 1, high: 5 }]), benchmark('b')],
      });
      expect(summary.comparisons[0]).toMatchObject({ variant: 'b', verdict: 'slower' });
    });

    it('is unsure when the confidence interval straddles zero', () => {
      const summary = summarizeCase('example', {
        benchmarks: [benchmark('a', [null, { low: -3, high: 4 }]), benchmark('b')],
      });
      expect(summary.comparisons[0]).toMatchObject({ variant: 'b', verdict: 'unsure' });
    });

    it('is unsure when there is no difference to read', () => {
      const summary = summarizeCase('example', {
        benchmarks: [benchmark('a', [null, null]), benchmark('b')],
      });
      expect(summary.comparisons[0]).toMatchObject({ variant: 'b', verdict: 'unsure' });
      expect(summary.comparisons[0].difference).toBeFalsy();
    });
  });

  it('reads each comparison from the difference that belongs to it', () => {
    // `differences` is indexed by variant, so the reference's difference against the Nth other
    // variant lives at index N + 1. An off-by-one here silently mislabels every comparison.
    const summary = summarizeCase('example', {
      benchmarks: [
        benchmark('a', [null, { low: -9, high: -8 }, { low: 8, high: 9 }]),
        benchmark('b'),
        benchmark('c'),
      ],
    });

    expect(summary.comparisons).toMatchObject([
      { variant: 'b', verdict: 'faster' },
      { variant: 'c', verdict: 'slower' },
    ]);
  });

  it('throws when a case produced no benchmarks', () => {
    expect(() => summarizeCase('example', { benchmarks: [] })).toThrow(
      'Case "example" produced no benchmarks.',
    );
  });
});
