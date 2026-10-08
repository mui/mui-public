import { describe, expect, it } from 'vitest';
import { analyzeRun } from './analyzeRun';
import {
  benchmarkTable,
  formatDuration,
  formatRounds,
  formatRunSummary,
  runReportFootnote,
} from './format';
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

describe('formatDuration', () => {
  it('reads at a glance from milliseconds to hours', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(185_000)).toBe('3m 05s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
  });
});

describe('formatRounds', () => {
  it('says how long a benchmark took next to its rounds', () => {
    expect(formatRounds({ ...benchmarkOf('a'), durationMs: 72_000 })).toBe('4 rounds · 1m 12s');
  });
});

describe('formatRunSummary', () => {
  it('ends with how long the run took', () => {
    expect(formatRunSummary(analyzeRun(reportOf([benchmarkOf('a')])), [], 845_000)).toBe(
      '1 benchmark measured · no regressions · ran 14m 05s',
    );
  });
});

describe('runReportFootnote', () => {
  it('states one level when nothing can raise an alarm', () => {
    const report = {
      ...reportOf([benchmarkOf('a')]),
      metrics: { render: { kind: 'scalar' as const } },
    };
    expect(runReportFootnote(analyzeRun(report))).toBe(
      'Medians; Δ is the confidence interval of the paired per-round difference (95%).',
    );
  });

  it('states the alarmed level beside the other', () => {
    expect(runReportFootnote(analyzeRun(reportOf([benchmarkOf('a')])))).toContain(
      '(99% for alarmed metrics, 95% otherwise)',
    );
  });
});
