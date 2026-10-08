import { describe, expect, it } from 'vitest';
import { analyzeRun } from './analyzeRun';
import {
  benchmarkTable,
  formatDuration,
  formatPrecisionDetail,
  precisionTone,
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
  it('states the level every interval uses', () => {
    expect(runReportFootnote(analyzeRun(reportOf([benchmarkOf('a')])))).toBe(
      'Medians; Δ is the confidence interval of the paired per-round difference (99%).',
    );
  });
});

describe('precision', () => {
  // Per-round differences of 1, -2, 3, 0, 2, -1, 4, 1 on a baseline of 100: a standard deviation
  // of 2, so 2% noise per round, and a 99% half-width of about 2.5% over 8 rounds.
  function analysisWith(alarm: { error?: number }, kind: 'baseline' | 'compare' = 'baseline') {
    const report: BenchmarkRunReport = {
      ...reportOf([
        {
          ...benchmarkOf('a'),
          kind,
          samples: {
            current: { render: [101, 98, 103, 100, 102, 99, 104, 101] },
            baseline: { render: [100, 100, 100, 100, 100, 100, 100, 100] },
          },
        },
      ]),
      metrics: { render: { kind: 'scalar', alarm } },
    };
    const [analysis] = analyzeRun(report);
    return { analysis, comparison: analysis.metrics[0].comparisons[0] };
  }

  it('adds a column of half-widths to the table when asked', () => {
    const { analysis } = analysisWith({ error: 0.05 });
    const { columns, rows } = benchmarkTable(analysis, { precision: true });

    expect(columns.at(-1)).toEqual({ header: 'Precision', kind: 'precision', comparison: 0 });
    expect(rows[0].cells.at(-1)).toBe('±2.5%');
    expect(benchmarkTable(analysis).columns.map((column) => column.kind)).not.toContain(
      'precision',
    );
  });

  it('is an error once it is wider than the error band', () => {
    expect(precisionTone(analysisWith({ error: 0.05 }).comparison)).toBe('none');
    expect(precisionTone(analysisWith({ error: 0.02 }).comparison)).toBe('error');
  });

  it('is never judged without bands, or where no change can raise an alarm', () => {
    expect(precisionTone(analysisWith({}).comparison)).toBe('none');
    expect(precisionTone(analysisWith({ error: 0.01 }, 'compare').comparison)).toBe('none');
  });

  it('gives the per-round noise, and the rounds it takes to resolve the error band', () => {
    const { analysis, comparison } = analysisWith({ error: 0.02 });
    expect(formatPrecisionDetail(comparison, analysis.metrics[0].definition)).toBe(
      '±2.0% per round · about 7 rounds resolve ±2%',
    );
  });
});
