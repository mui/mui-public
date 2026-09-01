import { describe, expect, it, vi } from 'vitest';
import { summarizeCase, verdictOf } from './summarizeCase.mjs';

/**
 * A tachometer benchmark entry.
 *
 * @param {Object} options - Entry fields
 * @param {string} options.name - Entry name, as tachometer reports it
 * @param {string} [options.measurement] - Measurement name
 * @param {Array<{ ms: [number, number], pct: [number, number] } | null>} [options.differences] - Differences against every entry, by flat index
 * @returns {any}
 */
function benchmark({ name, measurement, differences = [] }) {
  return {
    name,
    bytesSent: 100,
    mean: { low: 1, high: 2 },
    samples: [1, 2, 3],
    measurement: measurement === undefined ? undefined : { name: measurement },
    differences: differences.map((difference) =>
      difference
        ? {
            absolute: { low: difference.ms[0], high: difference.ms[1] },
            percentChange: { low: difference.pct[0], high: difference.pct[1] },
          }
        : null,
    ),
  };
}

/**
 * A discovered case, as `discoverCases` would return it.
 *
 * @param {string[]} variants - Variant names in order; the first is the reference
 * @param {string[]} measurements - Measurement names
 * @returns {any}
 */
function discovered(variants, measurements) {
  return {
    name: 'example',
    configPath: '/tmp/tachometer.json',
    config: {},
    leaves: [],
    variants: variants.map((name) => ({ name, refId: 'current' })),
    measurements,
  };
}

describe('verdictOf', () => {
  it('is slower when both intervals sit above zero', () => {
    expect(verdictOf({ absolute: { low: 1, high: 3 }, percentChange: { low: 2, high: 5 } })).toBe(
      'slower',
    );
  });

  it('is faster when both intervals sit below zero', () => {
    expect(
      verdictOf({ absolute: { low: -3, high: -1 }, percentChange: { low: -5, high: -2 } }),
    ).toBe('faster');
  });

  it('is unsure when the intervals disagree', () => {
    // The two are computed separately from the same samples, so near zero one can exclude it while
    // the other does not. A verdict resting on only one of them would flip depending which is read.
    expect(verdictOf({ absolute: { low: 1, high: 3 }, percentChange: { low: -1, high: 5 } })).toBe(
      'unsure',
    );
  });

  it('is unsure when both intervals straddle zero', () => {
    expect(verdictOf({ absolute: { low: -1, high: 3 }, percentChange: { low: -2, high: 5 } })).toBe(
      'unsure',
    );
  });
});

describe('summarizeCase', () => {
  it('reports every variant of a single-measurement case', () => {
    const entry = discovered(['a', 'b'], ['mount']);
    const summary = summarizeCase(entry, {
      benchmarks: [
        benchmark({
          name: 'a',
          measurement: 'mount',
          differences: [null, { ms: [-3, -1], pct: [-5, -2] }],
        }),
        benchmark({
          name: 'b',
          measurement: 'mount',
          differences: [{ ms: [1, 3], pct: [2, 5] }, null],
        }),
      ],
    });

    expect(summary.reference).toBe('a');
    expect(summary.measurements).toHaveLength(1);
    expect(summary.measurements[0].variants.map((variant) => variant.variant)).toEqual(['a', 'b']);
    expect(summary.measurements[0].comparisons).toMatchObject([
      { variant: 'b', verdict: 'faster' },
    ]);
  });

  it('pairs results by measurement rather than by position', () => {
    // Tachometer flattens variants × measurements into one list and names entries
    // `<variant> [<measurement>]`. Reading the difference matrix positionally would compare `mount`
    // against `scroll`. Here the flat order deliberately interleaves the two measurements.
    const entry = discovered(['a', 'b'], ['mount', 'scroll']);
    const summary = summarizeCase(entry, {
      benchmarks: [
        // index 0
        benchmark({
          name: 'a [mount]',
          measurement: 'mount',
          differences: [null, null, { ms: [-3, -1], pct: [-5, -2] }, null],
        }),
        // index 1
        benchmark({
          name: 'a [scroll]',
          measurement: 'scroll',
          differences: [null, null, null, { ms: [1, 3], pct: [2, 5] }],
        }),
        // index 2
        benchmark({ name: 'b [mount]', measurement: 'mount', differences: [] }),
        // index 3
        benchmark({ name: 'b [scroll]', measurement: 'scroll', differences: [] }),
      ],
    });

    const [mount, scroll] = summary.measurements;
    expect(mount.name).toBe('mount');
    expect(mount.comparisons).toMatchObject([{ variant: 'b', verdict: 'faster' }]);
    expect(scroll.name).toBe('scroll');
    expect(scroll.comparisons).toMatchObject([{ variant: 'b', verdict: 'slower' }]);
  });

  it('strips the measurement suffix when pairing variants back', () => {
    const entry = discovered(['a', 'b'], ['mount']);
    const summary = summarizeCase(entry, {
      benchmarks: [
        benchmark({
          name: 'a [mount]',
          measurement: 'mount',
          differences: [null, { ms: [-3, -1], pct: [-5, -2] }],
        }),
        benchmark({ name: 'b [mount]', measurement: 'mount', differences: [] }),
      ],
    });

    expect(summary.measurements[0].variants.map((variant) => variant.variant)).toEqual(['a', 'b']);
  });

  it('records the reverse comparison, which is not the negation of the forward one', () => {
    // Each direction has its own denominator.
    const entry = discovered(['a', 'b'], ['mount']);
    const summary = summarizeCase(entry, {
      benchmarks: [
        benchmark({
          name: 'a',
          measurement: 'mount',
          differences: [null, { ms: [-3, -1], pct: [-5, -2] }],
        }),
        benchmark({
          name: 'b',
          measurement: 'mount',
          differences: [{ ms: [1, 3], pct: [3, 9] }, null],
        }),
      ],
    });

    expect(summary.measurements[0].comparisons[0]).toMatchObject({
      verdict: 'faster',
      versusReference: { verdict: 'slower', percentChange: { low: 3, high: 9 } },
    });
  });

  it('skips a variant with no result for a measurement instead of failing the case', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = discovered(['a', 'b'], ['mount']);

    const summary = summarizeCase(entry, {
      benchmarks: [benchmark({ name: 'a', measurement: 'mount', differences: [null] })],
    });

    expect(summary.measurements[0].variants.map((variant) => variant.variant)).toEqual(['a']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws when the reference itself has no result for a measurement', () => {
    const entry = discovered(['a'], ['mount']);

    expect(() => summarizeCase(entry, { benchmarks: [] })).toThrow(
      'Case "example": no "mount" result for the reference "a".',
    );
  });

  it('throws when the case declares no variants', () => {
    expect(() => summarizeCase(discovered([], ['mount']), { benchmarks: [] })).toThrow(
      'Case "example" declares no variants.',
    );
  });
});
