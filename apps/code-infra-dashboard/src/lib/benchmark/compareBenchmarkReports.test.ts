import { describe, it, expect } from 'vitest';
import { compareBenchmarkReports } from './compareBenchmarkReports';
import type { BenchmarkComparisonInput } from './compareBenchmarkReports';
import type { BenchmarkReport, BenchmarkReportEntry, MetricDefinition } from './types';
import { makeReport, makeReportFromConfig } from './test-fixtures';

/** A single-render benchmark carrying the stdDev + sample count needed for a Welch's t-test. */
function statReport(mean: number, stdDev: number, count: number): BenchmarkComparisonInput {
  const entry: BenchmarkReportEntry = {
    iterations: count,
    totalDuration: mean,
    // Single render, so the total-duration distribution equals the render's.
    totalStdDev: stdDev,
    totalCount: count,
    renders: [
      {
        id: 'render-0',
        phase: 'mount',
        startTime: 0,
        actualDuration: mean,
        stdDev,
        rawMean: mean,
        rawStdDev: stdDev,
        outliers: 0,
        count,
      },
    ],
    metrics: {},
  };
  return { report: { Bench: entry } };
}

/** A single-render benchmark entry carrying total-duration stats, for grand-total pooling tests. */
function totalEntry(mean: number, stdDev: number, count: number): BenchmarkReportEntry {
  return {
    iterations: count,
    totalDuration: mean,
    totalStdDev: stdDev,
    totalCount: count,
    renders: [
      {
        id: 'render-0',
        phase: 'mount',
        startTime: 0,
        actualDuration: mean,
        stdDev,
        rawMean: mean,
        rawStdDev: stdDev,
        outliers: 0,
        count,
      },
    ],
    metrics: {},
  };
}

/** A single-metric report whose metric carries the stdDev + count a Welch's t-test needs. */
function reportWithMetricStats(
  name: string,
  mean: number,
  stdDev: number,
  count: number,
): BenchmarkReport {
  return {
    Bench: {
      iterations: count,
      totalDuration: 0,
      renders: [],
      metrics: { [name]: { mean, stdDev, outliers: 0, count } },
    },
  };
}

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

