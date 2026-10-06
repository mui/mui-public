import { describe, expect, it } from 'vitest';
import { analyzeRun } from './analyzeRun';
import { benchmarkTable, runReportFootnote } from './format';
import type { BenchmarkRunReport, RunBenchmark } from './schema';

function reportOf(benchmarks: RunBenchmark[]): BenchmarkRunReport {
  return {
    version: 2,
    generatedAt: '2026-01-01T00:00:00.000Z',
    head: { sha: 'abc' },
    environment: { browser: 'Chromium', platform: 'linux', arch: 'x64', launchArgs: [] },
    builds: { current: { label: 'working tree' }, baseline: { sha: 'def', label: 'HEAD~1' } },
    metrics: { render: { kind: 'scalar', alarm: {} } },
    benchmarks,
  };
}

function benchmarkOf(name: string): RunBenchmark {
  return {
    name,
    file: `${name}.bench.tsx`,
    kind: 'baseline',
    variants: ['current', 'baseline'],
    samples: { current: { render: [1, 3, 2, 4] }, baseline: { render: [2, 2, 2, 2] } },
  };
}

describe('benchmarkTable', () => {
  it('puts the baseline before the current build, so a row reads old to new', () => {
    const [analysis] = analyzeRun(reportOf([benchmarkOf('a')]));
    const { columns, rows } = benchmarkTable(analysis);

    expect(columns.map((column) => column.header)).toEqual([
      'Metric',
      'baseline',
      'current',
      'Δ vs baseline',
    ]);
    expect(rows[0].cells.slice(1, 3)).toEqual(['2', '2.5']);
  });

  it('keeps the reference first for compared cases', () => {
    const [analysis] = analyzeRun(
      reportOf([
        {
          name: 'libs',
          file: 'libs.bench.tsx',
          kind: 'compare',
          variants: ['ours', 'theirs'],
          samples: { ours: { render: [1, 1] }, theirs: { render: [2, 2] } },
        },
      ]),
    );

    expect(benchmarkTable(analysis).columns.map((column) => column.header)).toEqual([
      'Metric',
      'ours',
      'theirs',
      'theirs vs ours',
    ]);
  });

  it('shows an unchanged comparison without an interval', () => {
    const [analysis] = analyzeRun(
      reportOf([
        {
          ...benchmarkOf('a'),
          samples: { current: { render: [2, 2] }, baseline: { render: [2, 2] } },
        },
      ]),
    );

    expect(benchmarkTable(analysis).rows[0].cells.at(-1)).toBe('unchanged');
  });
});

describe('runReportFootnote', () => {
  it('states one level when at most one comparison can raise an alarm', () => {
    expect(runReportFootnote(analyzeRun(reportOf([benchmarkOf('a')])))).toContain(
      'Each Δ is a 95% confidence interval',
    );
  });

  it('states the level the alarmed comparisons share', () => {
    const footnote = runReportFootnote(
      analyzeRun(
        reportOf([benchmarkOf('a'), benchmarkOf('b'), benchmarkOf('c'), benchmarkOf('d')]),
      ),
    );
    expect(footnote).toContain('98.75% where a change can raise an alarm');
    expect(footnote).toContain('95% for the rest');
  });
});
