import { describe, it, expect } from 'vitest';
import { compareBenchmarkReports } from './compareBenchmarkReports';
import type { BenchmarkReport, BenchmarkReportEntry, MetricDefinition } from './types';
import { makeReport, makeReportFromConfig } from './test-fixtures';

function reportWithMetrics(metrics: Record<string, number>): BenchmarkReport {
  const entry: BenchmarkReportEntry = {
    iterations: 10,
    totalDuration: 0,
    renders: [],
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([name, mean]) => [name, { mean, stdDev: 0, outliers: 0 }]),
    ),
  };
  return { Bench: entry };
}

const definitions: Record<string, MetricDefinition> = {
  scalar_alarm: { kind: 'scalar', alarm: { direction: 'lowerIsBetter', error: 0.1 } },
  scalar_tiered: { kind: 'scalar', alarm: { direction: 'lowerIsBetter', warn: 0.1, error: 0.25 } },
  scalar_higher: { kind: 'scalar', alarm: { direction: 'higherIsBetter', error: 0.1 } },
  scalar_info: { kind: 'scalar', format: { style: 'unit', unit: 'byte' } },
  discrete_alarm: { kind: 'discrete', alarm: { direction: 'lowerIsBetter' } },
  discrete_tiered: { kind: 'discrete', alarm: { direction: 'lowerIsBetter', warn: 1, error: 3 } },
};

function metricEntry(current: BenchmarkReport, base: BenchmarkReport, metricName: string) {
  const result = compareBenchmarkReports(current, base, definitions);
  return result.entries[0].metrics.find((metric) => metric.name === metricName)!;
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

    it('ranks render-count improvements ahead of stable rows', () => {
      const currentReport = makeReportFromConfig({
        FewerRenders: { duration: 100, renders: 1 },
        Stable: { duration: 100, renders: 2 },
      });
      const baseReport = makeReportFromConfig({
        FewerRenders: { duration: 100, renders: 2 },
        Stable: { duration: 100, renders: 2 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['FewerRenders', 'Stable']);
    });

    it('ranks duration regressions ahead of render-count improvements', () => {
      const currentReport = makeReportFromConfig({
        FewerRenders: { duration: 100, renders: 1 },
        DurationRegression: { duration: 150, renders: 2 },
      });
      const baseReport = makeReportFromConfig({
        FewerRenders: { duration: 100, renders: 2 },
        DurationRegression: { duration: 100, renders: 2 },
      });
      const result = compareBenchmarkReports(currentReport, baseReport);
      const order = result.entries.map((item) => item.name);
      expect(order).toEqual(['DurationRegression', 'FewerRenders']);
    });
  });

  describe('custom metrics', () => {
    it('keeps an informational metric (no alarm) neutral even on a large change', () => {
      const metric = metricEntry(
        reportWithMetrics({ scalar_info: 200 }),
        reportWithMetrics({ scalar_info: 100 }),
        'scalar_info',
      );
      expect(metric.diff.severity).toBe('neutral');
      expect(metric.format).toEqual({ style: 'unit', unit: 'byte' });
    });

    it('flags a scalar alarm regression beyond its error band', () => {
      const metric = metricEntry(
        reportWithMetrics({ scalar_alarm: 120 }), // +20%, error band is 10%
        reportWithMetrics({ scalar_alarm: 100 }),
        'scalar_alarm',
      );
      expect(metric.diff.severity).toBe('error');
      expect(metric.diff.hint).toContain('Regression');
    });

    it('flags a scalar regression between warn and error bands as a warning', () => {
      const metric = metricEntry(
        reportWithMetrics({ scalar_tiered: 115 }), // +15%: past warn (10%), within error (25%)
        reportWithMetrics({ scalar_tiered: 100 }),
        'scalar_tiered',
      );
      expect(metric.diff.severity).toBe('warning');
      expect(metric.diff.hint).toContain('Warning');
    });

    it('escalates a scalar regression past the error band to error', () => {
      const metric = metricEntry(
        reportWithMetrics({ scalar_tiered: 130 }), // +30%: past error (25%)
        reportWithMetrics({ scalar_tiered: 100 }),
        'scalar_tiered',
      );
      expect(metric.diff.severity).toBe('error');
    });

    it('keeps a scalar change within the warn band neutral', () => {
      const metric = metricEntry(
        reportWithMetrics({ scalar_tiered: 105 }), // +5%: within warn
        reportWithMetrics({ scalar_tiered: 100 }),
        'scalar_tiered',
      );
      expect(metric.diff.severity).toBe('neutral');
    });

    it('tiers discrete metrics by absolute count delta, inclusive of the band', () => {
      const warn = metricEntry(
        reportWithMetrics({ discrete_tiered: 4 }), // +1: meets warn (1), below error (3)
        reportWithMetrics({ discrete_tiered: 3 }),
        'discrete_tiered',
      );
      expect(warn.diff.severity).toBe('warning');

      const error = metricEntry(
        reportWithMetrics({ discrete_tiered: 6 }), // +3: meets error (3)
        reportWithMetrics({ discrete_tiered: 3 }),
        'discrete_tiered',
      );
      expect(error.diff.severity).toBe('error');
    });

    it('honors higherIsBetter so an increase is an improvement', () => {
      const metric = metricEntry(
        reportWithMetrics({ scalar_higher: 120 }),
        reportWithMetrics({ scalar_higher: 100 }),
        'scalar_higher',
      );
      expect(metric.diff.severity).toBe('success');
      expect(metric.diff.hint).toContain('Improvement');
    });

    it('compares discrete alarms exactly — any change is flagged', () => {
      const metric = metricEntry(
        reportWithMetrics({ discrete_alarm: 4 }),
        reportWithMetrics({ discrete_alarm: 3 }),
        'discrete_alarm',
      );
      expect(metric.diff.severity).toBe('error');
      expect(metric.diff.hint).toBe('Regression: +1');
    });

    it('keeps metrics without a definition on the default noise-band behavior', () => {
      // No definition for `paint:default`, so it uses the global ±20% noise band.
      const withinNoise = metricEntry(
        reportWithMetrics({ 'paint:default': 110 }),
        reportWithMetrics({ 'paint:default': 100 }),
        'paint:default',
      );
      expect(withinNoise.diff.severity).toBe('neutral');

      const regression = metricEntry(
        reportWithMetrics({ 'paint:default': 130 }),
        reportWithMetrics({ 'paint:default': 100 }),
        'paint:default',
      );
      expect(regression.diff.severity).toBe('error');
    });

    it('resolves a sub-series definition by its base metric name', () => {
      const metric = metricEntry(
        reportWithMetrics({ 'scalar_alarm#large': 120 }),
        reportWithMetrics({ 'scalar_alarm#large': 100 }),
        'scalar_alarm#large',
      );
      expect(metric.diff.severity).toBe('error');
    });
  });
});
