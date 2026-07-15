import { describe, it, expect } from 'vitest';
import { buildBenchmarkMarkdownReport } from './buildMarkdownReport';
import { compareBenchmarkReports } from './compareBenchmarkReports';
import type { BenchmarkComparisonInput } from './compareBenchmarkReports';
import type { BenchmarkReport, BenchmarkReportEntry, MetricDefinition } from './types';
import { makeReport, makeReportFromConfig, makeStatReport, statReport } from './test-fixtures';

// Tight variance + adequate count so duration deltas resolve crisply: a large delta is unambiguously
// significant, a sub-5%-effect-size delta unambiguously neutral — no p-values near the boundary.
const statAt = (entries: Record<string, number>) => makeStatReport(entries, 2, 20);

// A single benchmark whose duration/renders are neutral, so the only signal is one metric.
function metricReport(
  name: string,
  mean: number,
  definitions?: Record<string, MetricDefinition>,
): BenchmarkComparisonInput {
  const entry: BenchmarkReportEntry = {
    iterations: 10,
    totalDuration: 100,
    renders: [],
    metrics: { [name]: { mean, stdDev: 0, outliers: 0 } },
  };
  return { report: { Bench: entry }, metricDefinitions: definitions };
}

const alarmDefinitions: Record<string, MetricDefinition> = {
  clicks: {
    kind: 'discrete',
    format: { maximumFractionDigits: 0 },
    alarm: { direction: 'lowerIsBetter', error: 1 },
  },
  tti: { kind: 'scalar', alarm: { direction: 'lowerIsBetter', warn: 0.1, error: 0.25 } },
  fps: { kind: 'scalar' }, // informational (no alarm)
};

// Builds `count` neutral-duration tests that each regress one alarmed metric, so every test
// contributes exactly one row to the metric-alarms table.
function alarmedReports(
  count: number,
  metricName: string,
  currentMean: number,
  baseMean: number,
): { current: BenchmarkComparisonInput; base: BenchmarkComparisonInput } {
  const current: BenchmarkReport = {};
  const base: BenchmarkReport = {};
  for (let index = 0; index < count; index += 1) {
    current[`Test${index}`] = {
      iterations: 10,
      totalDuration: 100,
      renders: [],
      metrics: { [metricName]: { mean: currentMean, stdDev: 0, outliers: 0 } },
    };
    base[`Test${index}`] = {
      iterations: 10,
      totalDuration: 100,
      renders: [],
      metrics: { [metricName]: { mean: baseMean, stdDev: 0, outliers: 0 } },
    };
  }
  return {
    current: { report: current, metricDefinitions: alarmDefinitions },
    base: { report: base },
  };
}

// A test that reports an aggregate `bench:paint` default series, neutral on duration/renders.
function paintReport(paintMean: number): BenchmarkComparisonInput {
  const entry: BenchmarkReportEntry = {
    iterations: 10,
    totalDuration: 100,
    renders: [],
    metrics: { 'bench:paint': { mean: paintMean, stdDev: 0, outliers: 0 } },
  };
  return { report: { Bench: entry } };
}

