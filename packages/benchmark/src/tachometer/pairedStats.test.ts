import { describe, expect, it } from 'vitest';
import {
  meanInterval,
  shuffledIndices,
  stableMeasurements,
  tCritical95,
  toTachometerJson,
} from './pairedStats';
import type { Round } from './pairedStats';
import { summarizeCase } from './summarizeCase';
import type { BenchmarkCase } from './discoverCases';

/** Rounds where `b` is always `a + shift`, both riding the same per-round drift. */
function driftingRounds(shift: number): Round[] {
  const drift = [0, 40, -25, 60, -10, 35, -45, 20, 5, -30];
  return drift.map((offset) => [{ mount: 100 + offset }, { mount: 100 + offset + shift }]);
}

function baselineCase(measurements: string[]): BenchmarkCase {
  return {
    name: 'Button',
    configPath: '/harness/src/button/button.bench.tsx',
    config: {},
    comparison: 'baseline',
    leaves: [],
    variants: ['Button [current]', 'Button [baseline]'],
    measurements,
  };
}

describe('tCritical95', () => {
  it('reads small samples from the table', () => {
    expect(tCritical95(1)).toBe(12.706);
    expect(tCritical95(29)).toBe(2.045);
  });

  it('approaches the normal quantile for large samples', () => {
    expect(tCritical95(60)).toBeCloseTo(2.0, 1);
    expect(tCritical95(10_000)).toBeCloseTo(1.96, 2);
  });
});

describe('meanInterval', () => {
  it('centers on the mean', () => {
    const interval = meanInterval([1, 2, 3, 4, 5]);
    expect((interval.low + interval.high) / 2).toBeCloseTo(3);
    expect(interval.low).toBeLessThan(3);
  });

  it('is a point for a single value', () => {
    expect(meanInterval([7])).toEqual({ low: 7, high: 7 });
  });
});

describe('toTachometerJson', () => {
  it('resolves a small shift that drift hides from the per-variant means', () => {
    const json = toTachometerJson(
      ['Button [current]', 'Button [baseline]'],
      ['mount'],
      driftingRounds(2),
    );
    const [current, baseline] = json.benchmarks;

    // Each variant's own interval is wide enough to overlap the other's…
    expect(current.mean.high).toBeGreaterThan(baseline.mean.low);
    // …but the paired difference is exactly the shift, every round, relative to the baseline's
    // mean of 107.
    expect(current.differences[1]).toEqual({
      absolute: { low: -2, high: -2 },
      percentChange: { low: expect.closeTo(-1.87, 2), high: expect.closeTo(-1.87, 2) },
    });
  });

  it('names entries so summarizeCase pairs them back by variant and measurement', () => {
    const rounds: Round[] = [
      [
        { mount: 10, paint: 20 },
        { mount: 12, paint: 20 },
      ],
      [
        { mount: 11, paint: 21 },
        { mount: 13, paint: 20 },
      ],
      [
        { mount: 10, paint: 19 },
        { mount: 12, paint: 21 },
      ],
    ];
    const summary = summarizeCase(
      baselineCase(['mount', 'paint']),
      toTachometerJson(['Button [current]', 'Button [baseline]'], ['mount', 'paint'], rounds),
    );

    expect(summary.measurements.map((measurement) => measurement.name)).toEqual(['mount', 'paint']);
    const [mount, paint] = summary.measurements;
    expect(mount.comparisons[0]).toMatchObject({ variant: 'Button [baseline]', verdict: 'faster' });
    expect(paint.comparisons[0]).toMatchObject({ variant: 'Button [baseline]', verdict: 'unsure' });
  });

  it('never compares across measurements', () => {
    const json = toTachometerJson(
      ['a', 'b'],
      ['mount', 'paint'],
      [
        [
          { mount: 1, paint: 2 },
          { mount: 1, paint: 2 },
        ],
      ],
    );
    // Flat order is measurement-major: a/mount, b/mount, a/paint, b/paint.
    expect(json.benchmarks[0].differences[2]).toBe(null);
    expect(json.benchmarks[0].differences[3]).toBe(null);
    expect(json.benchmarks[0].differences[1]).not.toBe(null);
  });
});

describe('stableMeasurements', () => {
  it('keeps only measurements every variant reported every round', () => {
    const rounds: Round[] = [
      [
        { render: 1, 'render:update': 1 },
        { render: 1, 'render:update': 1 },
      ],
      [{ render: 1 }, { render: 1, 'render:update': 1 }],
    ];
    expect(stableMeasurements(rounds)).toEqual(['render']);
  });
});

describe('shuffledIndices', () => {
  it('returns a permutation', () => {
    expect(shuffledIndices(5).sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
