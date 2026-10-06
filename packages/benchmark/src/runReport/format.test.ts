import { describe, expect, it } from 'vitest';
import { analyzeRun } from './analyzeRun';
import { runReportFootnote } from './format';
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
