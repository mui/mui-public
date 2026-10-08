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

const faster: RunBenchmark = {
  name: 'Tooltip mount',
  file: 'tooltip.bench.tsx',
  kind: 'baseline',
  variants: ['current', 'baseline'],
  samples: {
    current: { render: [5, 6, 5, 6], 'bench:paint': [20, 22, 21, 23] },
    baseline: { render: [10, 11, 10, 11], 'bench:paint': [30, 31, 30, 31] },
  },
};

describe('buildBenchmarkRunMarkdownReport', () => {
  it('is a single line when nothing needs attention', () => {
    expect(
      buildBenchmarkRunMarkdownReport(reportOf([unchanged, libraries]), { title: 'Performance' }),
    ).toBe('## Performance\n\nNo regressions in 2 benchmarks');
  });

  it('names improvements on alarmed metrics in that line, and leaves informational ones out', () => {
    const markdown = buildBenchmarkRunMarkdownReport(reportOf([faster]), { title: 'Performance' });

    expect(markdown.split('\n')).toHaveLength(3);
    expect(markdown).toContain('**Tooltip mount** render `better');
    expect(markdown).not.toContain('bench:paint');
  });

  it('tables only the rows that regressed, and marks the heading', () => {
    expect(
      buildBenchmarkRunMarkdownReport(reportOf([slower, libraries, broken]), {
        title: 'Performance',
      }),
    ).toMatchInlineSnapshot(`
      "## Performance ⚠️

      1 regression in 2 benchmarks

      ❌ **Chart zoom**: Render failed

      **Grid scroll**

      | Metric | baseline | current | Δ vs baseline |
      |:----------|----------:|----------:|:----------|
      | render | 21.5 ms | 23.5 ms | 🔴 \`worse +9.3% – +9.3%\` |


      _Medians; Δ is the confidence interval of the paired per-round difference (95%)._"
    `);
  });

  it('does not count a difference between libraries as a regression', () => {
    const markdown = buildBenchmarkRunMarkdownReport(reportOf([libraries]), {
      title: 'Performance',
    });

    expect(markdown).toContain('No regressions');
    expect(markdown).not.toContain('libs / mount');
  });

  it('links the full run when given where it is', () => {
    const markdown = buildBenchmarkRunMarkdownReport(reportOf([unchanged]), {
      title: 'Performance',
      detailsUrl: 'https://example.com/run',
    });

    expect(markdown).toContain('[details](https://example.com/run)');
  });
});
