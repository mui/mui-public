import { describe, it, expect } from 'vitest';
import { computeNoisiestTests } from './computeNoisiestTests';
import type { BenchmarkReport, RenderStats } from './types';

function makeRender(
  id: string,
  actualDuration: number,
  phase: RenderStats['phase'] = 'mount',
): RenderStats {
  return {
    id,
    phase,
    startTime: 0,
    actualDuration,
    stdDev: 0,
    rawMean: actualDuration,
    rawStdDev: 0,
    outliers: 0,
  };
}

function makeReport(entries: Record<string, RenderStats[]>): BenchmarkReport {
  const report: BenchmarkReport = {};
  for (const [name, renders] of Object.entries(entries)) {
    report[name] = {
      iterations: 1,
      totalDuration: 0,
      renders,
      metrics: {},
    };
  }
  return report;
}

function buildReports(
  series: Record<string, number[]>,
  phase: RenderStats['phase'] = 'mount',
): BenchmarkReport[] {
  const length = Math.max(...Object.values(series).map((values) => values.length));
  const reports: BenchmarkReport[] = [];
  for (let index = 0; index < length; index += 1) {
    const entries: Record<string, RenderStats[]> = {};
    for (const [key, values] of Object.entries(series)) {
      const value = values[index];
      if (value === undefined) {
        continue;
      }
      const [entryName, renderId] = key.split('|');
      if (!entries[entryName]) {
        entries[entryName] = [];
      }
      entries[entryName].push(makeRender(renderId, value, phase));
    }
    reports.push(makeReport(entries));
  }
  return reports;
}

describe('computeNoisiestTests', () => {
  it('ranks tests by CV descending', () => {
    const reports = buildReports({
      'Widget|root': [10, 10.1, 9.9, 10.05], // very stable, CV ~= 0.008
      'Widget|child': [10, 15, 5, 12], // moderate
      'Widget|wild': [5, 25, 2, 40], // noisy
    });

    const rows = computeNoisiestTests(reports);

    expect(rows.map((row) => row.name)).toEqual([
      'Widget / wild:mount',
      'Widget / child:mount',
      'Widget / root:mount',
    ]);
    expect(rows[0].cv).toBeGreaterThan(rows[1].cv);
    expect(rows[1].cv).toBeGreaterThan(rows[2].cv);
  });

  it('skips tests with fewer than 3 samples', () => {
    const reports = buildReports({
      'Widget|short': [10, 20], // skipped
      'Widget|long': [10, 12, 11, 13],
    });

    const rows = computeNoisiestTests(reports);

    expect(rows.map((row) => row.name)).toEqual(['Widget / long:mount']);
  });

  it('skips tests whose mean is zero', () => {
    const reports = buildReports({
      'Widget|zero': [0, 0, 0, 0],
      'Widget|nonzero': [1, 2, 3, 4],
    });

    const rows = computeNoisiestTests(reports);

    expect(rows.map((row) => row.name)).toEqual(['Widget / nonzero:mount']);
  });

  it('respects the topN limit', () => {
    const series: Record<string, number[]> = {};
    for (let index = 0; index < 5; index += 1) {
      series[`Widget|item${index}`] = [1, 1 + index, 1, 1 + index];
    }

    const rows = computeNoisiestTests(buildReports(series), 2);

    expect(rows).toHaveLength(2);
  });

  it('skips null reports (gaps in the timeline)', () => {
    const reports: (BenchmarkReport | null)[] = [
      makeReport({ Widget: [makeRender('root', 10)] }),
      null,
      makeReport({ Widget: [makeRender('root', 12)] }),
      makeReport({ Widget: [makeRender('root', 11)] }),
    ];

    const rows = computeNoisiestTests(reports);

    expect(rows).toHaveLength(1);
    expect(rows[0].runs).toBe(3);
    expect(rows[0].mean).toBeCloseTo(11, 5);
  });

  it('breaks ties deterministically by stdDev then name', () => {
    // Two series with identical CV: the one with higher stdDev wins, then name.
    const reports = buildReports({
      'Widget|beta': [10, 20, 30], // mean 20, stdDev 10, CV 0.5
      'Widget|alpha': [10, 20, 30], // identical
      'Widget|small': [1, 2, 3], // mean 2, stdDev 1, CV 0.5
    });

    const rows = computeNoisiestTests(reports);

    expect(rows.map((row) => row.name)).toEqual([
      'Widget / alpha:mount',
      'Widget / beta:mount',
      'Widget / small:mount',
    ]);
  });

  it('separates renders with the same id but different phases', () => {
    const reports: BenchmarkReport[] = [
      makeReport({
        Widget: [makeRender('root', 10, 'mount'), makeRender('root', 20, 'update')],
      }),
      makeReport({
        Widget: [makeRender('root', 12, 'mount'), makeRender('root', 30, 'update')],
      }),
      makeReport({
        Widget: [makeRender('root', 11, 'mount'), makeRender('root', 25, 'update')],
      }),
    ];

    const rows = computeNoisiestTests(reports);

    expect(rows.map((row) => row.name).sort()).toEqual([
      'Widget / root:mount',
      'Widget / root:update',
    ]);
  });
});
