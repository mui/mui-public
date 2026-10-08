import { describe, expect, it } from 'vitest';
import {
  analyzeRun,
  compareSamples,
  findRegressions,
  meanInterval,
  median,
  tCritical,
} from './analyzeRun';
import type { BenchmarkAnalysis } from './analyzeRun';
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
    builds: { current: { label: 'working tree' }, baseline: { sha: 'def', label: 'HEAD~1' } },
    metrics,
    benchmarks,
  };
  return report;
}

describe('tCritical', () => {
  it('matches the published table at 99%, the default', () => {
    expect(tCritical(1)).toBeCloseTo(63.657, 2);
    expect(tCritical(9)).toBeCloseTo(3.25, 3);
  });

  it('matches the published table at other levels', () => {
    expect(tCritical(1, 0.95)).toBeCloseTo(12.706, 3);
    expect(tCritical(29, 0.95)).toBeCloseTo(2.045, 3);
    expect(tCritical(29, 0.999)).toBeCloseTo(3.659, 3);
  });

  it('approaches the normal quantile for large samples', () => {
    expect(tCritical(100_000)).toBeCloseTo(2.576, 2);
    expect(tCritical(100_000, 0.95)).toBeCloseTo(1.96, 2);
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

  it('is unchanged when every round measured the same on both sides', () => {
    const comparison = compareSamples(
      { name: 'current', values: [3, 4, 3] },
      { name: 'baseline', values: [3, 4, 3] },
      { kind: 'discrete' },
    );

    expect(comparison.change).toBe('unchanged');
  });

  it('detects no change when the interval straddles zero', () => {
    const comparison = compareSamples(
      { name: 'current', values: [10, 12, 9, 11] },
      { name: 'baseline', values: [11, 10, 10, 12] },
      SCALAR,
    );

    expect(comparison.change).toBe('undetected');
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

    it('raises a change only past the error band', () => {
      const compareWith = (alarm: RunMetricDefinition['alarm']) =>
        compareSamples(
          { name: 'current', values: shifted },
          { name: 'baseline', values: base },
          { kind: 'scalar', alarm },
        ).severity;

      // The change is +10 on a mean of 105, about +9.5%.
      expect(compareWith({ error: 0.09 })).toBe('error');
      expect(compareWith({ error: 0.2 })).toBe('none');
      expect(compareWith({})).toBe('error');
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

  describe('the confidence level', () => {
    // Per-round differences of 1, -2, 3, 0, 2, -1, 4, 1: noisy, so the interval has a width.
    const noisy = {
      current: [101, 98, 103, 100, 102, 99, 104, 101],
      baseline: [100, 100, 100, 100, 100, 100, 100, 100],
    };

    function benchmarkOf(name: string, samples: Record<string, Record<string, number[]>>) {
      return {
        name,
        file: `${name}.bench.tsx`,
        kind: 'baseline' as const,
        variants: ['current', 'baseline'],
        samples,
      };
    }

    const widthOf = (analysis: BenchmarkAnalysis) => {
      const [comparison] = analysis.metrics[0].comparisons;
      return comparison.absolute.high - comparison.absolute.low;
    };

    const alone = benchmarkOf('a', {
      current: { render: noisy.current },
      baseline: { render: noisy.baseline },
    });
    const other = benchmarkOf('b', {
      current: { render: noisy.current },
      baseline: { render: noisy.baseline },
    });

    it('is 99% for a metric that can raise an alarm, and 95% otherwise', () => {
      const [alarmed] = analyzeRun(reportOf([alone], { render: SCALAR }));
      const [plain] = analyzeRun(reportOf([alone], { render: { kind: 'scalar' } }));

      expect(widthOf(alarmed) / widthOf(plain)).toBeCloseTo(tCritical(7, 0.99) / tCritical(7), 6);
    });

    it("doesn't tighten with the number of benchmarks in the run", () => {
      const [single] = analyzeRun(reportOf([alone], { render: SCALAR }));
      const [crowded] = analyzeRun(reportOf([alone, other], { render: SCALAR }));

      expect(widthOf(crowded)).toBe(widthOf(single));
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

describe("a benchmark's own alarms", () => {
  // Every round +10 on a mean of 105: about +9.5%, with no doubt about it.
  const { base, shifted } = drifting(10);
  function analyze(alarms: RunBenchmark['alarms'], metric = 'render') {
    const [analysis] = analyzeRun(
      reportOf(
        [
          {
            name: 'grid',
            file: 'grid.bench.tsx',
            kind: 'baseline',
            variants: ['current', 'baseline'],
            samples: { current: { [metric]: shifted }, baseline: { [metric]: base } },
            alarms,
          },
        ],
        { render: { kind: 'scalar', alarm: { error: 0.2 } } },
      ),
    );
    return analysis.metrics[0].comparisons[0];
  }

  it("uses the metric's alarm when the benchmark sets none", () => {
    expect(analyze(undefined).severity).toBe('none');
  });

  it("overrides the metric's band", () => {
    expect(analyze({ render: { error: 0.05 } })).toMatchObject({
      alarm: { error: 0.05 },
      severity: 'error',
    });
  });

  it('turns the alarm off with null', () => {
    expect(analyze({ render: null })).toMatchObject({ alarm: null, severity: 'none' });
  });

  it("applies a base metric's entry to its sub-series", () => {
    expect(analyze({ render: { error: 0.05 } }, 'render#rows').severity).toBe('error');
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