describe('buildBenchmarkMarkdownReport', () => {
  it('drops within-noise rows but keeps significant regressions', () => {
    const report = compareBenchmarkReports(
      statAt({ Button: 150, Card: 103 }), // Card +3%: below effect floor
      statAt({ Button: 100, Card: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('Button');
    expect(markdown).not.toContain('Card');
    expect(markdown).toContain('🔺');
  });

  it('annotates a flagged duration with its p-value when a Welch test ran', () => {
    const report = compareBenchmarkReports(statReport(106, 1, 20), statReport(100, 1, 20));
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('Bench');
    expect(markdown).toMatch(/p[=<]/);
  });

  it('renders "No significant changes" when every entry is within noise', () => {
    const report = compareBenchmarkReports(
      statAt({ Button: 103, Card: 98 }), // both within ±3%
      statAt({ Button: 100, Card: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('No significant changes');
    expect(markdown).not.toContain('| Test |');
  });

  it('includes the details link in the "No significant changes" branch', () => {
    const report = compareBenchmarkReports(
      statAt({ Button: 103, Card: 98 }),
      statAt({ Button: 100, Card: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report, {
      reportUrl: 'https://example.com/details',
    });
    expect(markdown).toContain('No significant changes');
    expect(markdown).toContain('https://example.com/details');
  });

  it('shows "...and N more" footer once significant entries exceed maxRows', () => {
    const current: Record<string, number> = {};
    const base: Record<string, number> = {};
    for (let i = 0; i < 7; i += 1) {
      current[`Test${i}`] = 200;
      base[`Test${i}`] = 100;
    }
    const report = compareBenchmarkReports(statAt(current), statAt(base));
    const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
    expect(markdown).toContain('…and 2 more');
    expect(markdown).not.toContain('within noise');
  });

  it('mentions within-noise tests in the footer when some entries are filtered out', () => {
    const current: Record<string, number> = { Regression: 150 };
    const base: Record<string, number> = { Regression: 100 };
    for (let i = 0; i < 3; i += 1) {
      current[`Stable${i}`] = 103; // +3%: below effect floor
      base[`Stable${i}`] = 100;
    }
    const report = compareBenchmarkReports(statAt(current), statAt(base));
    const markdown = buildBenchmarkMarkdownReport(report, {
      maxRows: 5,
      reportUrl: 'https://example.com/details',
    });
    expect(markdown).toContain('3 tests within noise');
    expect(markdown).toContain('https://example.com/details');
  });

  it('combines truncated significant count with within-noise count when both apply', () => {
    const current: Record<string, number> = {};
    const base: Record<string, number> = {};
    for (let i = 0; i < 7; i += 1) {
      current[`Reg${i}`] = 200;
      base[`Reg${i}`] = 100;
    }
    for (let i = 0; i < 4; i += 1) {
      current[`Stable${i}`] = 103; // +3%: below effect floor
      base[`Stable${i}`] = 100;
    }
    const report = compareBenchmarkReports(statAt(current), statAt(base));
    const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
    expect(markdown).toContain('…and 2 more (+4 within noise)');
  });

  it('renders a plain table without totals or diff columns when hasBase is false', () => {
    const report = compareBenchmarkReports(statAt({ Button: 100 }), null);
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).not.toContain('Total duration');
    expect(markdown).not.toContain('🔺');
    expect(markdown).not.toContain('▼');
    expect(markdown).toContain('Button');
  });

  it('keeps removed entries visible even though their severity is neutral-like', () => {
    const report = compareBenchmarkReports(makeReport({}), makeReport({ Button: 100 }));
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('~~Button~~');
    expect(markdown).toContain('(removed)');
  });

  it('keeps rows whose render count changed even when the duration delta is within noise', () => {
    const currentReport = makeReportFromConfig({
      Button: { duration: 105, renders: 3 },
      Card: { duration: 105, renders: 1 },
    });
    const baseReport = makeReportFromConfig({
      Button: { duration: 100, renders: 1 },
      Card: { duration: 100, renders: 1 },
    });
    const report = compareBenchmarkReports(currentReport, baseReport);
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('Button');
    expect(markdown).not.toContain('Card');
    expect(markdown).toContain('🔺+2');
  });

  it('does not emit the "No significant changes" branch when only render counts change', () => {
    const currentReport = makeReportFromConfig({
      Button: { duration: 105, renders: 2 },
    });
    const baseReport = makeReportFromConfig({
      Button: { duration: 100, renders: 1 },
    });
    const report = compareBenchmarkReports(currentReport, baseReport);
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).not.toContain('No significant changes');
    expect(markdown).toContain('| Test |');
  });

  // Uploads made before per-series sample counts existed carry no stdDev/count, so the comparison
  // can't run a Welch test and falls back to the fixed ±20% relative band. These lock that
  // rendering; they can be deleted once the legacy fallback is retired.
  describe('legacy uploads (no sample counts)', () => {
    it('flags a past-±20% regression via the noise band, with no p-value annotation', () => {
      const report = compareBenchmarkReports(
        makeReport({ Button: 130 }),
        makeReport({ Button: 100 }),
      );
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).toContain('Button');
      expect(markdown).toContain('🔺');
      expect(markdown).not.toMatch(/p[=<]/); // no Welch test ran, so no p-value is shown
    });

    it('drops a within-±20% change as noise', () => {
      const report = compareBenchmarkReports(
        makeReport({ Button: 110 }),
        makeReport({ Button: 100 }),
      );
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).toContain('No significant changes');
    });
  });

  describe('metric alarms', () => {
    it('surfaces an error-level metric, making its otherwise-neutral test significant', () => {
      const report = compareBenchmarkReports(
        metricReport('clicks', 5, alarmDefinitions), // +2 vs 3, discrete error band 1
        metricReport('clicks', 3),
      );
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).not.toContain('No significant changes');
      expect(markdown).toContain('**Metric alarms**');
      expect(markdown).toContain('| Bench | clicks |');
      expect(markdown).toContain('🔺');
    });

    it('does not surface warning-level metrics (kept on the dashboard only)', () => {
      const report = compareBenchmarkReports(
        metricReport('tti', 115, alarmDefinitions), // +15%: past warn (10%), within error (25%) -> warning
        metricReport('tti', 100),
      );
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).toContain('No significant changes');
      expect(markdown).not.toContain('Metric alarms');
    });

    it('ignores informational metrics — no alarm section, test stays within noise', () => {
      const report = compareBenchmarkReports(
        metricReport('fps', 200, alarmDefinitions), // big change but no alarm configured
        metricReport('fps', 100),
      );
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).toContain('No significant changes');
      expect(markdown).not.toContain('Metric alarms');
    });

    it('caps the alarms table at maxRows and notes how many more were hidden', () => {
      const { current, base } = alarmedReports(7, 'clicks', 5, 3); // +2 each, discrete error band 1
      const report = compareBenchmarkReports(current, base);
      const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
      expect(markdown).toContain('**Metric alarms**');
      expect((markdown.match(/\| clicks \|/g) ?? []).length).toBe(5);
      expect(markdown).toContain('…and 2 more metric alarms');
    });

    it('omits the "and N more" note when alarms fit within maxRows', () => {
      const { current, base } = alarmedReports(3, 'clicks', 5, 3);
      const report = compareBenchmarkReports(current, base);
      const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
      expect(markdown).toContain('**Metric alarms**');
      expect(markdown).not.toContain('more metric alarm');
    });
  });

  describe('paint summary', () => {
    it('renders the aggregate Paint total line when tests report paint', () => {
      const report = compareBenchmarkReports(paintReport(130), paintReport(100));
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).toContain('**Paint:**');
      expect(markdown).toContain('🔺');
    });

    it('omits the Paint total line when no test reports paint', () => {
      const report = compareBenchmarkReports(
        makeReport({ Button: 130 }),
        makeReport({ Button: 100 }),
      );
      const markdown = buildBenchmarkMarkdownReport(report);
      expect(markdown).not.toContain('**Paint:**');
    });
  });
});
