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

  it('includes the details link in the "No significant changes" branch', () => {
    const report = compareBenchmarkReports(
      makeReport({ Button: 110, Card: 95 }),
      makeReport({ Button: 100, Card: 100 }),
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
    const report = compareBenchmarkReports(makeReport(current), makeReport(base));
    const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
    expect(markdown).toContain('…and 2 more');
    expect(markdown).not.toContain('within noise');
  });

  it('mentions within-noise tests in the footer when some entries are filtered out', () => {
    const current: Record<string, number> = { Regression: 150 };
    const base: Record<string, number> = { Regression: 100 };
    for (let i = 0; i < 3; i += 1) {
      current[`Stable${i}`] = 105;
      base[`Stable${i}`] = 100;
    }
    const report = compareBenchmarkReports(makeReport(current), makeReport(base));
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
      current[`Stable${i}`] = 105;
      base[`Stable${i}`] = 100;
    }
    const report = compareBenchmarkReports(makeReport(current), makeReport(base));
    const markdown = buildBenchmarkMarkdownReport(report, { maxRows: 5 });
    expect(markdown).toContain('…and 2 more (+4 within noise)');
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

  it('splits regressions and improvements into separate sections', () => {
    const report = compareBenchmarkReports(
      makeReport({ Slow: 150, Fast: 50, Stable: 102 }),
      makeReport({ Slow: 100, Fast: 100, Stable: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('#### 🔺 Regressions');
    expect(markdown).toContain('#### ▼ Improvements');
    // No-change entries only surface via the footer/details, never as rows.
    expect(markdown).not.toContain('| Stable |');
    expect(markdown).toContain('within noise');

    const regressionIndex = markdown.indexOf('#### 🔺 Regressions');
    const improvementIndex = markdown.indexOf('#### ▼ Improvements');
    expect(regressionIndex).toBeLessThan(improvementIndex);
    expect(markdown.indexOf('Slow')).toBeLessThan(improvementIndex);
    expect(markdown.indexOf('Fast')).toBeGreaterThan(improvementIndex);
  });

  it('omits the regressions section when every change is an improvement', () => {
    const report = compareBenchmarkReports(makeReport({ Fast: 50 }), makeReport({ Fast: 100 }));
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).not.toContain('#### 🔺 Regressions');
    expect(markdown).toContain('#### ▼ Improvements');
    expect(markdown).toContain('Fast');
  });

  it('places removed tests in the added & removed section', () => {
    const report = compareBenchmarkReports(makeReport({}), makeReport({ Button: 100 }));
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('#### ➕ Added & removed');
    expect(markdown).not.toContain('#### 🔺 Regressions');
    const sectionIndex = markdown.indexOf('#### ➕ Added & removed');
    expect(markdown.indexOf('~~Button~~')).toBeGreaterThan(sectionIndex);
  });

  it('lists added and removed tests together in one section', () => {
    const report = compareBenchmarkReports(
      makeReport({ Existing: 100, Fresh: 80 }),
      makeReport({ Existing: 100, Gone: 100 }),
    );
    const markdown = buildBenchmarkMarkdownReport(report);
    expect(markdown).toContain('#### ➕ Added & removed');
    const sectionIndex = markdown.indexOf('#### ➕ Added & removed');
    expect(markdown.indexOf('Fresh')).toBeGreaterThan(sectionIndex);
    expect(markdown.indexOf('~~Gone~~')).toBeGreaterThan(sectionIndex);
    // Existing test is unchanged → no row, only the within-noise footer.
    expect(markdown).not.toContain('| Existing |');
  });

  it('renders the exact markdown for a report exercising every mutation', () => {
    // One entry per mutation the comment can show:
    // - Slower: duration regression
    // - Faster: duration improvement
    // - Rerendered: within-noise duration but render-count regression
    // - Stable: within noise → no row, only the footer
    // - Fresh: added (no baseline)
    // - Gone: removed (no current value)
    const current = makeReportFromConfig({
      Slower: { duration: 150, renders: 1 },
      Faster: { duration: 50, renders: 1 },
      Rerendered: { duration: 102, renders: 3 },
      Stable: { duration: 102, renders: 1 },
      Fresh: { duration: 80, renders: 1 },
    });
    const base = makeReportFromConfig({
      Slower: { duration: 100, renders: 1 },
      Faster: { duration: 100, renders: 1 },
      Rerendered: { duration: 100, renders: 1 },
      Stable: { duration: 100, renders: 1 },
      Gone: { duration: 100, renders: 1 },
    });
    const report = compareBenchmarkReports(current, base);
    const markdown = buildBenchmarkMarkdownReport(report, {
      reportUrl: 'https://example.com/details',
    });
    expect(markdown).toMatchInlineSnapshot(`
      "**Total duration:** 484.00 ms -16.00 ms<sup>(-3.2%)</sup> | **Renders:** 7 <sup>(🔺+2)</sup>

      #### 🔺 Regressions

      | Test | Duration | Renders |
      |:-----|----------:|--------:|
      | Rerendered | 102.00 ms +2.00 ms<sup>(+2.0%)</sup> | 3 <sup>(🔺+2)</sup> |
      | Slower | 150.00 ms 🔺+50.00 ms<sup>(+50.0%)</sup> | 1 <sup>(+0)</sup> |

      #### ▼ Improvements

      | Test | Duration | Renders |
      |:-----|----------:|--------:|
      | Faster | 50.00 ms ▼-50.00 ms<sup>(-50.0%)</sup> | 1 <sup>(+0)</sup> |

      #### ➕ Added & removed

      | Test | Duration | Renders |
      |:-----|----------:|--------:|
      | ~~Gone~~ (removed) | — | — |
      | Fresh | 80.00 ms | 1 |

      *1 test within noise — [details](https://example.com/details)*"
    `);
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
