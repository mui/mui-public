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

function makeReportFromRenders(entries: Record<string, RenderStats[]>): BenchmarkReport {
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

function makeReportFromTotals(entries: Record<string, number>): BenchmarkReport {
  const report: BenchmarkReport = {};
  for (const [name, totalDuration] of Object.entries(entries)) {
    report[name] = {
      iterations: 1,
      totalDuration,
      renders: [],
      metrics: {},
    };
  }
  return report;
}

function buildTotalDurationReports(series: Record<string, number[]>): BenchmarkReport[] {
  const length = Math.max(...Object.values(series).map((values) => values.length));
  const reports: BenchmarkReport[] = [];
  for (let index = 0; index < length; index += 1) {
    const entries: Record<string, number> = {};
    for (const [name, values] of Object.entries(series)) {
      const value = values[index];
      if (value !== undefined) {
        entries[name] = value;
      }
    }
    reports.push(makeReportFromTotals(entries));
  }
  return reports;
}

function buildPerRenderReports(
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
    reports.push(makeReportFromRenders(entries));
  }
  return reports;
}

describe('computeNoisiestTests', () => {
  describe('totalDuration mode (default)', () => {
    it('ranks tests by CV of totalDuration, descending', () => {
      const reports = buildTotalDurationReports({
        Stable: [10, 10.1, 9.9, 10.05],
        Moderate: [10, 15, 5, 12],
        Wild: [5, 25, 2, 40],
      });

      const rows = computeNoisiestTests(reports);

      expect(rows.map((row) => row.name)).toEqual(['Wild', 'Moderate', 'Stable']);
      expect(rows[0].cv).toBeGreaterThan(rows[1].cv);
      expect(rows[1].cv).toBeGreaterThan(rows[2].cv);
    });

    it('skips tests with fewer than 2 samples', () => {
      const reports = buildTotalDurationReports({
        Single: [10],
        Pair: [10, 20],
      });

      const rows = computeNoisiestTests(reports);

      expect(rows.map((row) => row.name)).toEqual(['Pair']);
    });

    it('computes CV from exactly 2 samples', () => {
      const reports = buildTotalDurationReports({
        Widget: [10, 20],
      });

      const rows = computeNoisiestTests(reports);

      expect(rows).toHaveLength(1);
      expect(rows[0].runs).toBe(2);
      expect(rows[0].mean).toBeCloseTo(15, 5);
      // Sample stdDev with n-1 divisor: |20-10|/sqrt(2).
      expect(rows[0].stdDev).toBeCloseTo(10 / Math.SQRT2, 5);
      expect(rows[0].cv).toBeCloseTo(10 / Math.SQRT2 / 15, 5);
    });

    it('skips tests whose mean is zero', () => {
      const reports = buildTotalDurationReports({
        Zero: [0, 0, 0, 0],
        Nonzero: [1, 2, 3, 4],
      });

      const rows = computeNoisiestTests(reports);

      expect(rows.map((row) => row.name)).toEqual(['Nonzero']);
    });

    it('respects the topN limit', () => {
      const series: Record<string, number[]> = {};
      for (let index = 0; index < 5; index += 1) {
        series[`Test${index}`] = [1, 1 + index, 1, 1 + index];
      }

      const rows = computeNoisiestTests(buildTotalDurationReports(series), 'totalDuration', 2);

      expect(rows).toHaveLength(2);
    });

    it('skips null reports (gaps in the timeline)', () => {
      const reports: (BenchmarkReport | null)[] = [
        makeReportFromTotals({ Widget: 10 }),
        null,
        makeReportFromTotals({ Widget: 12 }),
        makeReportFromTotals({ Widget: 11 }),
      ];

      const rows = computeNoisiestTests(reports);

      expect(rows).toHaveLength(1);
      expect(rows[0].runs).toBe(3);
      expect(rows[0].mean).toBeCloseTo(11, 5);
    });

    it('breaks ties deterministically by stdDev then name', () => {
      const reports = buildTotalDurationReports({
        Beta: [10, 20, 30], // mean 20, stdDev 10, CV 0.5
        Alpha: [10, 20, 30], // identical
        Small: [1, 2, 3], // mean 2, stdDev 1, CV 0.5
      });

      const rows = computeNoisiestTests(reports);

      expect(rows.map((row) => row.name)).toEqual(['Alpha', 'Beta', 'Small']);
    });
  });

  describe('perRender mode', () => {
    it('keys samples by test, render id and phase', () => {
      // eslint-disable-next-line testing-library/render-result-naming-convention -- not an RTL render call
      const reports = buildPerRenderReports({
        'Widget|root': [10, 10.1, 9.9, 10.05],
        'Widget|child': [10, 15, 5, 12],
        'Widget|wild': [5, 25, 2, 40],
      });

      const rows = computeNoisiestTests(reports, 'perRender');

      expect(rows.map((row) => row.name)).toEqual([
        'Widget / wild:mount',
        'Widget / child:mount',
        'Widget / root:mount',
      ]);
    });

    it('distinguishes repeated (id, phase) pairs within a test by occurrence order', () => {
      const reports: BenchmarkReport[] = [
        makeReportFromRenders({
          Widget: [
            makeRender('root', 10, 'mount'),
            makeRender('root', 20, 'update'),
            makeRender('root', 30, 'update'),
          ],
        }),
        makeReportFromRenders({
          Widget: [
            makeRender('root', 11, 'mount'),
            makeRender('root', 22, 'update'),
            makeRender('root', 35, 'update'),
          ],
        }),
        makeReportFromRenders({
          Widget: [
            makeRender('root', 12, 'mount'),
            makeRender('root', 21, 'update'),
            makeRender('root', 33, 'update'),
          ],
        }),
      ];

      const rows = computeNoisiestTests(reports, 'perRender');

      expect(rows.map((row) => row.name).sort()).toEqual([
        'Widget / root:mount',
        'Widget / root:update',
        'Widget / root:update#2',
      ]);
      const firstUpdate = rows.find((row) => row.name === 'Widget / root:update');
      const secondUpdate = rows.find((row) => row.name === 'Widget / root:update#2');
      expect(firstUpdate?.mean).toBeCloseTo(21, 5);
      expect(secondUpdate?.mean).toBeCloseTo((30 + 35 + 33) / 3, 5);
    });

    it('separates renders with the same id but different phases', () => {
      const reports: BenchmarkReport[] = [
        makeReportFromRenders({
          Widget: [makeRender('root', 10, 'mount'), makeRender('root', 20, 'update')],
        }),
        makeReportFromRenders({
          Widget: [makeRender('root', 12, 'mount'), makeRender('root', 30, 'update')],
        }),
        makeReportFromRenders({
          Widget: [makeRender('root', 11, 'mount'), makeRender('root', 25, 'update')],
        }),
      ];

      const rows = computeNoisiestTests(reports, 'perRender');

      expect(rows.map((row) => row.name).sort()).toEqual([
        'Widget / root:mount',
        'Widget / root:update',
      ]);
    });
  });
});
