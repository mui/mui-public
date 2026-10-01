import { describe, expect, it } from 'vitest';
import type { BenchmarkRunReport, RunBenchmark } from '@mui/internal-benchmark/runReport';
import { buildBenchmarkRunMarkdownReport } from './buildMarkdownReport';

const MS = { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 } as const;

function reportOf(benchmarks: RunBenchmark[]): BenchmarkRunReport {
  return {
    version: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    head: { sha: 'abc' },
    environment: { browser: 'Chromium 151', platform: 'linux', arch: 'x64', launchArgs: [] },
    sampling: { warmup: 2 },
    builds: { current: { label: 'working tree' }, baseline: { sha: 'def', label: 'HEAD~1' } },
    metrics: {
      render: { kind: 'scalar', format: MS, alarm: {} },
      'bench:paint': { kind: 'scalar', format: MS },
    },
    benchmarks,
  };
}

const unchanged: RunBenchmark = {
  name: 'Button mount',
  file: 'button.bench.tsx',
  kind: 'baseline',
  variants: ['current', 'baseline'],
  samples: {
    current: { render: [10, 11, 10, 11] },
    baseline: { render: [11, 10, 11, 10] },
  },
};

const slower: RunBenchmark = {
  name: 'Grid scroll',
  file: 'grid.bench.tsx',
  kind: 'baseline',
  variants: ['current', 'baseline'],
  samples: {
    current: { render: [22, 24, 23, 25], 'bench:paint': [30, 31, 30, 31] },
    baseline: { render: [20, 22, 21, 23], 'bench:paint': [30, 31, 30, 31] },
  },
  sampling: { sampleSize: 3, timedOut: true },
};

const libraries: RunBenchmark = {
  name: 'libs / mount',
  file: 'libs.bench.tsx',
  kind: 'compare',
  variants: ['ours', 'theirs'],
  samples: { ours: { render: [10, 10, 10, 10] }, theirs: { render: [20, 21, 20, 21] } },
};

const broken: RunBenchmark = {
  name: 'Chart zoom',
  file: 'chart.bench.tsx',
  kind: 'baseline',
  variants: ['current', 'baseline'],
  error: 'Render failed',
};

describe('buildBenchmarkRunMarkdownReport', () => {
  it('states nothing but the summary when no benchmark regressed', () => {
    const markdown = buildBenchmarkRunMarkdownReport(reportOf([unchanged]), {
      title: 'Performance',
    });

    expect(markdown.split('\n').slice(0, 3)).toEqual([
      '## Performance',
      '',
      '1 benchmark measured · no regressions',
    ]);
  });

  it('lists regressions above the collapsed results, and marks the heading', () => {
    expect(
      buildBenchmarkRunMarkdownReport(reportOf([slower, libraries, broken]), {
        title: 'Performance',
      }),
    ).toMatchInlineSnapshot(`
      "## Performance ⚠️

      🔴 **Grid scroll** · render · \`worse +9.3% – +9.3%\`

      2 benchmarks measured · 1 with regressions · 1 timed out · 1 failed

      ❌ **Chart zoom**: Render failed

      <details>
      <summary>Full results</summary>

      **Grid scroll** · 3 + 1 rounds · timed out

      | Metric | current | baseline | Δ vs baseline |
      |:----------|----------:|----------:|:----------|
      | render | 23.5 ms | 21.5 ms | \`worse +9.3% – +9.3%\` |
      | bench:paint | 30.5 ms | 30.5 ms | \`unsure +0.0% – +0.0%\` |


      **libs / mount** · 4 rounds

      | Metric | ours | theirs | theirs vs ours |
      |:----------|----------:|----------:|:----------|
      | render | 10 ms | 20.5 ms | \`worse +95.8% – +114.2%\` |


      _Each value is a median. Each Δ is a 95% confidence interval on the paired per-round difference, relative to the variant it is measured against; "unsure" means it straddles zero — the expected result for two equivalent builds._

      </details>"
    `);
  });

  it('does not count a difference between libraries as a regression', () => {
    const markdown = buildBenchmarkRunMarkdownReport(reportOf([libraries]), {
      title: 'Performance',
    });

    expect(markdown).toContain('no regressions');
    expect(markdown).not.toContain('🔴');
  });

  it('links the full run when given where it is', () => {
    const markdown = buildBenchmarkRunMarkdownReport(reportOf([unchanged]), {
      title: 'Performance',
      detailsUrl: 'https://example.com/run',
    });

    expect(markdown).toContain('[See the full run](https://example.com/run)');
  });
});
