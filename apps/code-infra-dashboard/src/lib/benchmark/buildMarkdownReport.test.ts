import { describe, it, expect } from 'vitest';
import { buildBenchmarkMarkdownReport } from './buildMarkdownReport';
import { compareBenchmarkReports } from './compareBenchmarkReports';
import { makeReport, makeReportFromConfig } from './test-fixtures';

describe('buildBenchmarkMarkdownReport', () => {
  it('drops within-noise rows but keeps significant regressions', () => {
    const report = compareBenchmarkReports(
      makeReport({ Button: 150, Card: 105 }),
      makeReport({ Button: 100, Card: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('Button');
    expect(markdown).not.toContain('Card');
    expect(markdown).toContain('🔺');
  });

  it('renders "No significant changes" when every entry is within noise', () => {
    const report = compareBenchmarkReports(
      makeReport({ Button: 110, Card: 95 }),
      makeReport({ Button: 100, Card: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('No significant changes');
    expect(markdown).not.toContain('| Test |');
  });

  it('shows "...and N more" footer once significant entries exceed maxRows', () => {
    const current: Record<string, number> = {};
    const base: Record<string, number> = {};
    for (let i = 0; i < 7; i += 1) {
      current[`Test${i}`] = 200;
      base[`Test${i}`] = 100;
    }
    const report = compareBenchmarkReports(makeReport(current), makeReport(base));
    const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
    expect(markdown).toContain('…and 2 more');
  });

  it('renders a plain table without totals or diff columns when hasBase is false', () => {
    const report = compareBenchmarkReports(makeReport({ Button: 100 }), null);
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
});
