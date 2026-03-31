import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { RenderEvent, IterationData } from './types';
import { generateReportFromIterations, BenchmarkReporter } from './reporter';
import * as uploadModule from './upload';

function event(
  id: string,
  phase: RenderEvent['phase'],
  startTime: number,
  actualDuration: number,
): RenderEvent {
  return { id, phase, startTime, actualDuration };
}

function iteration(renders: RenderEvent[], metrics: IterationData['metrics'] = []): IterationData {
  return { renders, metrics };
}

describe('generateReportFromIterations', () => {
  it('returns empty renders for empty input', () => {
    expect(generateReportFromIterations([])).toEqual({
      iterations: 0,
      totalDuration: 0,
      renders: [],
      metrics: {},
    });
  });

  it('returns empty renders for inconsistent iteration lengths', () => {
    const iterations = [
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 10), event('App', 'update', 15, 5)]),
    ];
    expect(generateReportFromIterations(iterations)).toEqual({
      iterations: 2,
      totalDuration: 0,
      renders: [],
      metrics: {},
    });
  });

  it('handles a single iteration with a single render', () => {
    const iterations = [iteration([event('App', 'mount', 100, 10)])];
    const report = generateReportFromIterations(iterations);

    expect(report.iterations).toBe(1);
    expect(report.totalDuration).toBe(10);
    expect(report.renders).toHaveLength(1);
    expect(report.renders[0]).toEqual(
      expect.objectContaining({
        id: 'App',
        phase: 'mount',
        startTime: 0,
        actualDuration: 10,
      }),
    );
  });

  it('averages durations across iterations', () => {
    const iterations = [
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 20)]),
      iteration([event('App', 'mount', 0, 30)]),
    ];
    const report = generateReportFromIterations(iterations);

    expect(report.renders[0].actualDuration).toBe(20);
  });

  it('computes start times from mean gaps between renders', () => {
    // Two renders per iteration, with a gap between them
    // Iteration 1: render0 at 0 for 10ms, render1 at 15 for 5ms (gap = 5ms)
    // Iteration 2: render0 at 0 for 10ms, render1 at 13 for 5ms (gap = 3ms)
    const iterations = [
      iteration([event('App', 'mount', 0, 10), event('App', 'update', 15, 5)]),
      iteration([event('App', 'mount', 0, 10), event('App', 'update', 13, 5)]),
    ];
    const report = generateReportFromIterations(iterations);

    expect(report.renders[0].startTime).toBe(0);
    expect(report.renders[0].actualDuration).toBe(10);
    // mean gap = (5 + 3) / 2 = 4
    // startTime[1] = 0 + 10 + 4 = 14
    expect(report.renders[1].startTime).toBe(14);
    expect(report.renders[1].actualDuration).toBe(5);
  });

  it('produces non-overlapping renders', () => {
    const iterations = [
      iteration([
        event('A', 'mount', 0, 10),
        event('B', 'mount', 12, 8),
        event('A', 'update', 25, 5),
      ]),
      iteration([
        event('A', 'mount', 0, 12),
        event('B', 'mount', 14, 6),
        event('A', 'update', 22, 7),
      ]),
    ];
    const report = generateReportFromIterations(iterations);

    for (let i = 1; i < report.renders.length; i += 1) {
      const prevEnd = report.renders[i - 1].startTime + report.renders[i - 1].actualDuration;
      expect(report.renders[i].startTime).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it('removes IQR outliers from durations', () => {
    // 4 normal values + 1 extreme outlier
    const iterations = [
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 1000)]),
    ];
    const report = generateReportFromIterations(iterations);

    // Outlier (1000) should be removed, mean should be 10
    expect(report.renders[0].actualDuration).toBe(10);
    expect(report.renders[0].outliers).toBe(1);
  });

  it('aggregates metrics across iterations', () => {
    const iterations = [
      iteration(
        [event('App', 'mount', 0, 10)],
        [
          { name: 'paint:bench', value: 60 },
          { name: 'paint:grid', value: 55 },
        ],
      ),
      iteration(
        [event('App', 'mount', 0, 10)],
        [
          { name: 'paint:bench', value: 64 },
          { name: 'paint:grid', value: 57 },
        ],
      ),
      iteration(
        [event('App', 'mount', 0, 10)],
        [
          { name: 'paint:bench', value: 62 },
          { name: 'paint:grid', value: 56 },
        ],
      ),
    ];
    const report = generateReportFromIterations(iterations);

    expect(report.metrics).toHaveProperty('paint:bench');
    expect(report.metrics).toHaveProperty('paint:grid');
    expect(report.metrics['paint:bench'].mean).toBeCloseTo(62, 0);
    expect(report.metrics['paint:grid'].mean).toBeCloseTo(56, 0);
    expect(report.metrics['paint:bench'].stdDev).toBeGreaterThanOrEqual(0);
    expect(report.metrics['paint:grid'].stdDev).toBeGreaterThanOrEqual(0);
    expect(report.metrics['paint:bench'].outliers).toBe(0);
  });

  it('returns empty metrics when no metrics are present', () => {
    const iterations = [
      iteration([event('App', 'mount', 0, 10)]),
      iteration([event('App', 'mount', 0, 12)]),
    ];
    const report = generateReportFromIterations(iterations);

    expect(report.metrics).toEqual({});
  });

  it('handles multiple metric identifiers with different counts', () => {
    const iterations = [
      iteration(
        [event('App', 'mount', 0, 10)],
        [
          { name: 'paint:bench', value: 60 },
          { name: 'paint:header', value: 50 },
        ],
      ),
      iteration([event('App', 'mount', 0, 10)], [{ name: 'paint:bench', value: 64 }]),
    ];
    const report = generateReportFromIterations(iterations);

    expect(report.metrics['paint:bench'].mean).toBeCloseTo(62, 0);
    // paint:header only has 1 data point
    expect(report.metrics['paint:header'].mean).toBe(50);
    expect(report.metrics['paint:header'].stdDev).toBe(0);
  });
});

