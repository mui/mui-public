import { describe, expect, it } from 'vitest';
import { summarizeRun } from './summary';
import type { BenchmarkRunReport } from './schema';

const report: BenchmarkRunReport = {
  version: 2,
  generatedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 845_000,
  head: { sha: 'abc' },
  environment: { browser: 'Chromium', platform: 'linux', arch: 'x64', launchArgs: [] },
  builds: { current: { label: 'working tree' }, baseline: { sha: 'def', label: 'HEAD~1' } },
  metrics: { render: { kind: 'scalar', alarm: {} } },
  benchmarks: [
    {
      name: 'Grid scroll',
      file: 'grid.bench.tsx',
      kind: 'baseline',
      variants: ['current', 'baseline'],
      samples: {
        current: { render: [22, 24, 23, 25] },
        baseline: { render: [20, 22, 21, 23] },
      },
      sampling: { sampleSize: 4, timedOut: false },
      durationMs: 72_000,
    },
    {
      name: 'Chart zoom',
      file: 'chart.bench.tsx',
      kind: 'baseline',
      variants: ['current', 'baseline'],
      error: 'Render failed',
    },
  ],
};

describe('summarizeRun', () => {
  it('states the verdicts, without the samples behind them', () => {
    const summary = summarizeRun(report);

    expect(summary.durationMs).toBe(845_000);
    expect(summary.regressions).toEqual([
      expect.objectContaining({ benchmark: 'Grid scroll', metric: 'render', severity: 'error' }),
    ]);
    const [grid, chart] = summary.benchmarks;
    expect(grid).toMatchObject({
      name: 'Grid scroll',
      rounds: 4,
      timedOut: false,
      durationMs: 72_000,
    });
    expect(grid.metrics).toEqual([
      {
        metric: 'render',
        medians: { current: 23.5, baseline: 21.5 },
        comparisons: [
          expect.objectContaining({ subject: 'current', against: 'baseline', change: 'worse' }),
        ],
      },
    ]);
    expect(chart).toMatchObject({ name: 'Chart zoom', error: 'Render failed', metrics: [] });
    expect(JSON.stringify(summary)).not.toContain('"samples"');
  });
});