function makePaintEntry(
  paintMean: number,
  extraMetrics: Record<string, number> = {},
): BenchmarkReportEntry {
  return {
    iterations: 10,
    totalDuration: 0,
    renders: [],
    metrics: {
      'bench:paint': { mean: paintMean, stdDev: 0, outliers: 0 },
      ...Object.fromEntries(
        Object.entries(extraMetrics).map(([name, mean]) => [
          name,
          { mean, stdDev: 0, outliers: 0 },
        ]),
      ),
    },
  };
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
  // The metric appears on the current side, so its definitions ride along there.
  const result = compareBenchmarkReports(
    { report: current, metricDefinitions: definitions },
    { report: base },
  );
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

  describe('statistical gating (Welch)', () => {
    it('flags a small but confident regression the legacy ±20% band would have missed', () => {
      // +6% with tight variance across 20 samples — well within the old noise band, but clearly real.
      const result = compareBenchmarkReports(statReport(106, 1, 20), statReport(100, 1, 20));
      const entry = result.entries[0];
      expect(entry.duration.severity).toBe('error');
      expect(entry.duration.significant).toBe(true);
      expect(entry.duration.pValue).not.toBeNull();
      expect(entry.duration.hint).toContain('Regression');
    });

    it('leaves a large but noisy diff neutral when it is not statistically significant', () => {
      // +30% (past the old 20% band) but swamped by variance — not significant, so not flagged.
      const result = compareBenchmarkReports(statReport(130, 60, 20), statReport(100, 60, 20));
      const entry = result.entries[0];
      expect(entry.duration.severity).toBe('neutral');
      expect(entry.duration.significant).toBe(false);
      expect(entry.duration.hint).toContain('Not significant');
    });

    it('leaves a significant but sub-threshold change neutral (effect-size floor)', () => {
      // +3% with tiny variance: statistically significant, but below the 5% minimum effect size.
      const result = compareBenchmarkReports(statReport(103, 0.5, 20), statReport(100, 0.5, 20));
      const entry = result.entries[0];
      expect(entry.duration.severity).toBe('neutral');
      expect(entry.duration.significant).toBe(true);
      expect(entry.duration.hint).toContain('Below threshold');
    });

    it('flags a confident improvement as success', () => {
      const result = compareBenchmarkReports(statReport(90, 1, 20), statReport(100, 1, 20));
      const entry = result.entries[0];
      expect(entry.duration.severity).toBe('success');
      expect(entry.duration.hint).toContain('Improvement');
    });

    it('tests Duration from the stored total stats, independent of per-render sample counts', () => {
      // Renders deliberately carry no `count`; the Duration must still run a Welch test from the
      // entry-level totalStdDev/totalCount rather than collapsing on a per-render count.
      const withTotalStats = (totalDuration: number): BenchmarkComparisonInput => ({
        report: {
          Bench: {
            iterations: 20,
            totalDuration,
            totalStdDev: 1,
            totalCount: 20,
            renders: [
              {
                id: 'r',
                phase: 'mount',
                startTime: 0,
                actualDuration: totalDuration,
                stdDev: 5,
                rawMean: totalDuration,
                rawStdDev: 5,
                outliers: 0,
              },
            ],
            metrics: {},
          },
        },
      });
      const result = compareBenchmarkReports(withTotalStats(106), withTotalStats(100));
      const entry = result.entries[0];
      expect(entry.duration.pValue).not.toBeNull(); // Welch ran despite renders lacking a count
      expect(entry.duration.severity).toBe('error');
    });

    it('falls back to the legacy noise band when the baseline has no sample count', () => {
      // Current side has counts, base side (an old upload) does not → no test possible.
      const legacyBase = makeReport({ Bench: 100 }); // fixtures omit `count`
      const result = compareBenchmarkReports(statReport(130, 1, 20), legacyBase);
      const entry = result.entries[0];
      // Legacy path: +30% is past ±20%, flagged, and no p-value is attached.
      expect(entry.duration.severity).toBe('error');
      expect(entry.duration.pValue).toBeNull();
      expect(entry.duration.significant).toBe(false);
      expect(entry.duration.hint).toContain('Regression');
    });

    it('routes Duration to the legacy band when a count is present but the stdDev is missing', () => {
      // A partial upload (count without stdDev) must not be read as zero-variance — that would
      // fabricate a near-zero standard error and flag the small diff as a significant regression.
      const base: BenchmarkComparisonInput = {
        report: {
          Bench: {
            iterations: 20,
            totalDuration: 100,
            totalCount: 20, // present…
            // totalStdDev intentionally absent
            renders: [
              {
                id: 'render-0',
                phase: 'mount',
                startTime: 0,
                actualDuration: 100,
                stdDev: 1,
                rawMean: 100,
                rawStdDev: 1,
                outliers: 0,
                count: 20,
              },
            ],
            metrics: {},
          },
        },
      };
      const result = compareBenchmarkReports(statReport(106, 1, 20), base);
      const entry = result.entries[0];
      expect(entry.duration.pValue).toBeNull(); // no test ran
      expect(entry.duration.severity).toBe('neutral'); // +6% is within the legacy ±20% band
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
      // The hint respects the metric's format rather than hard-coding milliseconds.
      expect(metric.diff.hint).toContain('byte');
      expect(metric.diff.hint).not.toContain('ms');
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

    it('labels a significant sub-band scalar change "Below threshold", not "Within noise"', () => {
      // +3% with tight variance across 20 samples: statistically significant, but below the metric's
      // 10% error band — a real change that just isn't big enough to flag. It must read differently
      // from the untested "Within noise" fallback.
      const metric = metricEntry(
        reportWithMetricStats('scalar_alarm', 103, 0.5, 20),
        reportWithMetricStats('scalar_alarm', 100, 0.5, 20),
        'scalar_alarm',
      );
      expect(metric.diff.severity).toBe('neutral');
      expect(metric.diff.significant).toBe(true);
      expect(metric.diff.hint).toContain('Below threshold');
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

    it('keeps a base-only (removed) metric formatted using its base definition', () => {
      // Definitions travel with their report: the metric exists only in the base, so its formatting
      // comes from the base side's definitions even though the head has none.
      const result = compareBenchmarkReports(
        { report: reportWithMetrics({}) },
        {
          report: reportWithMetrics({ bytes: 100 }),
          metricDefinitions: { bytes: { kind: 'scalar', format: { style: 'unit', unit: 'byte' } } },
        },
      );
      const metric = result.entries[0].metrics.find((entry) => entry.name === 'bytes')!;
      expect(metric.removed).toBe(true);
      expect(metric.format).toEqual({ style: 'unit', unit: 'byte' });
    });
  });

  describe('grand-total duration', () => {
    it('pools unequal-count benchmarks rather than collapsing on the smallest count', () => {
      // A high-n, noisy benchmark (n=200) and a low-n, tight one (n=10). Pooling each benchmark's
      // own standard error credits the high-n side's precision; the old min-count approach divided
      // its variance by the smallest count, over-stating the total standard error.
      const current = { report: { A: totalEntry(51, 3, 200), B: totalEntry(50, 1, 10) } };
      const base = { report: { A: totalEntry(45, 3, 200), B: totalEntry(50, 1, 10) } };
      const result = compareBenchmarkReports(current, base);
      // Total 101 vs 95 = +6.3%, comfortably significant against the pooled standard error.
      expect(result.totals.duration.pValue).not.toBeNull();
      expect(result.totals.duration.significant).toBe(true);
      expect(result.totals.duration.severity).toBe('error');
    });

    it('keeps testing the total when one benchmark is pinned to a single run', () => {
      // The pinned benchmark has count 1 (no estimable variance). It contributes only its mean and
      // must not collapse the entire Totals row onto the legacy ±20% band.
      const current = { report: { A: totalEntry(106, 1, 20), Pinned: totalEntry(5, 0, 1) } };
      const base = { report: { A: totalEntry(100, 1, 20), Pinned: totalEntry(5, 0, 1) } };
      const result = compareBenchmarkReports(current, base);
      // Total 111 vs 105 = +5.7%: tested (p-value present) and flagged, not silently neutral.
      expect(result.totals.duration.pValue).not.toBeNull();
      expect(result.totals.duration.severity).toBe('error');
    });

    it('falls back to the legacy band when a benchmark predates total sample counts', () => {
      const legacyEntry: BenchmarkReportEntry = {
        iterations: 20,
        totalDuration: 50,
        // no totalStdDev / totalCount
        renders: [],
        metrics: {},
      };
      const current = {
        report: { A: totalEntry(106, 1, 20), Legacy: { ...legacyEntry, totalDuration: 53 } },
      };
      const base = { report: { A: totalEntry(100, 1, 20), Legacy: legacyEntry } };
      const result = compareBenchmarkReports(current, base);
      // One un-testable benchmark makes the grand total un-testable → legacy comparison, no p-value.
      expect(result.totals.duration.pValue).toBeNull();
    });
  });

  describe('paint totals', () => {
    it('aggregates the bench:paint default series across all tests', () => {
      const result = compareBenchmarkReports(
        { report: { A: makePaintEntry(60), B: makePaintEntry(40) } },
        { report: { A: makePaintEntry(50), B: makePaintEntry(30) } },
      );
      expect(result.totals.paintDefault).not.toBeNull();
      expect(result.totals.paintDefault!.current).toBe(100);
      expect(result.totals.paintDefault!.base).toBe(80);
      expect(result.totals.paintDefault!.absoluteDiff).toBe(20);
    });

    it('ignores bench:paint sub-series in the default-series total', () => {
      const result = compareBenchmarkReports(
        { report: { A: makePaintEntry(60, { 'bench:paint#header': 999 }) } },
        { report: { A: makePaintEntry(50) } },
      );
      expect(result.totals.paintDefault!.current).toBe(60);
    });

    it('is null when no test reports paint', () => {
      const result = compareBenchmarkReports(
        makeReport({ Button: 100 }),
        makeReport({ Button: 90 }),
      );
      expect(result.totals.paintDefault).toBeNull();
    });
  });
});
