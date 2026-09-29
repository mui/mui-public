import { describe, expect, it } from 'vitest';
import {
  analyzeRun,
  compareSamples,
  findRegressions,
  meanInterval,
  median,
  tCritical95,
} from './analyzeRun';
import type { BenchmarkRunReport, RunBenchmark, RunMetricDefinition } from './schema';

const SCALAR: RunMetricDefinition = { kind: 'scalar', alarm: {} };

/** Rounds where `shifted` is always `base + shift`, both riding the same per-round drift. */
function drifting(shift: number) {
  const drift = [0, 40, -25, 60, -10, 35, -45, 20, 5, -30];
  return {
    base: drift.map((offset) => 100 + offset),
    shifted: drift.map((offset) => 100 + offset + shift),
  };
}

function reportOf(benchmarks: RunBenchmark[], metrics: BenchmarkRunReport['metrics'] = {}) {
  const report: BenchmarkRunReport = {
    version: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    head: { sha: 'abc' },
    environment: { browser: 'Chromium', platform: 'linux', arch: 'x64', launchArgs: [] },
    sampling: { samples: 10, warmup: 2 },
    builds: { current: { label: 'working tree' }, baseline: { sha: 'def', label: 'HEAD~1' } },
    metrics,
    benchmarks,
  };
  return report;
}

describe('tCritical95', () => {
  it('reads small samples from the table', () => {
    expect(tCritical95(1)).toBe(12.706);
    expect(tCritical95(29)).toBe(2.045);
  });

  it('approaches the normal quantile for large samples', () => {
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

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('compareSamples', () => {
  it('resolves a small shift that per-round drift hides from the variant means', () => {
    const { base, shifted } = drifting(2);
    const comparison = compareSamples(
      { name: 'current', values: shifted },
      { name: 'baseline', values: base },
      SCALAR,
    );

    expect(comparison.absolute).toEqual({ low: 2, high: 2 });
    expect(comparison.change).toBe('worse');
    expect(comparison.rounds).toBe(10);
  });

  it('reads the direction from the alarm', () => {
    const { base, shifted } = drifting(2);
    const comparison = compareSamples(
      { name: 'current', values: shifted },
      { name: 'baseline', values: base },
      { kind: 'scalar', alarm: { direction: 'higherIsBetter' } },
    );

    expect(comparison.change).toBe('better');
    expect(comparison.severity).toBe('none');
  });

  it('is unsure when the interval straddles zero', () => {
    const comparison = compareSamples(
      { name: 'current', values: [10, 12, 9, 11] },
      { name: 'baseline', values: [11, 10, 10, 12] },
      SCALAR,
    );

    expect(comparison.change).toBe('unsure');
  });

  describe('severity', () => {
    const { base, shifted } = drifting(10);

    it('is none for a metric without an alarm, however large the change', () => {
      const comparison = compareSamples(
        { name: 'current', values: shifted },
        { name: 'baseline', values: base },
        { kind: 'scalar' },
      );
      expect(comparison.severity).toBe('none');
    });

    it('grades a change against the warn and error thresholds', () => {
      const compareWith = (alarm: RunMetricDefinition['alarm']) =>
        compareSamples(
          { name: 'current', values: shifted },
          { name: 'baseline', values: base },
          { kind: 'scalar', alarm },
        ).severity;

      // The change is +10 on a mean of 105, about +9.5%.
      expect(compareWith({ warn: 0.05, error: 0.2 })).toBe('warning');
      expect(compareWith({ warn: 0.05, error: 0.09 })).toBe('error');
      expect(compareWith({ warn: 0.2 })).toBe('none');
    });

    it('compares a discrete metric in absolute counts', () => {
      const comparison = compareSamples(
        { name: 'current', values: [5, 5, 5] },
        { name: 'baseline', values: [3, 3, 3] },
        { kind: 'discrete', alarm: { error: 2 } },
      );
      expect(comparison.severity).toBe('error');
    });
  });
});

describe('analyzeRun', () => {
  it('compares the current build against the baseline', () => {
    const { base, shifted } = drifting(2);
    const [analysis] = analyzeRun(
      reportOf(
        [
          {
            name: 'Button mount',
            file: 'button.bench.tsx',
            kind: 'baseline',
            variants: ['current', 'baseline'],
            samples: { current: { render: shifted }, baseline: { render: base } },
          },
        ],
        { render: SCALAR },
      ),
    );

    expect(analysis.metrics.map((metric) => metric.metric)).toEqual(['render']);
    expect(analysis.metrics[0].comparisons).toMatchObject([
      { subject: 'current', against: 'baseline', change: 'worse', severity: 'error' },
    ]);
  });

  it('compares every other variant of a comparison against the first', () => {
    const [analysis] = analyzeRun(
      reportOf([
        {
          name: 'lists / mount',
          file: 'lists.bench.tsx',
          kind: 'compare',
          variants: ['ul', 'table', 'grid'],
          samples: {
            ul: { render: [1, 1] },
            table: { render: [2, 2] },
            grid: { render: [3, 3] },
          },
        },
      ]),
    );

    expect(
      analysis.metrics[0].comparisons.map(({ subject, against }) => `${subject} vs ${against}`),
    ).toEqual(['table vs ul', 'grid vs ul']);
  });

  it('defines a sub-series by its base metric', () => {
    const [analysis] = analyzeRun(
      reportOf(
        [
          {
            name: 'Grid mount',
            file: 'grid.bench.tsx',
            kind: 'baseline',
            variants: ['current', 'baseline'],
            samples: {
              current: { 'bench:paint#header': [5, 5] },
              baseline: { 'bench:paint#header': [5, 5] },
            },
          },
        ],
        { 'bench:paint': { kind: 'scalar', format: { style: 'unit', unit: 'millisecond' } } },
      ),
    );

    expect(analysis.metrics[0].definition.format).toEqual({
      style: 'unit',
      unit: 'millisecond',
    });
  });

  it('keeps a failed benchmark, with no metrics', () => {
    const [analysis] = analyzeRun(
      reportOf([
        {
          name: 'Broken',
          file: 'broken.bench.tsx',
          kind: 'baseline',
          variants: ['current', 'baseline'],
          error: 'Render failed',
        },
      ]),
    );

    expect(analysis.metrics).toEqual([]);
  });
});

describe('findRegressions', () => {
  it('reports alarmed changes for the worse, on baseline benchmarks only', () => {
    const { base, shifted } = drifting(2);
    const samples = { render: shifted };
    const analyses = analyzeRun(
      reportOf(
        [
          {
            name: 'Button mount',
            file: 'button.bench.tsx',
            kind: 'baseline',
            variants: ['current', 'baseline'],
            samples: { current: samples, baseline: { render: base } },
          },
          {
            name: 'libs / mount',
            file: 'libs.bench.tsx',
            kind: 'compare',
            variants: ['ours', 'theirs'],
            samples: { ours: { render: base }, theirs: samples },
          },
        ],
        { render: SCALAR },
      ),
    );

    expect(findRegressions(analyses)).toMatchObject([
      { benchmark: 'Button mount', metric: 'render' },
    ]);
  });
});
