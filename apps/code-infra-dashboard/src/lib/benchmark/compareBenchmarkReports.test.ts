import { describe, it, expect } from 'vitest';
import { compareBenchmarkReports } from './compareBenchmarkReports';
import type { BenchmarkReport, BenchmarkReportEntry } from './types';

function makeEntry(totalDuration: number, renderCount: number = 1): BenchmarkReportEntry {
  const perRender = renderCount > 0 ? totalDuration / renderCount : 0;
  return {
    iterations: 10,
    totalDuration,
    renders: Array.from({ length: renderCount }, (_unused, idx) => ({
      id: `render-${idx}`,
      phase: 'mount',
      startTime: 0,
      actualDuration: perRender,
      stdDev: 0,
      rawMean: perRender,
      rawStdDev: 0,
      outliers: 0,
    })),
    metrics: {},
  };
}

function makeReport(entries: Record<string, number>): BenchmarkReport {
  const report: BenchmarkReport = {};
  for (const [name, totalDuration] of Object.entries(entries)) {
    report[name] = makeEntry(totalDuration);
  }
  return report;
}

function makeReportFromConfig(
  entries: Record<string, { duration: number; renders: number }>,
): BenchmarkReport {
  const report: BenchmarkReport = {};
  for (const [name, { duration, renders }] of Object.entries(entries)) {
    report[name] = makeEntry(duration, renders);
  }
  return report;
}

describe('compareBenchmarkReports', () => {
  it('marks diffs within ±20% as neutral noise', () => {
    const result = compareBenchmarkReports(
      makeReport({ Button: 110 }),
      makeReport({ Button: 100 }),
    );
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.severity).toBe('neutral');
    expect(entry.duration.hint).toContain('Within noise');
  });

  it('flags diffs above +20% as regression', () => {
    const result = compareBenchmarkReports(
      makeReport({ Button: 130 }),
      makeReport({ Button: 100 }),
    );
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.severity).toBe('error');
    expect(entry.duration.hint).toContain('Regression');
  });

  it('flags diffs below -20% as improvement', () => {
    const result = compareBenchmarkReports(makeReport({ Button: 70 }), makeReport({ Button: 100 }));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.severity).toBe('success');
    expect(entry.duration.hint).toContain('Improvement');
  });

  it('treats an exactly-±20% diff as still within noise', () => {
    const positive = compareBenchmarkReports(
      makeReport({ Button: 120 }),
      makeReport({ Button: 100 }),
    );
    expect(positive.entries[0].duration.severity).toBe('neutral');

    const negative = compareBenchmarkReports(
      makeReport({ Button: 80 }),
      makeReport({ Button: 100 }),
    );
    expect(negative.entries[0].duration.severity).toBe('neutral');
  });

  it('returns a "New" neutral diff for entries absent in base', () => {
    const result = compareBenchmarkReports(makeReport({ Button: 100 }), makeReport({}));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.base).toBeNull();
    expect(entry.duration.severity).toBe('neutral');
    expect(entry.duration.hint).toBe('New');
  });

  it('preserves current: null for removed entries so markdown can render them', () => {
    const result = compareBenchmarkReports(makeReport({}), makeReport({ Button: 100 }));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.current).toBeNull();
    expect(entry.duration.base).toBe(100);
  });

  it('guards against division by zero when the base value is 0', () => {
    const result = compareBenchmarkReports(makeReport({ Button: 10 }), makeReport({ Button: 0 }));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.relativeDiff).toBe(0);
    expect(entry.duration.severity).toBe('neutral');
  });

  it('reports hasBase: false when no base report is provided', () => {
    const result = compareBenchmarkReports(makeReport({ Button: 100 }), null);
    expect(result.hasBase).toBe(false);
  });

  describe('sort order', () => {
    it('places render-count regressions ahead of duration-only regressions', () => {
      const currentReport = makeReportFromConfig({
        ExtraRenders: { duration: 105, renders: 3 },
        DurationRegression: { duration: 150, renders: 1 },
        Stable: { duration: 100, renders: 1 },
      });
      const baseReport = makeReportFromConfig({
        ExtraRenders: { duration: 100, renders: 1 },
        DurationRegression: { duration: 100, renders: 1 },
        Stable: { duration: 100, renders: 1 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['ExtraRenders', 'DurationRegression', 'Stable']);
    });

    it('breaks ties on render-count delta with |duration delta| desc', () => {
      const currentReport = makeReportFromConfig({
        ExtraRendersSmallDuration: { duration: 105, renders: 2 },
        ExtraRendersBigDuration: { duration: 150, renders: 2 },
      });
      const baseReport = makeReportFromConfig({
        ExtraRendersSmallDuration: { duration: 100, renders: 1 },
        ExtraRendersBigDuration: { duration: 100, renders: 1 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['ExtraRendersBigDuration', 'ExtraRendersSmallDuration']);
    });

    it('orders larger render-count regressions ahead of smaller ones', () => {
      const currentReport = makeReportFromConfig({
        PlusOne: { duration: 100, renders: 2 },
        PlusThree: { duration: 100, renders: 4 },
      });
      const baseReport = makeReportFromConfig({
        PlusOne: { duration: 100, renders: 1 },
        PlusThree: { duration: 100, renders: 1 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['PlusThree', 'PlusOne']);
    });

    it('ranks render-count improvements ahead of zero-render-delta rows', () => {
      const currentReport = makeReportFromConfig({
        FewerRenders: { duration: 100, renders: 1 },
        DurationRegression: { duration: 150, renders: 2 },
        Stable: { duration: 100, renders: 2 },
      });
      const baseReport = makeReportFromConfig({
        FewerRenders: { duration: 100, renders: 2 },
        DurationRegression: { duration: 100, renders: 2 },
        Stable: { duration: 100, renders: 2 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['FewerRenders', 'DurationRegression', 'Stable']);
    });
  });
});