function mockTestCase(options: {
  fullName: string;
  meta: Record<string, unknown>;
  state: string;
  errors?: Array<{ message: string }>;
}) {
  return {
    fullName: options.fullName,
    meta: () => options.meta,
    result: () => ({
      state: options.state,
      errors: options.errors,
    }),
  } as unknown as import('vitest/node').TestCase;
}

describe('BenchmarkReporter', () => {
  describe('onTestCaseResult', () => {
    it('surfaces failure even when iterations exist', () => {
      const reporter = new BenchmarkReporter({
        outputPath: path.join(os.tmpdir(), 'benchmark-test-results.json'),
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const iterations = [
        iteration([event('App', 'mount', 0, 10)]),
        iteration([event('App', 'mount', 0, 12)]),
      ];

      reporter.onTestCaseResult(
        mockTestCase({
          fullName: 'my benchmark',
          meta: { benchmarkIterations: iterations, benchmarkName: 'my benchmark' },
          state: 'failed',
          errors: [{ message: 'Iteration 1 render events differ from iteration 0' }],
        }),
      );

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      // Should still generate the report
      expect(output).toContain('my benchmark');

      consoleSpy.mockRestore();
    });

    it('sets hasFailures when a test case fails', async () => {
      const uploadSpy = vi.spyOn(uploadModule, 'uploadCiReport').mockResolvedValue();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new BenchmarkReporter({
        upload: true,
        outputPath: path.join(os.tmpdir(), 'benchmark-test-results.json'),
      });
      const iterations = [
        iteration([event('App', 'mount', 0, 10)]),
        iteration([event('App', 'mount', 0, 12)]),
      ];

      reporter.onTestCaseResult(
        mockTestCase({
          fullName: 'my benchmark',
          meta: { benchmarkIterations: iterations, benchmarkName: 'my benchmark' },
          state: 'failed',
          errors: [{ message: 'something went wrong' }],
        }),
      );

      await reporter.onTestRunEnd();

      expect(uploadSpy).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(output).toContain('Skipping upload');

      consoleSpy.mockRestore();
      uploadSpy.mockRestore();
    });

    it('uploads when all test cases pass', async () => {
      const uploadSpy = vi.spyOn(uploadModule, 'uploadCiReport').mockResolvedValue();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new BenchmarkReporter({
        upload: true,
        outputPath: path.join(os.tmpdir(), 'benchmark-test-results.json'),
      });
      const iterations = [
        iteration([event('App', 'mount', 0, 10)]),
        iteration([event('App', 'mount', 0, 12)]),
      ];

      reporter.onTestCaseResult(
        mockTestCase({
          fullName: 'my benchmark',
          meta: { benchmarkIterations: iterations, benchmarkName: 'my benchmark' },
          state: 'passed',
        }),
      );

      await reporter.onTestRunEnd();

      expect(uploadSpy).toHaveBeenCalledOnce();

      consoleSpy.mockRestore();
      uploadSpy.mockRestore();
    });

    it('prints in green for passing benchmarks with iterations', () => {
      const reporter = new BenchmarkReporter({
        outputPath: path.join(os.tmpdir(), 'benchmark-test-results.json'),
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const iterations = [
        iteration([event('App', 'mount', 0, 10)]),
        iteration([event('App', 'mount', 0, 12)]),
      ];

      reporter.onTestCaseResult(
        mockTestCase({
          fullName: 'my benchmark',
          meta: { benchmarkIterations: iterations, benchmarkName: 'my benchmark' },
          state: 'passed',
        }),
      );

      const output = consoleSpy.mock.calls.map((call) => call[0]).join('\n');

      expect(output).toContain('my benchmark');

      consoleSpy.mockRestore();
    });
  });
});
