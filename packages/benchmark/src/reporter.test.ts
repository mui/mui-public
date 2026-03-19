import { describe, it, expect } from 'vitest';
import type { RenderEvent } from './types';
import { generateReportFromIterations } from './reporter';

function event(
  id: string,
  phase: RenderEvent['phase'],
  startTime: number,
  actualDuration: number,
): RenderEvent {
  return { id, phase, startTime, actualDuration };
}

describe('generateReportFromIterations', () => {
  it('returns empty renders for empty input', () => {
    expect(generateReportFromIterations([])).toEqual({
      iterations: 0,
      totalDuration: 0,
      renders: [],
    });
  });

  it('returns empty renders for inconsistent iteration lengths', () => {
    const iterations = [
      [event('App', 'mount', 0, 10)],
      [event('App', 'mount', 0, 10), event('App', 'update', 15, 5)],
    ];
    expect(generateReportFromIterations(iterations)).toEqual({
      iterations: 2,
      totalDuration: 0,
      renders: [],
    });
  });

  it('handles a single iteration with a single render', () => {
    const iterations = [[event('App', 'mount', 100, 10)]];
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
      [event('App', 'mount', 0, 10)],
      [event('App', 'mount', 0, 20)],
      [event('App', 'mount', 0, 30)],
    ];
    const report = generateReportFromIterations(iterations);

    expect(report.renders[0].actualDuration).toBe(20);
  });

  it('computes start times from mean gaps between renders', () => {
    // Two renders per iteration, with a gap between them
    // Iteration 1: render0 at 0 for 10ms, render1 at 15 for 5ms (gap = 5ms)
    // Iteration 2: render0 at 0 for 10ms, render1 at 13 for 5ms (gap = 3ms)
    const iterations = [
      [event('App', 'mount', 0, 10), event('App', 'update', 15, 5)],
      [event('App', 'mount', 0, 10), event('App', 'update', 13, 5)],
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
      [event('A', 'mount', 0, 10), event('B', 'mount', 12, 8), event('A', 'update', 25, 5)],
      [event('A', 'mount', 0, 12), event('B', 'mount', 14, 6), event('A', 'update', 22, 7)],
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
      [event('App', 'mount', 0, 10)],
      [event('App', 'mount', 0, 10)],
      [event('App', 'mount', 0, 10)],
      [event('App', 'mount', 0, 10)],
      [event('App', 'mount', 0, 1000)],
    ];
    const report = generateReportFromIterations(iterations);

    // Outlier (1000) should be removed, mean should be 10
    expect(report.renders[0].actualDuration).toBe(10);
    expect(report.renders[0].outliers).toBe(1);
  });
});
