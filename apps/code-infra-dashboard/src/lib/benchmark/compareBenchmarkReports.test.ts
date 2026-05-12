import { describe, it, expect } from 'vitest';
import { compareBenchmarkReports } from './compareBenchmarkReports';
import { makeReport, makeReportFromConfig } from './test-fixtures';

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

  it('omits the renderCount diff for new entries so they do not look like regressions', () => {
    const result = compareBenchmarkReports(makeReport({ Button: 100 }), makeReport({}));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.renderCount).toBeUndefined();
  });

  it('preserves current: null for removed entries so markdown can render them', () => {
    const result = compareBenchmarkReports(makeReport({}), makeReport({ Button: 100 }));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.duration.current).toBeNull();
    expect(entry.duration.base).toBe(100);
  });

  it('omits the renderCount diff for removed entries so they do not look like improvements', () => {
    const result = compareBenchmarkReports(makeReport({}), makeReport({ Button: 100 }));
    const entry = result.entries.find((item) => item.name === 'Button')!;
    expect(entry.renderCount).toBeUndefined();
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

    it('tie-breaks equal render-count regressions by duration severity', () => {
      const currentReport = makeReportFromConfig({
        ExtraRendersDurationWithinNoise: { duration: 105, renders: 2 },
        ExtraRendersDurationRegression: { duration: 150, renders: 2 },
      });
      const baseReport = makeReportFromConfig({
        ExtraRendersDurationWithinNoise: { duration: 100, renders: 1 },
        ExtraRendersDurationRegression: { duration: 100, renders: 1 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['ExtraRendersDurationRegression', 'ExtraRendersDurationWithinNoise']);
    });

    it('tie-breaks equal render-count regressions with equal duration severity by |duration delta|', () => {
      const currentReport = makeReportFromConfig({
        SmallDurationDelta: { duration: 125, renders: 2 },
        BigDurationDelta: { duration: 150, renders: 2 },
      });
      const baseReport = makeReportFromConfig({
        SmallDurationDelta: { duration: 100, renders: 1 },
        BigDurationDelta: { duration: 100, renders: 1 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['BigDurationDelta', 'SmallDurationDelta']);
    });

    it('keeps new entries from outranking real render-count regressions', () => {
      const currentReport = makeReportFromConfig({
        BrandNew: { duration: 100, renders: 3 },
        ExtraRenders: { duration: 100, renders: 3 },
      });
      const baseReport = makeReportFromConfig({
        ExtraRenders: { duration: 100, renders: 1 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['ExtraRenders', 'BrandNew']);
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
